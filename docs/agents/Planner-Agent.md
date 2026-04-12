# Planner Agent

> **파일**: `backend/agents/planner_agent.py`
> **역할**: Filter Agent가 걸러낸 유효 장소들을 날짜별로 최적 배치하여 실제 여행 일정(타임라인)을 생성합니다.

---

## 설계 원칙

- **LLM 호출 없음**: 모든 로직이 rule-based + 수치 알고리즘으로 동작
- **지리 기반 클러스터링**: 같은 날에는 가까운 장소끼리 묶어 이동 거리 최소화
- **핀(Pin) 우선**: RESERVATION 핀은 지정 시각에, STAY 핀은 해당 날짜 맨 뒤에 배치
- **숙소 연속성**: 전날 숙소에서 다음 날 일정이 시작됨 (TSP 시작점 = 전날 STAY 위치)
- **3단계 충돌 해결**: 운영시간 충돌 시 뒤로 미루기(shift) → 날짜 이동(move) → 제거(remove) 순으로 처리
- **단방향 이동 정책**: 이미 이동된 장소가 재충돌하면 다시 이동시키지 않고 즉시 제거 (핑퐁 방지)
- **필수 장소 보호**: `is_must_visit == true`인 장소는 충돌이 있어도 경고만 붙이고 절대 제거하지 않음
- **하루 최대 8개 장소**: 일정이 터지지 않도록 클러스터당 상한을 둠

---

## 상수 정의 (`time_utils.py`)

코드 전반에서 사용하는 상수를 `time_utils.py`에 정의합니다.

```python
# 카테고리별 체류 시간 범위 (분): (최소, 최대)
STAY_DURATION_RANGE: dict[str, tuple[int, int]] = {
    "카페":     (45,  75),
    "맛집":     (60, 120),
    "관광지":   (60, 120),
    "숙소":     (20,  40),
    "액티비티": (90, 150),
}

# 카테고리별 기본 영업 슬롯 (Filter Agent용)
DEFAULT_HOURS: dict[str, list] = {
    "맛집":     [[660, 1260]],  # 11:00~21:00
    "카페":     [[600, 1320]],  # 10:00~22:00
    "관광지":   [[540, 1200]],  # 09:00~20:00
    "숙소":     [[0, 1440]],
    "액티비티": [[600, 1200]],
}
DEFAULT_FALLBACK_HOURS: list = [[600, 1200]]

# 맛집 식사 시간대 창 (open_min, close_min)
MEAL_WINDOWS: list[tuple[int, int]] = [
    (660,  870),   # LUNCH:  11:00~14:30
    (1020, 1230),  # DINNER: 17:00~20:30
]

# 하루 최대 장소 수 (hard cap)
MAX_PLACES_PER_DAY: int = 8

# 카테고리별 하루 최대 개수 (soft cap — 초과 시 다른 날짜 우선, 불가능하면 허용)
MAX_CATEGORY_PER_DAY: dict[str, int] = {
    "카페":  2,
    "맛집":  2,
}

# 하루 최대 종료 시각 (분): 21:00
MAX_DAY_END: int = 1260

# 이동시간 fallback 최솟값 (분)
MIN_TRAVEL_MIN: int = 5

# 맛집 식사 시간대 최대 대기(점프) 시간 (분): 이 이상이면 점프하지 않고 일반 배치
MAX_MEAL_JUMP_MIN: int = 60

# RESERVATION 지각 허용 오차 (분): 이 이내면 정상으로 간주하고 시각 그대로 고정
RESERVATION_TOLERANCE: int = 10

# RESERVATION 지각 시 경고만 내고 허용하는 최대 지각 폭 (분)
# 이 이내: LATE_WARNING 태깅 후 밀린 시각으로 배치
# 이 초과: repair_conflict → MOVED or REMOVED
# ⚠️ v7 변경: 일반 장소 30분, 맛집 RESERVATION은 15분으로 강화
# (맛집 예약 30분 지각은 사실상 노쇼 처리 가능성 높음)
RESERVATION_LATE_SHIFT_MAX: int = 30           # 일반 장소
RESERVATION_LATE_SHIFT_MAX_RESTAURANT: int = 15  # 맛집(카테고리="맛집") 전용
```

### 체류 시간 동적 계산 (`get_stay_duration`)

하루 장소 수가 많을수록 체류 시간을 단축합니다.

```python
def get_stay_duration(category: str, n_places_today: int) -> int:
    """하루 장소 수에 따라 체류 시간을 동적으로 조정.

    n_places_today <= 3 → 최댓값 사용
    n_places_today >= 6 → 최솟값 사용
    중간 → 선형 보간
    """
    min_dur, max_dur = STAY_DURATION_RANGE.get(category, (60, 90))
    ratio = min(1.0, max(0.0, (n_places_today - 3) / 3))  # 3→0.0, 6→1.0
    return int(max_dur - (max_dur - min_dur) * ratio)
```

| n_places_today | 관광지 체류 시간 |
|:--------------:|:---------------:|
| ≤ 3 | 120분 |
| 4 | 100분 |
| 5 | 80분 |
| ≥ 6 | 60분 |

---

## 입력

| 필드 | 타입 | 설명 |
|------|------|------|
| `valid_places` | `list[dict]` | Filter Agent가 운영시간 정보와 함께 반환한 유효 장소 목록 |
| `travel_dates` | `list[str]` | 여행 날짜 목록 (ISO 형식, e.g. `["2025-07-01", "2025-07-02"]`) |
| `schedule_pins` | `list[dict]` | 고정 핀 목록 (예약 시간 고정, 숙소 체크인 등) |

**고정 핀 구조** (`schedule_pins`의 각 항목):
```json
{
  "place_id": "uuid",
  "type": "RESERVATION",
  "pinned_date": "2025-07-01",
  "pinned_time": "12:30",
  "checkout_date": null
}
```

| `type` 값 | 의미 |
|-----------|------|
| `RESERVATION` | 예약된 장소. 지정 날짜의 지정 시각에 방문 시작으로 고정 |
| `STAY` | 숙소 체크인. 지정 날짜의 일정 맨 뒤에 배치. 다음 날 TSP 시작점으로 사용됨 |

---

## 출력

| 필드 | 타입 | 설명 |
|------|------|------|
| `days` | `list[dict]` | 날짜별 일정 목록 |
| `excluded_places` | `list[dict]` | Planner 단계에서 추가로 제외된 장소 (Filter Agent 제외 누적) |
| `messages` | `list[str]` | 완료 로그 (e.g. "Planner Agent 완료: 2일, 총 8개 장소 배치, 제외 1개") |

**날짜별 일정 구조** (`days`의 각 항목):
```json
{
  "date": "2025-07-01",
  "ordered_places": [
    {
      "place_id": "uuid",
      "name": "경복궁",
      "lat": 37.5796,
      "lng": 126.9770,
      "category": "관광지",
      "is_must_visit": true,
      "kakao_place_id": "12345678",
      "start_at": "09:00",
      "end_at": "10:30",
      "travel_minutes_from_prev": 0,
      "pin_type": null,
      "hours_source": "GOOGLE",
      "place_warning": null
    }
  ]
}
```

**`ordered_places` 각 필드 설명**:

| 필드 | 설명 |
|------|------|
| `start_at` / `end_at` | 방문 시작·종료 시각 (`HH:MM` 형식). STAY 앵커는 `end_at: "21:00"` (하루 종료 시각 고정) |
| `travel_minutes_from_prev` | 직전 장소에서 이동하는 데 걸리는 시간(분). 첫 장소는 `0` |
| `pin_type` | `"RESERVATION"` / `"STAY"` / `null` |
| `hours_source` | 운영시간 출처 (`"GOOGLE"` / `"DEFAULT"`) |
| `place_warning` | 운영시간 충돌 경고. 정상이면 `null` |
| `affects_time` | 시간 계산에 포함 여부. STAY 앵커만 `false` (체류 시간·다음 출발 시각에 영향 없음) |
| `duration` | 체류 시간(분). STAY 앵커는 `0` |

