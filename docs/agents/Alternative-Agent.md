# Alternative Agent

> **파일**: `backend/agents/alternative_agent.py`
> **역할**: Planner Agent가 확정한 일정의 각 장소에 대해 플랜 B/C(대안 장소)를 탐색합니다.

---

## 설계 원칙

- **Hybrid 탐색**: 위시리스트 내부 후보 우선 → 부족하면 Kakao API 외부 탐색으로 보완
- **순차 실행**: `asyncio.gather` 미사용. `used_alt_ids` 전역 공유로 race condition 방지
- **가변 반경 확장**: 외부 탐색 시 500m → 1km → 2km 순서로 반경을 넓혀가며 탐색
- **스코어링 기반 정렬**: 거리만으로 선택하지 않음. `거리 + 시간 적합도 + 카테고리 일치도`로 통합 점수 산정
- **중복 추천 방지**: 메인 일정 장소와 이미 선정된 대안을 `used_alt_ids_by_day`(날짜별)로 관리
- **다양성 확보**: alt1은 동일 카테고리, alt2는 유사/인접 카테고리로 구성
- **출처 표시**: 각 대안에 `source` 필드(`INTERNAL` / `EXTERNAL`) 포함
- **맛집 세부 필터**: `category_name`(Kakao 상세 분류)으로 cuisine 타입 부스팅
- **내부 후보 거리 소프트 제한**: 하드 컷 대신 `MAX_INTERNAL_RADIUS = 7000m` 가드 + 스코어링으로 거리 반영. 7km 이내 후보가 없으면 15km까지 확장 탐색

---

## 입력

| 필드 | 타입 | 설명 |
|------|------|------|
| `days` | `list[dict]` | Planner Agent가 생성한 날짜별 일정 목록 |
| `valid_places` | `list[dict]` | Filter Agent 통과 장소 목록 (내부 후보 풀 + kakao_place_id 매핑용) |

**`days`의 `ordered_places` 각 항목에서 사용하는 필드**:
```json
{
  "place_id": "uuid",
  "name": "경복궁",
  "lat": 37.5796,
  "lng": 126.9770,
  "category": "관광지",
  "start_at": "09:00",
  "date": "2025-07-01"
}
```

---

## 출력

| 필드 | 타입 | 설명 |
|------|------|------|
| `alternatives` | `dict[str, list[dict]]` | 장소 ID → 대안 목록 (최대 2개) |
| `messages` | `list[str]` | 완료 로그 (e.g. "Alternative Agent 완료: 7개 장소, 총 12개 대안 생성") |

**`alternatives` 구조**:
```json
{
  "uuid-place-id": [
    {
      "name": "창덕궁",
      "lat": 37.5792,
      "lng": 126.9910,
      "address": "서울 종로구 율곡로 99",
      "kakao_place_id": "98765432",
      "category": "관광지",
      "distance_m": 342,
      "source": "INTERNAL"
    },
    {
      "name": "인사동 갤러리",
      "lat": 37.5740,
      "lng": 126.9849,
      "address": "서울 종로구 인사동길 41",
      "kakao_place_id": "11223344",
      "category": "관광지",
      "distance_m": 891,
      "source": "EXTERNAL"
    }
  ]
}
```

**대안 없는 경우**: 빈 배열 반환
```json
{ "uuid-place-id": [] }
```

> 프론트엔드에서는 `distance_m`을 `"300m 거리"`, `"1.2km 거리"` 형식으로 표시하고,
> `source`를 기반으로 `"위시리스트 기반 추천"` / `"주변 추천"` 레이블을 표시합니다.

---

## 동작 상세

### Step 1. 메인 일정 kakao_place_id 수집 및 날짜별 인덱스 구성

`valid_places`에서 `place_id → kakao_place_id` 매핑을 구성하고,
모든 날짜의 `ordered_places`를 합산하여 날짜별 장소 집합을 만듭니다.