> **STAY 앵커 특이사항**: `end_at: "21:00"` (하루 종료 시각 고정), `affects_time: false`, `duration: 0`으로 설정됩니다.
> 숙소는 "하루의 끝을 결정하는 anchor"이므로 타임라인 계산에서 제외됩니다.
> `end_at: null` 대신 명시적 값을 사용하는 이유: 프론트엔드 렌더링 시 null로 인한 에러를 방지하고 모든 일정 아이템의 시각 데이터 일관성을 보장합니다.

**`place_warning` 구조** (충돌·지각 경고 시):

| `warning_type` | 발생 조건 | 설명 |
|----------------|-----------|------|
| `MUST_VISIT_CLOSED` | 필수 장소 + 운영시간 충돌 | 일정에 포함되나 방문 전 확인 권장 |
| `RESERVATION_LATE` | 예약 시각 초과, 지각 폭 ≤ 30분 | 예약 시각보다 N분 늦게 도착 예상 |

```json
{
  "warning_type": "RESERVATION_LATE",
  "warning_message": "예약 시각(12:30)보다 15분 늦게 도착이 예상됩니다. 실제 방문 전 확인을 권장합니다."
}
```

---

## 동작 상세

```
[전처리]  STAY 시작점 맵 구성
    ↓
[Step 1]  day_allocation_greedy  — 날짜별 클러스터 분배
    ↓
[Step 2]  anchor_extraction      — 앵커(핀) 분리 및 분류
    ↓
[Step 3]  route_ordering         — TSP 정렬 + RESERVATION 시간 기반 삽입
    ↓
[Step 4]  build_route_matrix     — Kakao Mobility 이동시간 선계산 (병렬, LRU 캐시)
    ↓
[Step 5]  timeline_validation    — 타임라인 생성 + 3단계 충돌 해결
```

---

### 전처리: STAY 시작점 맵 구성

> `planner_agent()` 진입점 내부

날짜별로 "어디서 아침을 맞이하는가"를 미리 계산합니다. 다음 날 TSP 시작점으로 사용됩니다.

```python
# 날짜 → STAY 장소 매핑 (멀티박 지원: checkin~checkout 전날까지 모든 날짜에 매핑)
stay_for_date: dict[str, dict] = {}
for pin in schedule_pins:
    if pin.get("type") != "STAY":
        continue
    pid = pin.get("place_id")
    checkin_str = pin.get("pinned_date")
    checkout_str = pin.get("checkout_date")

    if not (pid and checkin_str and pid in place_map):
        continue

    checkin = date_type.fromisoformat(checkin_str)
    checkout = (
        date_type.fromisoformat(checkout_str)
        if checkout_str
        else checkin + timedelta(days=1)
    )
    if checkout <= checkin:
        checkout = checkin + timedelta(days=1)

    place = place_map[pid]
    cur = checkin
    # checkout 당일 제외 (체크아웃 당일 아침은 이미 숙소를 떠남)
    while cur < checkout:
        date_key = cur.isoformat()
        # 동일 날짜에 다른 숙소 2개 → ValueError (silent overwrite 금지)
        if date_key in stay_for_date and stay_for_date[date_key]["id"] != pid:
            raise ValueError(
                f"{date_key}에 숙소가 중복 등록되었습니다: "
                f"'{stay_for_date[date_key]['name']}' vs '{place['name']}'. "
                "한 날짜에 숙소는 1개만 등록 가능합니다."
            )
        stay_for_date[date_key] = place
        cur += timedelta(days=1)

# day_idx → 전날 STAY 장소
prev_stay_map: dict[int, dict | None] = {0: None}  # 첫날은 전날 숙소 없음
for day_idx in range(1, n_days):
    prev_date = travel_dates[day_idx - 1]
    prev_stay_map[day_idx] = stay_for_date.get(prev_date)

# STAY 핀이 있는 숙소 ID 집합 (day_allocation_greedy에서 이중 제외)
stay_pinned_ids: set[str] = {
    pin["place_id"]
    for pin in schedule_pins
    if pin.get("type") == "STAY" and pin.get("place_id")
}

# STAY 핀 없는 숙소 → excluded_places 이동 (일정 생성은 정상 진행)
for place in valid_places:
    if place.get("category") == "숙소" and place["id"] not in stay_pinned_ids:
        excluded_places.append({**place, "reason": "숙소 날짜 미등록"})
```

**결과 예시 (3일 여행, 2박)**:

```
STAY 핀: 호텔A (7/1 체크인, 7/2 체크아웃)

stay_for_date = {"2025-07-01": 호텔A}
prev_stay_map = {0: None, 1: 호텔A, 2: None}

Day 0 (7/1): prev_stay = None          → 기본 시작점
Day 1 (7/2): prev_stay = 호텔A         → 호텔A에서 출발
Day 2 (7/3): prev_stay = None          → 기본 시작점 (7/2 체크아웃 후 다른 숙소 없음)
```

```
STAY 핀: 호텔A (7/1 체크인, 7/3 체크아웃) → 멀티박

stay_for_date = {"2025-07-01": 호텔A, "2025-07-02": 호텔A}
prev_stay_map = {0: None, 1: 호텔A, 2: 호텔A}

Day 0 (7/1): prev_stay = None
Day 1 (7/2): prev_stay = 호텔A
Day 2 (7/3): prev_stay = 호텔A
```

---

### Step 1. day_allocation_greedy — 날짜별 장소 분배

> `planner_agent.py` → `day_allocation_greedy()`, `_select_seeds()`

전체 유효 장소를 `n_days`개의 날짜 클러스터로 분배합니다. 같은 날에 가까운 장소끼리 묶는 것이 목표입니다.

#### 1-1. Seed 선택 (`_select_seeds`) — 밀도 중심 기준

각 날짜의 "대표 장소(seed)"를 선택합니다.

> **⚠️ v2 변경**: 기존 `seed[0] = centroid에서 가장 먼 장소(outlier)`에서 `seed[0] = centroid에 가장 가까운 must_visit(밀도 중심)`으로 변경합니다.
> 이유: outlier를 seed로 선택하면 그 주변에 장소가 적어 한 날짜 클러스터가 비어 다른 날짜로 편중됩니다.

**알고리즘**:

1. **후보 풀**: `is_must_visit == true`인 장소 우선. 날짜 수보다 적으면 나머지 장소로 보충
2. **seed[0]**: 전체 후보 centroid에 **가장 가까운** 장소 (밀도 중심)
3. **seed[i]** (i ≥ 1): 기존 seed들까지의 min-distance가 **가장 큰** 장소 (최대 분산)

```python
def _select_seeds(places: list[dict], n_days: int) -> list[dict]:
    candidates = [p for p in places if p.get("is_must_visit")]
    if len(candidates) < n_days:
        candidates += [p for p in places if not p.get("is_must_visit")]
    if not candidates:
        return []

    centroid_lat = sum(p["lat"] for p in candidates) / len(candidates)
    centroid_lng = sum(p["lng"] for p in candidates) / len(candidates)

    # seed[0]: centroid에 가장 가까운 장소 (밀도 중심, outlier 방지)
    first_seed = min(
        candidates,
        key=lambda p: haversine_meters(centroid_lat, centroid_lng, p["lat"], p["lng"]),
    )
    seeds = [first_seed]
    remaining = [p for p in candidates if p["id"] != first_seed["id"]]

    # seed[1..n]: max-min-dist 최대 분산
    while len(seeds) < n_days and remaining:
        best = max(
            remaining,
            key=lambda p: min(
                haversine_meters(p["lat"], p["lng"], s["lat"], s["lng"])
                for s in seeds
            ),
        )
        seeds.append(best)
        remaining.remove(best)

    return seeds
```