```python
# valid_places: place_id(Supabase UUID) → kakao_place_id 매핑
kakao_id_by_place_id = {
    p["id"]: p.get("kakao_place_id", "") for p in valid_places
}

# 날짜별 place_id 집합 (같은 날 배치 장소 제외용)
places_by_date: dict[str, set[str]] = {}
for day in days:
    date = day["date"]
    places_by_date[date] = {
        p["place_id"] for p in day.get("ordered_places", [])
    }

# 메인 일정 전체 kakao_place_id 집합 (외부 탐색 후보 제외용)
main_kakao_ids: set[str] = {
    kakao_id_by_place_id.get(p["place_id"], "")
    for p in all_places
    if kakao_id_by_place_id.get(p.get("place_id", ""))
}
```

---

### Step 2. 내부 후보 탐색 (위시리스트 기반)

`valid_places` 전체에서 동일 카테고리 장소를 1차 후보로 구성합니다.
사용자가 직접 추가한 위시리스트이므로 신뢰도가 높습니다.

**내부 후보 필터링 조건**:

```python
# 내부 후보 거리 제한 상수
MAX_INTERNAL_RADIUS = 7000   # 1차: 7km 이내만 허용
MAX_INTERNAL_RADIUS_EX = 15000  # 확장: 7km 이내 후보 0개일 때만 사용

def filter_internal(
    place: dict,
    valid_places: list[dict],
    same_day_ids: set[str],
    origin_lat: float,
    origin_lng: float,
    visit_start_at: int,
    weekday: int,
    max_radius: int = MAX_INTERNAL_RADIUS,
) -> list[dict]:
    category = place["category"]
    place_id = place["place_id"]

    candidates = []
    for p in valid_places:
        # 1. 같은 장소 제외
        if p["id"] == place_id:
            continue
        # 2. 같은 날 이미 배치된 장소 제외
        if p["id"] in same_day_ids:
            continue
        # 3. 카테고리 일치
        if p["category"] != category:
            continue
        # 4. 시간 최소 적합성
        if not check_alt_availability(p["category"], visit_start_at, weekday):
            continue
        # 5. 거리 소프트 제한: 완전히 말이 안 되는 거리만 제거
        dist = haversine_meters(origin_lat, origin_lng, float(p["lat"]), float(p["lng"]))
        if dist > max_radius:
            continue

        candidates.append({**p, "distance_m": dist})

    return candidates
```

**7km 이내 내부 후보가 0개일 때 확장 탐색**:

```python
internal = filter_internal(..., max_radius=MAX_INTERNAL_RADIUS)

# 7km 이내 후보가 전혀 없으면 15km까지 확장
if not internal:
    internal = filter_internal(..., max_radius=MAX_INTERNAL_RADIUS_EX)
```

> "7km 밖의 유일한 위시리스트"가 있는 경우, 무조건 External로 넘어가면 사용자 입장에서
> "내 위시리스트가 무시당했다"는 느낌을 줄 수 있습니다. 확장 탐색으로 이를 방지합니다.

**왜 하드 컷이 아닌 소프트 제한인가**:

| 방식 | 문제 |
|------|------|
| `if distance > 5000: continue` (하드 컷) | 지역별 밀도 차이 무시. 내부 후보 전부 소멸 → External 과도 발생 |
| `MAX_INTERNAL_RADIUS = 7km` + 스코어 반영 | 말 안 되는 후보만 제거. 먼 장소는 삭제가 아니라 스코어에서 자연스럽게 밀림 |

> **핵심 철학**: 내부 후보는 "삭제"가 아니라 "순위에서 밀어내야 한다"