#### 1-2. 나머지 장소 분배

각 비seed 장소를 가장 가까운 클러스터에 배정합니다.

**숙소 이중 제외**: `day_allocation_greedy` 호출 전에 숙소를 완전히 제외합니다.
- 1차: 카테고리 `"숙소"` 기준
- 2차: `stay_pinned_ids` 기준 (카테고리 필드 누락 방어)

```python
places_for_allocation = [
    p for p in valid_places
    if p.get("category") != "숙소"      # 1차: 카테고리 기준
    and p["id"] not in stay_pinned_ids  # 2차: 핀 기준
]
clusters = day_allocation_greedy(places_for_allocation, n_days)
```

**Hard cap (MAX_PLACES_PER_DAY)**:
- 클러스터 장소 수 ≥ `MAX_PLACES_PER_DAY(8)` → 해당 날짜 배정 불가 (절대 초과 금지)

**Soft cap (MAX_CATEGORY_PER_DAY)**:
- 해당 카테고리 수 ≥ `MAX_CATEGORY_PER_DAY[category]` → 해당 날짜 건너뜀
- **Deadlock 방지 3단계 시도**: 맛집만 10개 선택하는 등 특정 카테고리가 몰린 경우, 모든 날짜가 soft cap을 초과하면 deadlock 발생 가능 → 단계적으로 조건을 완화합니다.

**편중 방지**: 한 날짜 클러스터의 장소 수가 `평균 × 1.5`를 초과하면 배정 건너뜀

> **⚠️ v7 변경**: 기존 `avg + 1` → `avg * 1.5`로 완화.
> 이유: `avg + 1`은 너무 엄격해 지리적으로 인접한 장소도 강제 분산됩니다. 예를 들어 3일 여행에 10개 장소(avg=3.33)면 4개 이상 배정이 불가능해 인접 장소들이 쪼개집니다. 지리적 인접성(haversine)이 균형 분배보다 UX에 훨씬 중요합니다.

```python
avg = len(valid_places) / n_days
category = place.get("category", "")
cat_limit = MAX_CATEGORY_PER_DAY.get(category, 999)

def _try_assign(clusters, ignore_soft_cap=False, ignore_balance=False) -> int:
    best_day, best_dist = -1, float("inf")
    for day_idx, cluster in enumerate(clusters):
        if len(cluster) >= MAX_PLACES_PER_DAY:           # hard cap: 항상 적용
            continue
        if not ignore_balance and cluster and len(cluster) >= avg * 1.5:
            continue
        if not ignore_soft_cap:
            cat_count = sum(1 for p in cluster if p.get("category") == category)
            if cat_count >= cat_limit:
                continue
        dist = min(haversine_meters(...) for p in cluster) if cluster else 0.0
        if dist < best_dist:
            best_dist, best_day = dist, day_idx
    return best_day

# 1차 시도: 모든 cap + 편중 방지 적용
best_day = _try_assign(clusters)

# 2차 시도: soft cap 해제 (카테고리 쏠림 허용)
if best_day == -1:
    best_day = _try_assign(clusters, ignore_soft_cap=True)

# 3차 시도: soft cap + 편중 방지 모두 해제 (hard cap만 유지)
if best_day == -1:
    best_day = _try_assign(clusters, ignore_soft_cap=True, ignore_balance=True)

# 최후 fallback: hard cap도 한계에 다다른 경우 → 가장 적은 클러스터
if best_day == -1:
    best_day = min(range(n_days), key=lambda i: len(clusters[i]))

clusters[best_day].append(place)
```

---

### Step 2. anchor_extraction — 앵커 분리 및 분류

> `planner_agent.py` → `anchor_extraction()`

> **⚠️ v2 변경**: 기존 `anchor_placement` (앵커를 즉시 클러스터에 삽입)에서 `anchor_extraction` (앵커를 분리만 하고 삽입은 Step 3에서 수행)으로 변경합니다.
> 이유: RESERVATION을 올바른 시간 위치에 삽입하려면 TSP 정렬이 먼저 필요합니다.

**역할**: 클러스터에서 RESERVATION 핀과 STAY 핀을 분리하여 반환합니다.

```python
def anchor_extraction(
    cluster: list[dict],
    pins_for_date: list[dict],
    date: str,
    stay_place_for_date: dict | None = None,
) -> tuple[list[dict], list[tuple[str, dict]], list[dict]]:
    """클러스터에서 앵커를 분리한다.

    RESERVATION 앵커는 pins_for_date에서 추출.
    STAY 앵커는 stay_place_for_date로 직접 주입 (멀티박 지원, pinned_date 비교 불필요).

    Returns:
        free_places: 핀이 없는 자유 장소 목록
        reservation_anchors: [(pinned_time_str, place), ...] pinned_time 오름차순 정렬
        stay_anchors: [place, ...] (해당 날짜의 STAY 앵커, 최대 1개)
    """
    place_map = {p["id"]: p for p in cluster}
    reservation_anchors: list[tuple[str, dict]] = []
    anchor_ids: set[str] = set()

    # RESERVATION 앵커만 pins_for_date에서 추출
    for pin in pins_for_date:
        pid = pin.get("place_id")
        if pin.get("type") != "RESERVATION":
            continue
        place = place_map.get(pid)
        if place is None:
            continue
        tagged = {**place, "pin_type": "RESERVATION", "_pinned_time": pin.get("pinned_time")}
        reservation_anchors.append((pin.get("pinned_time", "09:00"), tagged))
        anchor_ids.add(pid)

    reservation_anchors.sort(key=lambda x: x[0])  # pinned_time 오름차순

    # STAY 앵커: stay_place_for_date로 직접 주입 (멀티박 정확 처리)
    if stay_place_for_date is not None:
        stay_anchors: list[dict] = [{**stay_place_for_date, "pin_type": "STAY"}]
        anchor_ids.add(stay_place_for_date["id"])
    else:
        stay_anchors = []

    # 불변 조건: 날짜당 STAY 앵커는 최대 1개
    assert len(stay_anchors) <= 1

    free_places = [p for p in cluster if p["id"] not in anchor_ids]
    return free_places, reservation_anchors, stay_anchors
```

> **⚠️ v6 변경**: STAY 앵커를 `pins_for_date`에서 직접 추출하는 방식에서 `stay_place_for_date` 파라미터로 주입하는 방식으로 변경.
> 이유: 멀티박(2박 이상) 숙소의 중간 날짜도 정확히 처리하기 위함. 기존 방식은 `pinned_date == date` 조건으로 체크인 날짜만 매핑했으나, 멀티박에서는 모든 체박 날짜에 숙소가 배치되어야 합니다.

---

### Step 3. route_ordering — TSP 정렬 + RESERVATION 시간 기반 삽입

> `planner_agent.py` → `route_ordering()`, `_nearest_neighbor_tsp()`, `_insert_reservations_by_time()`

> **⚠️ v2 변경**:
> 1. TSP 시작점으로 `prev_stay` 사용 (숙소 연속성)
> 2. RESERVATION을 맨 앞에 놓는 대신, 예상 타임라인에서 `pinned_time`에 해당하는 위치에 삽입
>
> **⚠️ v7 변경**:
> 3. `_nearest_neighbor_tsp`에 **동일 카테고리 연속 배치 방지** 로직 추가 (맛집·카페 한정, 생성 시 하드 제약)

**전체 흐름**:

```
free_places + reservation_anchors + stay_anchors
    │
    ├─ infer_day_start_time(free_places, reservation_anchors, prev_stay) → day_start_min
    │
    ├─ _nearest_neighbor_tsp(free_places, start_point) → tsp_ordered
    │     start_point = prev_stay 좌표 (있으면) / free_places centroid (없으면)
    │     ※ 맛집·카페 연속 배치 방지: 직전이 맛집이면 다음으로 맛집 선택 금지 (대안 없으면 허용)
    │
    ├─ _insert_reservations_by_time(tsp_ordered, reservation_anchors, day_start_min)
    │     → tsp_ordered에 RESERVATION을 올바른 시간 위치에 삽입
    │
    └─ + stay_anchors (맨 뒤)
    │
    → 최종 ordered list
```

#### 3-1. 하루 시작 시각 동적 결정 (`infer_day_start_time`)

> **⚠️ v2 변경**: 기존 09:00 고정에서 클러스터 구성에 따른 동적 결정으로 변경

```python
def infer_day_start_time(
    free_places: list[dict],
    reservation_anchors: list[tuple[str, dict]],
    prev_stay: dict | None,
) -> int:
    """하루 시작 시각(분)을 동적으로 결정한다.

    결정 우선순위:
    1. RESERVATION 핀이 존재하는 경우:
       첫 RESERVATION pinned_time에서 역산
       = max(480, first_res_min - free_count_before_res * avg_slot)
       avg_slot = 평균 체류(90) + 평균 이동(30) = 120분
    2. prev_stay 있음 (전날 숙소 존재):
       08:30 (510) — 체크아웃 후 출발
    3. free_places 첫 카테고리가 '맛집'만 존재:
       11:00 (660) — 점심 첫 장소
    4. 기본값:
       09:00 (540)
    """
    if reservation_anchors:
        first_res_min = to_mod_from_str(reservation_anchors[0][0])
        avg_slot = 120  # 체류 90 + 이동 30
        free_count = len(free_places)
        day_start = max(480, first_res_min - free_count * avg_slot)
        return day_start

    if prev_stay is not None:
        return 510  # 08:30

    categories = {p.get("category") for p in free_places}
    if categories == {"맛집"}:
        return 660  # 11:00

    return 540  # 09:00
```

#### 3-2. TSP 시작점 결정

```python
# prev_stay가 있으면 그 좌표에서 TSP 시작 (숙소 연속성)
if prev_stay is not None:
    start_lat, start_lng = prev_stay["lat"], prev_stay["lng"]
elif free_places:
    # centroid 기준 (outlier 방지)
    start_lat = sum(p["lat"] for p in free_places) / len(free_places)
    start_lng = sum(p["lng"] for p in free_places) / len(free_places)
else:
    start_lat, start_lng = 0.0, 0.0
```

#### 3-3. `_nearest_neighbor_tsp` — 동일 카테고리 연속 방지 (v7 신규)

> **⚠️ v7 변경**: 맛집·카페 카테고리에 한해 **연속 동일 카테고리 배치를 생성 시 방지**합니다.
> - 일정 생성 단계에서의 하드 제약 (사용자 수동 조정 시에는 적용 안 됨)
> - 허용 패턴: 맛집→카페, 카페→맛집, 관광지→맛집, 맛집→관광지 등 이종 카테고리 전환
> - 금지 패턴: 맛집→맛집, 카페→카페
> - **대안 없으면 허용**: 남은 장소가 모두 같은 카테고리일 때는 최근접 장소 선택 (fallback)

```python
# 연속 배치 제한 대상 카테고리
CONSECUTIVE_RESTRICTED = {"맛집", "카페"}

def _nearest_neighbor_tsp(
    free_places: list[dict],
    start_lat: float,
    start_lng: float,
) -> list[dict]:
    """haversine 기반 nearest-neighbor TSP.

    맛집·카페 카테고리는 동일 카테고리 연속 배치를 방지한다.
    1순위: 직전 카테고리와 다른 카테고리 중 최근접
    2순위: 대안 없으면 (모두 동일 카테고리) → 전체 중 최근접 (fallback)
    """
    remaining = list(free_places)
    ordered = []
    cur_lat, cur_lng = start_lat, start_lng
    prev_category: str | None = None

    while remaining:
        # 직전 장소가 제한 카테고리면 다른 카테고리 후보 우선 탐색
        if prev_category in CONSECUTIVE_RESTRICTED:
            candidates = [p for p in remaining if p.get("category") != prev_category]
        else:
            candidates = remaining

        # 대안 없으면 전체 remaining으로 fallback
        if not candidates:
            candidates = remaining

        nearest = min(
            candidates,
            key=lambda p: haversine_meters(cur_lat, cur_lng, p["lat"], p["lng"]),
        )
        ordered.append(nearest)
        cur_lat, cur_lng = nearest["lat"], nearest["lng"]
        prev_category = nearest.get("category")
        remaining.remove(nearest)

    return ordered
```

**동작 예시**:

| remaining | prev_category | candidates | 선택 |
|-----------|---------------|------------|------|
| [맛집A, 카페B, 관광지C] | `"맛집"` | [카페B, 관광지C] | 가장 가까운 비맛집 |
| [맛집A, 맛집B, 맛집C] | `"맛집"` | [] → fallback → [맛집A, 맛집B, 맛집C] | 가장 가까운 맛집 |
| [맛집A, 카페B] | `"카페"` | [맛집A] | 맛집A |
| [관광지A, 맛집B] | `"관광지"` | [관광지A, 맛집B] (제한 카테고리 아님) | 가장 가까운 곳 |

> **RESERVATION 앵커 예외**: RESERVATION 핀은 `_insert_reservations_by_time`에서 타임라인 시뮬레이션으로 삽입되므로 이 제약의 적용 대상이 아닙니다. 다만 발생 빈도가 낮고, 예약 시간이 고정되어 사실상 사용자가 인지한 상태입니다.

#### 3-4. RESERVATION 시간 기반 삽입 (`_insert_reservations_by_time`)

> **⚠️ v3 변경**: 기존 rough est_times(이동 30분 고정 추정) 방식 → **실제 타임라인 시뮬레이션** 방식으로 변경
>
> **문제**: 이전 방식은 삽입 후 `t`를 갱신하지 않아 예약 이후 장소들의 위치가 어긋났습니다.  
> **해결**: `t`를 순차적으로 진행시키며, RESERVATION 삽입 후 반드시 `t = res_time + res_stay`로 갱신합니다.