| 필터 조건 | 이유 |
|-----------|------|
| 같은 장소 제외 | 원본과 동일한 대안 추천 방지 |
| 같은 날 배치 장소 제외 | 이미 일정에 있는 장소를 대안으로 제시하지 않음 |
| 카테고리 일치 | 동일 목적의 대안 제공 |
| 시간 최소 적합성 | 방문 시간대에 운영하는 장소만 추천 |
| 거리 소프트 제한 (`MAX_INTERNAL_RADIUS`) | 7km 이상 = 완전히 다른 지역. 후보에서 제거하되 확장 탐색으로 재시도 |

---

### Step 3. 외부 후보 탐색 (Kakao API)

내부 후보가 2개 미만일 때 Kakao Maps 카테고리 검색으로 보완합니다.  
**500m → 1km → 2km** 순서로 반경을 확장하며 부족한 수만큼 추가 탐색합니다.

```python
async def find_external(
    lat: float,
    lng: float,
    category: str,
    exclude_ids: set[str],
    visit_start_at: int,
    weekday: int,
    need: int,  # 부족한 대안 수
) -> list[dict]:
    alts = []
    seen_ids: set[str] = set()  # 반경 확장 시 동일 장소 중복 방지

    for radius in SEARCH_RADII:  # [500, 1000, 2000]
        candidates = await search_nearby(lat, lng, category, radius, size=8)

        for r in candidates:
            kakao_id = r.get("id", "")
            # 메인 일정 또는 이미 선택된 대안 제외
            if kakao_id in exclude_ids or kakao_id in seen_ids:
                continue
            seen_ids.add(kakao_id)

            kakao_category_code = r.get("category_group_code", "")
            alt_category = KAKAO_CODE_TO_CATEGORY.get(kakao_category_code, category)

            if not check_alt_availability(alt_category, visit_start_at, weekday):
                continue

            alt_lat = float(r.get("y", 0))
            alt_lng = float(r.get("x", 0))

            alts.append({
                "name": r.get("place_name", ""),
                "lat": alt_lat,
                "lng": alt_lng,
                "address": r.get("road_address_name") or r.get("address_name", ""),
                "kakao_place_id": kakao_id,
                "category": alt_category,
                "category_name": r.get("category_name", ""),
                "distance_m": haversine_meters(lat, lng, alt_lat, alt_lng),
            })

        if len(alts) >= need:
            break

    return alts
```

> `seen_ids`는 반경이 넓어질수록 작은 반경의 결과가 재포함되는 것을 방지합니다. (예: 500m 결과가 1km 결과에 중복 포함되는 경우)

**Kakao 카테고리 코드 변환**:

```python
KAKAO_CODE_TO_CATEGORY = {
    "FD6": "맛집",
    "CE7": "카페",
    "AT4": "관광지",
    "AD5": "숙소",
    "CT1": "액티비티",
}
```

---

### Step 4. Hybrid 병합 및 스코어링

내부 후보와 외부 후보를 통합한 뒤 스코어링으로 상위 2개를 선정합니다.

**Hybrid 전략**:

```python
internal = filter_internal(...)   # 위시리스트 기반
need = max(0, 2 - len(internal))
external = find_external(..., need=need) if need > 0 else []

# 내부 + 외부 통합 후 스코어링
all_candidates = [
    {**p, "source": "INTERNAL"} for p in internal
] + [
    {**p, "source": "EXTERNAL"} for p in external
]
```

**스코어링 알고리즘**:

```python
def score_candidate(
    candidate: dict,
    origin_lat: float,
    origin_lng: float,
    visit_start_at: int,
    category: str,
) -> float:
    # filter_internal에서 distance_m이 이미 계산되어 있으면 재사용
    distance_m = candidate.get("distance_m") or haversine_meters(
        origin_lat, origin_lng, candidate["lat"], candidate["lng"]
    )

    # 거리 패널티: 가중치 0.3 적용 (가까울수록 높은 점수, 먼 장소는 자연스럽게 하위로)
    distance_score = -distance_m * 0.3

    # 시간 적합도 보너스: 카테고리 기본 영업 중심 시간에 가까울수록 +
    slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
    open_min, close_min = slots[0][0], slots[0][1]
    center_time = (open_min + close_min) / 2
    time_fit_bonus = max(0, 200 - abs(visit_start_at - center_time))

    # 카테고리 일치 보너스: 원본과 동일 카테고리
    category_match_bonus = 300 if candidate.get("category") == category else 0

    return distance_score + time_fit_bonus + category_match_bonus
```