```python
def _insert_reservations_by_time(
    tsp_ordered: list[dict],
    reservation_anchors: list[tuple[str, dict]],  # pinned_time 오름차순
    day_start_min: int,
    n_places_today: int,
) -> list[dict]:
    """TSP 정렬된 자유 장소에 RESERVATION을 실제 타임라인 시뮬레이션 기반으로 삽입한다.

    t(현재 진행 시각)를 실시간으로 추적하며, t가 예약 시각에 도달하면
    예약을 먼저 삽입하고 t를 예약 종료 시각으로 갱신합니다.
    이를 통해 예약 이후 자유 장소들이 올바른 시간 위치에 배치됩니다.

    Args:
        n_places_today: 당일 총 장소 수 (get_stay_duration용)

    예시:
      tsp_ordered = [관광지A, 카페B, 박물관C], reservation = ("12:30", 식당D)
      day_start_min = 540

      시뮬레이션:
        t=540  → 관광지A 배치, stay=90 → t=540+90+15=645
        t=645  → 카페B 배치,  stay=60 → t=645+60+15=720
        t=720  → t(720) >= 예약(750=12:30)? No → 박물관C 배치, stay=90 → t=825
        t=825  → t(825) >= 예약(750)?  Yes → 식당D 삽입, t = 750+90+15=855
        (반복 없음)
        결과: [관광지A, 카페B, 박물관C, 식당D]

      ※ 삽입 후 t 갱신이 핵심: 식당D 이후 장소들은 855분부터 시작됨
    """
    result: list[dict] = []
    res_idx = 0
    t = day_start_min
    AVG_TRAVEL_EST = 15  # route_matrix 없는 시점의 rough 이동 추정 (분)

    for place in tsp_ordered:
        stay = get_stay_duration(place.get("category", "관광지"), n_places_today)

        # 현재 t 기준으로 예약 시각에 도달했으면 예약 먼저 삽입
        while res_idx < len(reservation_anchors):
            res_time_min = to_mod_from_str(reservation_anchors[res_idx][0])
            if t >= res_time_min:
                res_place = reservation_anchors[res_idx][1]
                result.append(res_place)
                res_stay = get_stay_duration(
                    res_place.get("category", "맛집"), n_places_today
                )
                # ✅ 핵심: 삽입 후 t를 예약 종료 시각으로 갱신
                # (res_time_min 기준 — 실제 배치는 timeline_validation에서 pinned_time 사용)
                t = res_time_min + res_stay + AVG_TRAVEL_EST
                res_idx += 1
            else:
                break

        result.append(place)
        t += stay + AVG_TRAVEL_EST

    # 남은 예약 (모든 자유 장소보다 늦은 시간대)
    for _, res_place in reservation_anchors[res_idx:]:
        result.append(res_place)

    return result
```

**최종 순서**:
```
[TSP 정렬된 자유 장소들 (RESERVATION이 올바른 위치에 삽입됨)] + [STAY 앵커]
```

---

### Step 4. build_route_matrix — Kakao Mobility 이동시간 선계산

> `planner_agent.py` → `build_route_matrix()`, `_haversine_fallback_travel()`

> **⚠️ v2 변경**:
> 1. 이동시간 fallback: 30분 고정 → haversine 기반 동적 계산
> 2. LRU 캐시 추가: MOVED 발생 시 동일 장소 쌍 재호출 방지

#### 4-1. Haversine 기반 Fallback

```python
def _haversine_fallback_travel(p_i: dict, p_j: dict) -> int:
    """Kakao Mobility 실패 시 haversine 거리 기반 이동시간 추정.

    도심 평균 속도 약 20km/h 가정: 거리(km) × 3분/km
    최솟값 5분 보장 (이웃 장소도 최소 이동 시간 존재)

    예:
      2km → max(5, int(2 * 3)) = 6분
      10km → max(5, int(10 * 3)) = 30분
    """
    dist_m = haversine_meters(p_i["lat"], p_i["lng"], p_j["lat"], p_j["lng"])
    dist_km = dist_m / 1000
    return max(MIN_TRAVEL_MIN, int(dist_km * 3))
```

#### 4-2. Rate Limit 방어 — Semaphore

> **⚠️ v3 신규**: 병렬 API 호출이 많아지면 Kakao Mobility 429(Too Many Requests) 오류 발생 가능.
> 모듈 레벨 Semaphore로 동시 요청 수를 10개로 제한합니다.

```python
# planner_agent.py 모듈 레벨
_ROUTE_SEMAPHORE = asyncio.Semaphore(10)
```

#### 4-3. LRU 캐시

모듈 레벨 딕셔너리로 구현합니다. (place_id pair → 이동시간(분))
MOVED 발생 시 동일 장소 쌍 재호출을 방지하며, Semaphore와 함께 사용합니다.

```python
# planner_agent.py 모듈 레벨
_ROUTE_CACHE: dict[tuple[str, str], int] = {}
```

```python
async def _fetch_with_cache(p_i: dict, p_j: dict) -> tuple[tuple[str, str], int]:
    key = (p_i["id"], p_j["id"])

    # 1차: 캐시 히트 (Semaphore 획득 없이 즉시 반환)
    if key in _ROUTE_CACHE:
        return key, _ROUTE_CACHE[key]

    # 2차: API 호출 (동시 요청 수 10개 제한)
    async with _ROUTE_SEMAPHORE:
        # Double-check: 병렬 요청 중 다른 코루틴이 캐시를 채웠을 수 있음
        if key in _ROUTE_CACHE:
            return key, _ROUTE_CACHE[key]
        try:
            duration = await get_travel_time(
                origin_lat=float(p_i["lat"]), origin_lng=float(p_i["lng"]),
                dest_lat=float(p_j["lat"]),  dest_lng=float(p_j["lng"]),
                origin_name=p_i.get("name", ""), origin_id=p_i.get("id", ""),
                dest_name=p_j.get("name", ""),   dest_id=p_j.get("id", ""),
            )
        except Exception:
            duration = _haversine_fallback_travel(p_i, p_j)

    _ROUTE_CACHE[key] = duration
    return key, duration
```

#### 4-4. 전체 선계산

- **전체 날짜를 병렬로** `asyncio.gather` 실행
- 각 날짜 내에서는 **인접 쌍(i → i+1)만** 계산
- `asyncio.gather` 결과 중 Exception이면 → `_haversine_fallback_travel` 적용

```
예) 하루 일정: [A, B, C, D]
  계산하는 쌍: A→B, B→C, C→D  (총 3번 API 호출 or 캐시 히트, 최대 10개 동시)
```

#### 4-5. MOVED/SHIFT 이후 누락된 쌍 처리

MOVED나 SHIFT로 장소 순서가 바뀌면 route_matrix에 없는 (prev_id, curr_id) 쌍이 생깁니다.
이를 Lazy Recalculation으로 처리합니다: timeline_validation 내에서 키 미스 시 즉시 haversine fallback 사용.

```python
# timeline_validation 내 이동시간 조회
travel = route_matrix.get((prev_id, place["id"]))
if travel is None:
    # MOVE/SHIFT로 새 인접 쌍 발생 → haversine fallback (lazy)
    travel = _haversine_fallback_travel(prev_place_dict, place)

# ※ prev_place_dict를 유지하기 위해 timeline_validation 루프에서
#   prev_place 변수를 별도 추적해야 합니다.
```

---

### Step 5. timeline_validation — 타임라인 생성 및 충돌 해결

> `planner_agent.py` → `timeline_validation()`, `_check_hours_fit()`, `_try_shift_later()`, `_next_meal_slot_start()`, `_find_best_day()`

> **⚠️ v2 변경**:
> 1. 시작 시각: 09:00 고정 → `infer_day_start_time` 결과 사용
> 2. 체류 시간: 고정 → `get_stay_duration(category, n_places_today)` 동적 계산
> 3. 맛집 식사 시간대 정렬: 배치 전 점심/저녁 슬롯으로 시각 보정
> 4. 충돌 해결: 2단계(이동→제거) → 3단계(시프트→이동→제거)

#### 5-1. 시각 배정 방식