| 점수 항목 | 계산 방식 | 비고 |
|-----------|-----------|------|
| 거리 패널티 | `-distance_m * 0.3` | 가중치 0.3: 7km 차이 = -2100점. 삭제가 아닌 자연스러운 하위 정렬 |
| 시간 적합도 | `max(0, 200 - abs(visit_start_at - center_time))` | 최대 +200 |
| 카테고리 일치 | 동일 카테고리: +300, 아닌 경우: 0 | 최대 +300 |

**거리 가중치 조정 가이드**:

| `distance_weight` | 특성 |
|-------------------|------|
| `0.2` | 거리 영향 약함. 멀어도 시간 적합도·카테고리가 좋으면 상위 |
| `0.3` (권장) | 균형. 1km 차이 = -300점, 카테고리 일치 보너스(+300)와 동등 |
| `0.5` | 거리 영향 강함. 거리순에 가까워짐 |

**다양성 보장 (Diversity)**:

최종 2개 대안에서 alt1은 동일 카테고리, alt2는 유사/인접 카테고리를 우선합니다.

```python
same_cat = [c for c in ranked if c["category"] == category]
diff_cat = [c for c in ranked if c["category"] != category]

alts = (same_cat[:1] + diff_cat[:1])  # alt1: 동일, alt2: 인접
if len(alts) < 2:
    alts = ranked[:2]  # 동일 카테고리만 있으면 상위 2개
```

---

### Step 5. 맛집 세부 카테고리 (Cuisine) 부스팅

카테고리가 `"맛집"`인 경우 Kakao `category_name`(상세 분류) 기반으로 cuisine 타입을 추출하여 원본 장소와 일치할 때 부스팅합니다.

```python
CUISINE_KEYWORDS = ["한식", "일식", "중식", "양식", "분식", "해산물", "고기", "치킨"]

def get_cuisine(category_name: str) -> str | None:
    """Kakao category_name에서 cuisine 키워드 추출."""
    for kw in CUISINE_KEYWORDS:
        if kw in category_name:
            return kw
    return None

# 스코어링 시 origin의 cuisine과 일치하면 보너스
origin_cuisine = get_cuisine(origin_place.get("category_name", ""))
alt_cuisine = get_cuisine(candidate.get("category_name", ""))
if origin_cuisine and alt_cuisine and origin_cuisine == alt_cuisine:
    score += 200  # cuisine 일치 보너스
```

---

### Step 6. 운영시간 확인 (`check_alt_availability`)

`DEFAULT_HOURS` 기준으로 방문 시작 시간과 요일을 함께 고려합니다.

```python
def check_alt_availability(
    category: str,
    visit_start_at: int,
    weekday: int,  # Python 기준: 0=월요일, 6=일요일
) -> bool:
    slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
    if not slots:
        return True  # 빈 슬롯 → soft-pass

    open_mod, close_mod = slots[0][0], slots[0][1]
    if open_mod == 0 and close_mod == 1440:
        return True  # 전일 영업 (숙소 등) → soft-pass

    # 시간 컨텍스트: 관광지는 18:00 이후 방문 불가 처리
    if category == "관광지" and visit_start_at > 18 * 60:
        return False

    return open_mod <= visit_start_at <= close_mod
```

| 경우 | 처리 |
|------|------|
| 슬롯 없음 | soft-pass (True) |
| 전일 영업 (0 ~ 1440) | soft-pass (True) |
| 관광지 + 방문 시작 > 18:00 | 방문 불가 (False) |
| `open_mod <= visit_start_at <= close_mod` | 방문 가능 (True) |
| 그 외 | 방문 불가 (False) → 후보 제외 |