```
# ✅ prev_place 초기화: 첫 이동시간 계산 기준점을 전날 숙소로 설정
prev_place = prev_stay_map[day_idx]  # None이면 첫 장소에서 travel=0 처리
prev_id    = prev_place["id"] if prev_place else None
start_min  = infer_day_start_time(...)  # 동적 시작 시각

for each place:
  stay = get_stay_duration(category, n_places_today)

  # RESERVATION 핀: pinned_time으로 시작 시각 고정 + 늦게 도착 감지
  if pin_type == "RESERVATION" and _pinned_time:
      res_time = to_mod_from_str(_pinned_time)

      if start_min > res_time + RESERVATION_TOLERANCE:
          # 현재 타임라인이 예약 시각을 초과 → 예약 지각 처리
          # ⚠️ v7: 맛집 RESERVATION은 허용 지각 폭을 15분으로 강화 (노쇼 방지)
          late_max = (
              RESERVATION_LATE_SHIFT_MAX_RESTAURANT
              if place.get("category") == "맛집"
              else RESERVATION_LATE_SHIFT_MAX
          )
          if start_min - res_time <= late_max:
              # 예약 시각을 앞으로 당겨 현재 start_min 기준 배치 (LATE_WARNING)
              place = {**place, "place_warning": {
                  "warning_type": "RESERVATION_LATE",
                  "warning_message": (
                      f"예약 시각({from_mod(res_time)})보다 "
                      f"{start_min - res_time}분 늦게 도착이 예상됩니다. "
                      "실제 방문 전 확인을 권장합니다."
                  ),
              }}
              # start_min은 현재 그대로 유지 (밀린 일정 반영)
          else:
              # 지각 폭이 너무 크면 MOVED or REMOVED
              repair_conflict(reason="reservation_overflow")
      else:
          start_min = res_time  # 정상: 예약 시각으로 고정

  # 맛집: 식사 시간대로 시각 보정 (RESERVATION 제외, gap ≤ MAX_MEAL_JUMP_MIN)
  elif category == "맛집" and pin_type is None:
      adjusted = _next_meal_slot_start(start_min)
      if adjusted is not None:
          start_min = adjusted  # 식사 슬롯 전이면 점프(gap ≤ 60분), 슬롯 내면 유지

  end_min = start_min + stay

  # 이동시간: route_matrix 우선, 키 미스 시 haversine fallback (lazy recalculation)
  if prev_id is not None:
      travel = route_matrix.get((prev_id, place["id"]))
      if travel is None:
          travel = _haversine_fallback_travel(prev_place, place)
  else:
      travel = 0

  # 충돌 검사: 운영시간 위반 OR 하루 종료 시각(21:00) 초과
  hours_ok = _check_hours_fit(start_min, end_min, place, weekday)
  day_ok   = end_min <= MAX_DAY_END

  if not hours_ok or not day_ok:
      repair_conflict(reason="hours" if not hours_ok else "day_overflow")

  # 다음 장소
  prev_id    = place["id"]
  prev_place = place  # haversine fallback용
  start_min  = end_min + travel
```

**⚠️ prev_place 초기화 (v4 버그 수정)**:  
기존에는 `prev_place = None`, `prev_id = None`으로 루프 전체를 시작했습니다. 그 결과 첫 번째 장소의 이동시간이 항상 0이 되어, 전날 숙소에서 첫 장소까지의 이동 시간이 누락됩니다.  
`prev_place = prev_stay_map[day_idx]`로 초기화하면 전날 숙소가 존재하는 날(Day 2+)에는 첫 장소까지의 이동시간도 정확히 계산됩니다.

**⚠️ RESERVATION 늦게 도착 감지 (v4 신규)**:  
삽입 순서는 `_insert_reservations_by_time`에서 결정되지만, 실제 timeline에서 `start_min`이 예약 시각을 초과할 수 있습니다(앞 일정 지연 누적 등). 이를 `RESERVATION_TOLERANCE`로 감지합니다.

**MAX_DAY_END 초과 처리 (v3)**:  
`end_min > MAX_DAY_END(21:00)` 인 경우도 운영시간 충돌과 동일한 3단계 repair_conflict를 실행합니다.

**SHIFT/MOVED 이후 이동시간 재계산**:  
route_matrix는 초기 정렬 기준으로 선계산된 값입니다. SHIFT 또는 MOVED로 순서가 바뀐 경우, 새로운 (prev_id, curr_id) 쌍은 matrix에 없습니다. 이때 `_haversine_fallback_travel`을 통해 lazy하게 재계산합니다. 별도의 async API 재호출은 없습니다.

#### 5-2. 맛집 식사 시간대 보정 (`_next_meal_slot_start`)

> **⚠️ v3 변경**: 점프 거리(gap) 제한 추가.
> 기존에는 gap에 관계없이 무조건 점프했으나, 최대 `MAX_MEAL_JUMP_MIN(60분)` 이내일 때만 점프합니다.
> 이유: 09:00에 맛집을 만났을 때 2시간 뒤 점심 시간까지 무작정 기다리면 앞 일정이 비어 UX가 나빠집니다.

```python
def _next_meal_slot_start(current_min: int) -> int | None:
    """현재 시각 기준 점프 가능한 가장 가까운 식사 시작 시각을 반환한다.

    gap(= target - current_min)이 MAX_MEAL_JUMP_MIN(60분) 이하일 때만 점프.
    이미 식사 창 내에 있으면 current_min 그대로 반환 (gap=0).

    MEAL_WINDOWS = [(660, 870), (1020, 1230)]
      LUNCH:  11:00~14:30
      DINNER: 17:00~20:30

    예:
      current_min=615 (10:15) → gap=45 ≤ 60 → return 660 (LUNCH 점프)
      current_min=540 (09:00) → gap=120 > 60 → None (일반 배치)
      current_min=720 (12:00) → 이미 LUNCH 내 → return 720 (그대로)
      current_min=980 (16:20) → gap=40 ≤ 60  → return 1020 (DINNER 점프)
      current_min=900 (15:00) → gap=120 > 60 → None (일반 배치)
      current_min=1250 (20:50) → 두 창 모두 지남 → None
    """
    for window_start, window_end in MEAL_WINDOWS:
        if current_min <= window_end:         # 이 창이 아직 닫히지 않음
            target = max(current_min, window_start)
            gap = target - current_min
            if gap <= MAX_MEAL_JUMP_MIN:
                return target                 # 점프 허용
            # gap 초과 → 다음 창 확인 (다음 창은 더 멀므로 대부분 None)
    return None
```

> **주의**: 맛집이 식사 시간대로 점프하면 직전 장소와의 gap(대기 시간)이 발생합니다.
> 이 gap은 `travel_minutes_from_prev`에 반영되지 않으며 별도로 표시하지 않습니다.

#### 5-3. 운영시간 충돌 검사 (`_check_hours_fit`)

```python
def _check_hours_fit(start_min: int, end_min: int, place: dict, weekday: int) -> bool:
    """방문 시간대(start_min ~ end_min)가 운영시간 슬롯 안에 완전히 포함되면 True."""
    slots = place.get("opening_hours", {}).get(str(weekday), [])
    if not slots:
        return True  # soft-pass (숙소 등 항상 접근 가능)

    for slot in slots:
        open_m, close_m = normalize_slot(slot[0], slot[1])
        if start_min >= open_m and end_min <= close_m:
            return True

    return False
```

#### 5-4. Order Warning — 맛집 3시간 간격 경고 (SOFT_CONSTRAINT)

> **⚠️ v7 신규 (수정)**: 맛집·카페의 **연속 동일 카테고리 배치는 Step 3 TSP에서 생성 시 하드 제약으로 방지**합니다. (Step 3-3 참조)
> Step 5에서는 TSP로 방지할 수 없는 케이스(RESERVATION 앵커 삽입 등)에서 발생하는 **맛집 3시간 미만 간격**만 SOFT_CONSTRAINT 경고로 처리합니다.
>
> **사용자 수동 조정 허용**: 프론트엔드 결과 화면에서 사용자가 직접 순서를 바꿀 경우 이 제약은 적용되지 않습니다.

**검증 규칙**:

| 규칙 | 조건 | 경고 타입 | 처리 방식 |
|------|------|-----------|-----------|
| ~~동일 카테고리 연속~~ | ~~직전 장소와 같은 카테고리~~ | ~~`CONSECUTIVE_SAME_CATEGORY`~~ | ~~Step 3 TSP에서 방지~~ |
| 맛집 간격 부족 | 직전 맛집 종료 후 < 180분(3시간) | `RESTAURANT_TOO_CLOSE` | 경고만 부여 (SOFT) |