> `weekday` 파라미터는 현재 DEFAULT_HOURS 판단에 직접 사용되지 않지만, 향후 요일별 휴무 정보 통합 시 확장 포인트입니다.

---

### Step 7. used_alt_ids 관리 (날짜별 범위 축소)

기존 전역 `used_alt_ids`는 1일차에 선정된 대안이 2~3일차에서도 영구 제외되는 문제가 있습니다.  
날짜별(`used_alt_ids_by_day`)로 범위를 제한하여 좋은 대안이 다른 날에 사라지는 문제를 해결합니다.

```python
# 날짜별 used_alt_ids (날짜 간 중복 허용, 같은 날 중복만 방지)
used_alt_ids_by_day: dict[str, set[str]] = {}

for place in all_places:
    date = place.get("date", "")
    if date not in used_alt_ids_by_day:
        used_alt_ids_by_day[date] = set()

    # 현재 날짜의 used_alt_ids만 사용
    exclude_ids = main_kakao_ids | used_alt_ids_by_day[date]

    place_id, alts = await find_alternatives(place, exclude_ids, ...)

    # 선정된 대안을 현재 날짜 집합에만 추가
    used_alt_ids_by_day[date].update(
        alt["kakao_place_id"] for alt in alts if alt.get("kakao_place_id")
    )
```

| 방식 | 장점 | 단점 |
|------|------|------|
| 전역 `used_alt_ids` | 전체 일정에서 대안 중복 없음 | 좋은 대안이 다른 날에서도 제외됨 |
| `used_alt_ids_by_day` | 날짜 간 다양성 보장 | 같은 대안이 다른 날 재등장 가능 (허용) |

---

## 전체 처리 흐름

```
days + valid_places (입력)
    │
    ▼
[Step 1] 메인 일정 구성
    ├─ valid_places: place_id → kakao_place_id 매핑
    ├─ all_places: 모든 날짜의 ordered_places 합산
    └─ places_by_date: 날짜별 place_id 집합
    │
    ▼
[Step 2~7] 장소별 순차 탐색 (asyncio.gather 미사용)
    │
    ├─ [Step 2] 내부 후보 탐색 (위시리스트)
    │    ├─ 같은 장소 제외
    │    ├─ 같은 날 배치 장소 제외
    │    ├─ 카테고리 일치
    │    └─ check_alt_availability 필터
    │
    ├─ 내부 후보 2개 이상? → 외부 탐색 생략
    │
    ├─ [Step 3] 외부 후보 탐색 (Kakao API, 부족분만)
    │    ├─ [반경 500m] size=8
    │    ├─ [반경 1km] (부족 시)
    │    └─ [반경 2km] (부족 시)
    │
    ├─ [Step 4] Hybrid 병합 + 스코어링
    │    ├─ 내부(INTERNAL) + 외부(EXTERNAL) 통합
    │    ├─ score = -distance + time_fit_bonus + category_match_bonus
    │    └─ 다양성: alt1(동일 카테고리) + alt2(유사 카테고리)
    │
    ├─ [Step 5] 맛집 cuisine 부스팅
    │    └─ origin cuisine == alt cuisine → +200
    │
    └─ [Step 7] used_alt_ids_by_day 갱신
    │
    ▼
alternatives (출력): { place_id: [alt1, alt2] }
    ├─ alt1: source="INTERNAL" or "EXTERNAL", distance_m, category, ...
    └─ alt2: source="INTERNAL" or "EXTERNAL", distance_m, category, ...
```

---

## Fallback 정책