**적용 위치**: `timeline_validation` 내 각 장소 배치 완료 직후 실행합니다.

```python
def _check_order_warning(
    place: dict,
    last_restaurant_end_min: int | None,
    current_start_min: int,
) -> dict | None:
    """맛집 방문 간격 위반을 감지해 place_warning을 반환한다.

    SOFT_CONSTRAINT: 일정 제거/이동 없이 경고만 부여.
    이미 place_warning이 있으면 덮어쓰지 않음 (충돌 경고 우선).

    Returns:
        경고 딕셔너리 또는 None
    """
    category = place.get("category", "")

    # 맛집 간격 부족 (RESERVATION 앵커 삽입으로 인한 케이스 포함)
    if category == "맛집" and last_restaurant_end_min is not None:
        gap = current_start_min - last_restaurant_end_min
        if gap < 180:
            return {
                "warning_type": "RESTAURANT_TOO_CLOSE",
                "warning_message": (
                    f"직전 맛집 방문 종료 후 {gap}분 만에 다음 맛집이 배치됩니다. "
                    "최소 3시간 간격을 권장합니다."
                ),
            }

    return None

# 루프 외부 초기화
last_restaurant_end_min: int | None = None

# 루프 내 result.append() 직전
order_warn = _check_order_warning(place, last_restaurant_end_min, start_min)
if order_warn and not place.get("place_warning"):  # 기존 경고 없을 때만 부여
    place = {**place, "place_warning": order_warn}

# result.append() 후 추적 변수 갱신
if category == "맛집":
    last_restaurant_end_min = end_min
```

> **STAY 앵커 예외**: `pin_type == "STAY"`인 장소는 Order Warning 검사에서 제외합니다.

---

#### 5-5. 충돌 해결 — 3단계 (`repair_conflict`)

> **⚠️ v2 변경**: 기존 "이동 → 제거" 2단계에서 "시프트 → 이동 → 제거" 3단계로 변경

```
충돌 발생 시 처리 우선순위:

1. is_must_visit == true
   → KEEP_WITH_WARNING: 일정에 포함, place_warning 태깅
   → 이후 단계 진행 없음

2. place_id ∈ moved_place_ids (이미 이동된 장소)
   → REMOVED: 재충돌이므로 즉시 제거 (핑퐁 방지)
   → 이후 단계 진행 없음

3. _try_shift_later(place, current_start_min, weekday) 성공
   → SHIFTED: start_min을 반환값으로 업데이트하고 현재 날에 배치
   → 이후 장소들도 연쇄적으로 뒤로 밀림

4. _find_best_day(...) 성공 + 대상 날 운영시간 여유 있음
   → MOVED: all_day_plans[best_day]에 추가, moved_place_ids에 등록

5. (이동 불가 또는 대상 날도 초과 예상)
   → REMOVED: excluded_places에 추가
```

**`_try_shift_later` 구현**:

```python
def _try_shift_later(place: dict, current_start_min: int, weekday: int) -> int | None:
    """현재 시각 이후에 운영시간 내에서 방문 가능한 가장 이른 시각을 찾는다.

    Args:
        place: 장소 딕셔너리 (opening_hours 포함)
        current_start_min: 현재 배정 시작 시각(분)
        weekday: 요일 (Python 기준, 0=월)

    Returns:
        방문 가능한 새 시작 시각(분).
        없으면 None.

    제약:
        - 새 시작 시각 >= current_start_min (과거 이동 불가)
        - 새 시작 시각 + 체류 시간 <= MAX_DAY_END (21:00)
    """
    slots = place.get("opening_hours", {}).get(str(weekday), [])
    n_places = len(place.get("_day_context_n_places", [1]))  # 호출 시 주입
    stay_dur = get_stay_duration(place.get("category", "관광지"), n_places)

    for slot in slots:
        open_m, close_m = normalize_slot(slot[0], slot[1])
        candidate_start = max(current_start_min, open_m)
        if candidate_start + stay_dur <= close_m and candidate_start + stay_dur <= MAX_DAY_END:
            return candidate_start

    return None
```

> **SHIFTED 처리 시 유의사항**: `start_min`이 앞당겨지거나 뒤로 밀리면 이후 장소들도 연쇄 이동합니다.
> `timeline_validation`은 순차 루프로 동작하므로 SHIFTED 후 `start_min`을 갱신하면 자연스럽게 연쇄 적용됩니다.

**`_find_best_day` 기준 (unchanged)**:

1. 장소 수 < `MAX_PLACES_PER_DAY(8)` 인 날짜만 후보
2. RESERVATION/STAY 앵커가 있고 장소 수 ≥ 6인 날짜 제외
3. 현재 장소와 haversine 평균 거리 최소 날짜 선택

---

## 전체 처리 흐름

```
valid_places + travel_dates + schedule_pins (입력)
    │
    ▼
[전처리] STAY 시작점 맵 구성
    └─ prev_stay_map[day_idx] = 전날 STAY 장소 (다음 날 TSP 시작점)
    │
    ▼
[Step 1: day_allocation_greedy]
    ├─ seed[0] = must_visit 중 centroid 최근접 (밀도 중심)
    ├─ seed[1..n] = max-min-dist 최대 분산
    ├─ hard cap: MAX_PLACES_PER_DAY = 8
    ├─ soft cap: MAX_CATEGORY_PER_DAY = {카페:2, 맛집:2}
    └─ 나머지 → haversine 최근접 날짜에 배정
    │
    ▼
clusters = [[Day1 장소들], [Day2 장소들], ...]
    │
    ▼
[Step 2: anchor_extraction] (날짜별)
    ├─ RESERVATION 핀 → 추출, pinned_time 오름차순 정렬
    └─ STAY 핀 → 추출 (해당 날짜의 체크인)
    │
    ▼
(free_places, reservation_anchors, stay_anchors) per day
    │
    ▼
[Step 3: route_ordering] (날짜별)
    ├─ infer_day_start_time() → day_start_min (동적 시작 시각)
    ├─ TSP start_point = prev_stay 좌표 (없으면 centroid)
    ├─ _nearest_neighbor_tsp(free_places, start_point) → tsp_ordered
    ├─ _insert_reservations_by_time(tsp_ordered, reservation_anchors, day_start_min)
    └─ + stay_anchors (맨 뒤)
    │
    ▼
ordered_clusters = [[Day1 정렬], [Day2 정렬], ...]
    │
    ▼
[Step 4: build_route_matrix] ← asyncio.gather (병렬)
    ├─ Semaphore(10): 동시 API 호출 최대 10개 제한 (429 방어)
    ├─ 캐시 히트 → _ROUTE_CACHE에서 즉시 반환 (double-check)
    ├─ 캐시 미스 → Kakao Mobility API 호출
    └─ API 실패 → _haversine_fallback_travel() = max(5, int(km * 3))
    │
    ▼
route_matrices = [{(id_a, id_b): 분, ...}, ...]
    │
    ▼
[Step 5: timeline_validation] (날짜별, moved_place_ids 전 날짜 공유)
    ├─ start_min = infer_day_start_time 결과
    ├─ 체류 시간 = get_stay_duration(category, n_places_today) (동적)
    ├─ 맛집 배치 시 → _next_meal_slot_start(gap ≤ 60분)으로 식사 시간대 보정
    ├─ RESERVATION 핀 → pinned_time으로 start_min 고정
    ├─ 이동시간: route_matrix 우선, 키 미스 → _haversine_fallback_travel (lazy)
    ├─ 충돌 조건: 운영시간 위반 OR end_min > MAX_DAY_END(21:00)
    ├─ 충돌 시 3단계 repair_conflict:
    │   ├─ is_must_visit → KEEP_WITH_WARNING
    │   ├─ 이미 이동됨 → REMOVED
    │   ├─ _try_shift_later() 성공 → SHIFTED (연쇄 밀림)
    │   ├─ _find_best_day() 성공 → MOVED
    │   └─ → REMOVED
    └─ excluded_places 누적
    │
    ▼
days (ordered_places 포함) + excluded_places (출력)
```

---

## Fallback 정책

| 상황 | 동작 |
|------|------|
| `KAKAO_MOBILITY_API_KEY` 미설정 또는 API 호출 실패 | `_haversine_fallback_travel()` — `max(5, int(km * 3))` 분 |
| `route_matrix` 전체 빌드 실패 (Exception) | 해당 날짜 모든 구간에 `_haversine_fallback_travel()` 적용 |
| MOVE/SHIFT 후 route_matrix 키 미스 | `_haversine_fallback_travel(prev_place, curr_place)` — lazy recalculation |
| Kakao Mobility API 429 (Too Many Requests) | `_ROUTE_SEMAPHORE(10)` 으로 사전 방어. 그래도 실패 시 haversine fallback |
| `_try_shift_later()` 실패 (당일 운영시간 내 맞는 슬롯 없음) | `_find_best_day()` 단계로 진행 |
| `_find_best_day()` 실패 (이동 가능한 날 없음) | `excluded_places`에 추가 |
| `day_allocation_greedy` soft cap deadlock (카테고리 쏠림) | 3단계 시도: soft cap 해제 → 편중 방지 해제 → hard cap만 유지 |
| 맛집 식사 슬롯 점프 gap > MAX_MEAL_JUMP_MIN(60분) | 점프 안 함, 현재 시각 그대로 배치 |
| RESERVATION 지각, 폭 ≤ RESERVATION_LATE_SHIFT_MAX (일반 30분 / 맛집 15분) | 현재 start_min으로 배치 + `RESERVATION_LATE` 경고 태깅 |
| RESERVATION 지각, 폭 > RESERVATION_LATE_SHIFT_MAX (일반 30분 / 맛집 15분) | repair_conflict → MOVED or REMOVED |
| 맛집·카페 동일 카테고리 연속 배치 (free_places) | Step 3 TSP에서 다른 카테고리 우선 선택으로 방지. 대안 없으면 최근접 선택 (fallback) |
| 맛집 간격 < 3시간 (RESERVATION 앵커 등) | `RESTAURANT_TOO_CLOSE` 경고 태깅 (SOFT_CONSTRAINT, 제거 없음) |

---

## 미구현 / 추후 검토 항목 (Nice to Have)

| 항목 | 내용 |
|------|------|
| Overnight 출력 포맷 | `end_at >= "24:00"` 시 "익일 HH:MM" 표기. 프론트엔드 포맷 협의 후 `from_mod_overnight()` 추가 |

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/agents/planner_agent.py` | Planner Agent 메인 로직 (5단계 파이프라인) |
| `backend/agents/time_utils.py` | 거리 계산, 시간 변환, 상수 정의 (`STAY_DURATION_RANGE`, `MEAL_WINDOWS`, `MAX_PLACES_PER_DAY` 등) |
| `backend/services/kakao.py` | Kakao Mobility API 이동시간 계산 (`get_travel_time`) |
| `backend/agents/state.py` | LangGraph State 구조 정의 (`ItineraryState`) |
| `backend/agents/pipeline.py` | LangGraph 파이프라인 구성 (노드 연결) |
| `backend/core/config.py` | API 키 등 환경 설정 |

---

## 변경 이력

| 버전 | 변경 내용 |
|------|-----------|
| v1 | LLM 기반 일정 생성 |
| v2 | LLM 제거, haversine 그리디 클러스터링 + nearest-neighbor TSP + Kakao Mobility route_matrix 선계산 + repair_conflict 단방향 이동 정책 |
| v3 | [🔴] haversine fallback 공식 도입 (`max(5, km*3)`), RESERVATION 시간 기반 삽입, STAY 숙소 연속성(prev_stay TSP 시작점), 3단계 충돌 해결 (`shift→move→remove`) / [🟠] seed[0] 밀도 중심 변경, 시작 시각 동적화 (`infer_day_start_time`), 맛집 식사 시간대 슬롯 (`MEAL_WINDOWS`), `MAX_PLACES_PER_DAY=8` + `MAX_CATEGORY_PER_DAY` 도입, LRU route 캐시 (`_ROUTE_CACHE`), 체류 시간 범위화 (`STAY_DURATION_RANGE` + `get_stay_duration`) |
| v4 | [🔴] RESERVATION 삽입 → 실제 타임라인 시뮬레이션으로 변경 (`_insert_reservations_by_time` 내 `t` 실시간 갱신), SHIFT/MOVE 이후 이동시간 lazy recalculation (`prev_place` 추적 + haversine fallback), `MAX_DAY_END` 초과 조건 충돌 검사에 추가, Kakao Mobility Semaphore(10) 추가 (`_ROUTE_SEMAPHORE`) / [🟠] `_next_meal_slot_start` 점프 gap 제한 (`MAX_MEAL_JUMP_MIN=60`), `day_allocation_greedy` deadlock 방지 3단계 시도 (soft cap → 편중 방지 → hard cap only) |
| v5 | [🔴] RESERVATION 지각 감지 추가: `RESERVATION_TOLERANCE(10분)` 이내 정상 고정, 10~30분 지각 → `RESERVATION_LATE` 경고 태깅 후 밀린 시각 배치, 30분 초과 → repair_conflict / `prev_place` 초기화 버그 수정: 루프 전 `prev_place = prev_stay_map[day_idx]`로 설정하여 Day 2+ 첫 이동시간 정확히 계산 |
| v6 | [🔴] **멀티박 숙소 지원**: `stay_for_date` 구성을 `checkin~checkout` 전체 날짜 범위로 확장 (`checkout_date` 활용), 동일 날짜 숙소 중복 → `ValueError` / **`anchor_extraction` 리팩터링**: `stay_place_for_date` 파라미터 직접 주입으로 STAY 앵커 처리 분리 / **숙소 이중 제외**: `stay_pinned_ids` 기반 카테고리+핀 이중 방어, STAY 핀 없는 숙소 → `excluded_places` 이동 / [🟠] **STAY 앵커 출력 필드 추가**: `end_at: null`, `affects_time: false`, `duration: 0` / **같은 날 중복 장소 감지**: `seen_place_ids` set으로 동일 place_id 재배치 방지 |
| v7 | [🔴] **편중 방지 완화**: `avg + 1` → `avg * 1.5` (지리적 인접성 우선, 강제 분산 방지) / **STAY 앵커 `end_at` 명시화**: `null` → `"21:00"` (프론트엔드 렌더링 에러 방지, 데이터 일관성) / **맛집 RESERVATION 지각 허용폭 강화**: 카테고리 분기 추가 — 맛집은 15분, 일반 장소는 30분 (`RESERVATION_LATE_SHIFT_MAX_RESTAURANT = 15`) / **맛집·카페 연속 배치 방지 (생성 시 하드 제약)**: `_nearest_neighbor_tsp`에 `CONSECUTIVE_RESTRICTED` 로직 추가 — 직전이 맛집/카페면 다른 카테고리 우선 선택, 대안 없으면 fallback 허용. 사용자 수동 조정 시에는 미적용 / [🟢] **Order Warning 신규**: `_check_order_warning()` — 맛집 3시간 미만 간격(`RESTAURANT_TOO_CLOSE`) SOFT_CONSTRAINT 경고 (동일 카테고리 연속은 TSP 하드 제약으로 대체) |