| 상황 | 동작 |
|------|------|
| 내부 + 외부 모두 대안 미발견 | 빈 배열 반환 (`[]`), 나머지 장소 탐색 계속 |
| 대안 1개만 발견 | 1개만 반환 (2개 미만도 허용) |
| Kakao API 오류 (개별 장소) | `logger.warning` 후 빈 배열 처리, 나머지 계속 진행 |
| `all_places` 빈 배열 | 즉시 `{}` 반환 |
| `KAKAO_API_KEY` 미설정 | 외부 탐색 생략 → 내부 후보만 사용 |

---

## Kakao Maps API 사용

> **파일**: `backend/services/kakao.py`

```
GET https://dapi.kakao.com/v2/local/search/category.json
  ?category_group_code={코드}
  &x={lng}
  &y={lat}
  &radius={radius}
  &size=8
```

| 파라미터 | 값 |
|----------|----|
| `category_group_code` | `FD6` / `CE7` / `AT4` / `AD5` / `CT1` |
| `x`, `y` | 원본 장소의 경도(lng), 위도(lat) |
| `radius` | 500 / 1000 / 2000 (미터) |
| `size` | 8 (최대 후보 수) |

---

## 프론트엔드 활용 가이드

| 필드 | 표시 방식 |
|------|-----------|
| `source == "INTERNAL"` | "위시리스트 기반 추천" 레이블 |
| `source == "EXTERNAL"` | "주변 추천" 레이블 |
| `distance_m < 1000` | `"${distance_m}m 거리"` |
| `distance_m >= 1000` | `"${(distance_m/1000).toFixed(1)}km 거리"` |
| 대안 없음 (`[]`) | 교체 버튼 비활성화 + "주변에 대안 장소가 없습니다" 표시 |

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/agents/alternative_agent.py` | Alternative Agent 메인 로직 |
| `backend/services/kakao.py` | Kakao Maps 카테고리 검색 (`search_nearby`) |
| `backend/agents/time_utils.py` | `DEFAULT_HOURS`, `DEFAULT_FALLBACK_HOURS`, `haversine_meters` |
| `backend/agents/state.py` | `alternatives` 필드 포함 State 정의 |
| `backend/agents/pipeline.py` | Filter → Planner → Validator → **Alternative** → END |
| `backend/tests/test_agents.py` | Alternative Agent 관련 테스트 |

---

## 변경 이력

| 버전 | 변경 내용 |
|------|-----------|
| v1 | `asyncio.gather` 병렬 실행, 단일 반경 탐색 |
| v2 | 순차 실행으로 변경 (race condition 방지), 가변 반경 확장 (500m→1km→2km), `used_alt_ids` 전역 공유, `distance_m` 필드 추가, Kakao 카테고리 코드 변환, `check_alt_availability` 분리 |
| v3 | **Hybrid 전략** (내부 우선 → 외부 보완), **스코어링** (거리+시간+카테고리), **맛집 cuisine 부스팅**, **시간 컨텍스트** (관광지 18:00 이후 제외), **`used_alt_ids_by_day`** (날짜별 범위 축소), **`source` 필드** (INTERNAL/EXTERNAL), **다양성** (alt1 동일·alt2 인접 카테고리), **`weekday` 파라미터** (`check_alt_availability` 확장) |
| v4 | **내부 후보 거리 소프트 제한** (`MAX_INTERNAL_RADIUS=7km` 가드 + 확장 탐색 `15km`), **거리 가중치 스코어링** (`-distance_m * 0.3`), `filter_internal`에서 `distance_m` 사전 계산 후 스코어에 재사용 |
| v5 | `find_external`에 `seen_ids` 내부 dedup 추가 (반경 확장 시 동일 kakao_place_id 중복 방지), 외부 탐색 결과에 `distance_m`·`category_name` 필드 사전 계산 후 dict로 정규화, `weekday` 실제 date 파싱(`datetime.strptime`)으로 계산 (`alternative_agent` 진입점), `check_alt_availability` 관광지 임계값 상수화 (`SIGHTSEEING_CLOSE = 1080`) |
