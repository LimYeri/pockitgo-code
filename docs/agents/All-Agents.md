# PockitGo AI Agent 전체 개요

> 이 문서는 PockitGo의 LangGraph 기반 4개 에이전트 전체 구조와 동작 방식을 통합 정리합니다.
> 각 에이전트의 상세 사양은 개별 문서(`Filter-Agents.md`, `Planner-Agent.md`, `Validator-Agent.md`, `Alternative-Agent.md`)를 참조하세요.

---

## 파이프라인 전체 흐름

```
사용자 입력 (places + travel_dates + schedule_pins)
    │
    ▼
① Filter Agent          → 방문 불가 장소 제거, 운영시간 수집
    │ valid_places
    │ excluded_places
    ▼
② Planner Agent         → 날짜별 최적 일정(타임라인) 생성
    │ days
    │ excluded_places (누적)
    ▼
③ Validator Agent       → 일정 사후 검증, 사용자 경고 생성
    │ validation_warnings
    ▼
④ Alternative Agent     → 각 장소의 대안(플랜 B/C) 탐색
    │ alternatives
    ▼
최종 출력 (days + excluded_places + validation_warnings + alternatives)
```

> **파일**: `backend/agents/pipeline.py`  
> **State**: `backend/agents/state.py` (`ItineraryState`)

---

## 에이전트별 한눈에 보기

| 에이전트 | 파일 | 역할 | LLM | 외부 API |
|---------|------|------|:---:|:--------:|
| Filter Agent | `filter_agent.py` | 방문 불가 장소 필터링 + 운영시간 수집 | ✗ | Google Places API |
| Planner Agent | `planner_agent.py` | 날짜 분배 → TSP 정렬 → 타임라인 생성 | ✗ | Kakao Mobility API |
| Validator Agent | `validator.py` | 일정 사후 검증 + 사용자 경고 생성 | ✗ | 없음 |
| Alternative Agent | `alternative_agent.py` | 장소별 플랜 B/C 탐색 | ✗ | Kakao Maps API |

> **설계 철학**: 전 에이전트 LLM 미사용. Rule-based + 수치 알고리즘으로 결정론적 동작.

---

## ① Filter Agent

> **파일**: `backend/agents/filter_agent.py`

### 역할
사용자 위시리스트에서 여행 기간 중 방문 불가능한 장소를 제거하고, 남은 유효 장소에 운영시간 정보를 부착합니다.

### 입출력

| 입력 | 출력 |
|------|------|
| `places` (전체 장소) | `valid_places` (운영시간 포함) |
| `travel_dates` (여행 날짜 목록) | `excluded_places` (제외 사유 포함) |

### 처리 단계

```
① travel_weekdays 계산
   travel_dates 전체 → [0, 1, 2, ...] (Python 기준: 0=월요일)

② 운영시간 병렬 수집 (hours_resolver.py)
   Google Places API (findplacefromtext → place/details)
      └─ Google 요일(0=일) → Python 요일(0=월) 변환 필수
   실패 시: DEFAULT_HOURS[category] fallback

③ Rule-based 필터링
   travel_weekdays 중 하루라도 영업 슬롯 존재 → VALID
   모든 여행 날짜 휴무 → EXCLUDED

④ is_must_visit 강제 포함
   is_must_visit=true → 무조건 valid_places에 포함
```

### 핵심 규칙
- **보수적 필터링**: 애매하면 포함(VALID). false negative가 최악
- **Multi-day 기준**: 여행 기간 중 단 하루라도 방문 가능하면 통과
- **항상 시간 존재**: Google 실패 시 `DEFAULT_HOURS`로 대체, UNKNOWN 없음
- **병렬 수집**: `asyncio.gather` + `Semaphore(5)`

### opening_hours 구조

```json
{
  "0": [],            // 월요일 휴무
  "1": [[540, 1140]], // 화요일 09:00~19:00
  "6": [[1020, 120]]  // 일요일 17:00~익일 02:00 (Overnight)
}
```

- key: Python 요일 문자열 (`"0"`=월 ~ `"6"`=일)
- value: `[[open_min, close_min], ...]` (분 단위)
- Overnight: `close_min < open_min` → Planner에서 `close_min += 1440` 정규화

### DEFAULT_HOURS (Google 실패 시 fallback)

| 카테고리 | 시간 |
|---------|------|
| 맛집 | 11:00~21:00 (660~1260) |
| 카페 | 10:00~22:00 (600~1320) |
| 관광지 | 09:00~20:00 (540~1200) |
| 숙소 | 00:00~24:00 (0~1440) |
| 액티비티 | 10:00~20:00 (600~1200) |

---

## ② Planner Agent

> **파일**: `backend/agents/planner_agent.py`

### 역할
Filter Agent가 통과시킨 유효 장소들을 날짜별로 분배하고, 최적 이동 경로와 타임라인을 생성합니다.

### 입출력

| 입력 | 출력 |
|------|------|
| `valid_places` (운영시간 포함) | `days` (날짜별 ordered_places) |
| `travel_dates` | `excluded_places` (Planner 단계 제외 누적) |
| `schedule_pins` (RESERVATION/STAY 고정 핀) | |

### 처리 단계 (5단계)

```
[전처리] STAY 시작점 맵 구성
   stay_for_date: checkin~checkout 전체 날짜 범위 매핑 (멀티박 지원)
   동일 날짜 숙소 중복 → ValueError
   stay_pinned_ids: 숙소 이중 제외 (카테고리 + 핀 기반)
   STAY 핀 없는 숙소 → excluded_places 이동
   prev_stay_map[day_idx] = 전날 STAY 장소 → 다음 날 TSP 시작점

[Step 1] day_allocation_greedy — 날짜별 장소 분배
   숙소 완전 제외 (카테고리 + stay_pinned_ids 이중 방어)
   seed[0] = must_visit 중 centroid 최근접 (밀도 중심)
   seed[1..n] = max-min-dist 최대 분산
   나머지 → haversine 최근접 날짜에 배정
   hard cap: 하루 최대 8개 (MAX_PLACES_PER_DAY)
   soft cap: 카페·맛집 하루 최대 2개 (MAX_CATEGORY_PER_DAY)

[Step 2] anchor_extraction — 앵커 분리
   RESERVATION 핀 → pins_for_date에서 추출, pinned_time 오름차순 정렬
   STAY 앵커 → stay_place_for_date 직접 주입 (멀티박 정확 처리)

[Step 3] route_ordering — TSP 정렬 + RESERVATION 삽입
   infer_day_start_time() → 동적 시작 시각 결정
   _nearest_neighbor_tsp(free_places, prev_stay 좌표)
   _insert_reservations_by_time() → 실제 타임라인 시뮬레이션으로 삽입 위치 결정
   + stay_anchors (맨 뒤)

[Step 4] build_route_matrix — Kakao Mobility 이동시간 선계산
   asyncio.gather 병렬, Semaphore(10)으로 429 방어
   실패 시: haversine fallback (max(5, int(km * 3)) 분)
   LRU 캐시(_ROUTE_CACHE)로 중복 호출 방지

[Step 5] timeline_validation — 타임라인 생성 + 충돌 해결
   체류 시간: get_stay_duration(category, n_places_today) 동적 계산
   맛집 배치 시 식사 시간대(MEAL_WINDOWS) 점프 (gap ≤ 60분)
   RESERVATION: pinned_time으로 시작 고정, 지각 감지
   STAY 앵커: end_at=null, affects_time=false, duration=0 (타임라인 계산 제외)
   같은 날 동일 place_id 중복 배치 → excluded_places
   충돌 시 3단계 repair_conflict:
      ① is_must_visit → KEEP_WITH_WARNING (place_warning 태깅)
      ② 이미 이동됨 → REMOVED (핑퐁 방지)
      ③ _try_shift_later() → SHIFTED (당일 뒤로 밀기)
      ④ _find_best_day() → MOVED (다른 날짜로 이동)
      ⑤ → REMOVED
```

### 핵심 상수 (time_utils.py)

| 상수 | 값 | 설명 |
|------|----|------|
| `MAX_PLACES_PER_DAY` | 8 | 하루 최대 장소 수 (hard cap) |
| `MAX_DAY_END` | 1260 (21:00) | 하루 최대 종료 시각 |
| `RESERVATION_TOLERANCE` | 10분 | RESERVATION 지각 허용 오차 |
| `RESERVATION_LATE_SHIFT_MAX` | 30분 | 이 이내 지각 → 경고 태깅, 초과 → MOVED/REMOVED |
| `MAX_MEAL_JUMP_MIN` | 60분 | 맛집 식사 시간대 점프 최대 대기 |

### place_warning 타입

| 타입 | 발생 조건 |
|------|---------|
| `MUST_VISIT_CLOSED` | `is_must_visit=true` 장소가 운영시간 외 배치 |
| `RESERVATION_LATE` | RESERVATION 핀 장소에 30분 이내 지각 예상 |

### 이동시간 Fallback 계층

```
Kakao Mobility API
   └─ 실패 시: haversine 거리 기반 추정 (도심 20km/h, max(5, int(km*3)) 분)
```

---

## ③ Validator Agent

> **파일**: `backend/agents/validator.py`

### 역할
Planner Agent가 생성한 일정을 검증하여 사용자에게 표시할 경고 메시지를 생성합니다.  
일정을 직접 수정하지 않고 **경고만 생성**합니다.

### 입출력

| 입력 | 출력 |
|------|------|
| `days` (Planner 출력) | `validation_warnings` (경고 메시지 목록) |

### 처리 단계 (5가지 검증)

```
[Step 1] check_day_density — 하루 일정 밀도 검사
   하루 장소 수 > 8개 → 경고
   첫 장소 start_at ~ 마지막 장소 end_at > 12시간 → 경고

[Step 2] check_place_reliability — 장소별 신뢰도 경고
   place_warning.warning_type == "MUST_VISIT_CLOSED" → 경고
   place_warning.warning_type == "RESERVATION_LATE"  → 경고 (지각 분은 warning_message에 포함)
   Deduplication: (place_id, warning_type) 키로 중복 방지

[Step 3] check_default_hours — DEFAULT 운영시간 경고 (그룹화)
   hours_source == "DEFAULT" 장소 수에 따라:
      1개 → 단건 경고
      2~3개 → 장소명 나열
      4개+ → "첫 장소 외 N곳" 요약

[Step 4] check_gap — 대기 시간 경고
   STAY 앵커(end_at=None) 쌍 건너뜀
   이전 end_at + 이동시간 기준 45분 이상 대기 → 경고

[Step 5] check_lodging_consistency — 숙소 무결성 검증
   하루에 STAY 앵커 2개 이상 → 경고 (Planner assert 2차 방어선)
```

### Planner와 역할 분담

| 항목 | Planner | Validator |
|------|:-------:|:---------:|
| 운영시간 충돌 자동 수정 | ✓ | ✗ |
| 일정 다른 날짜로 이동 | ✓ | ✗ |
| MUST_VISIT_CLOSED 생성 | ✓ | ✗ |
| RESERVATION_LATE 생성 | ✓ | ✗ |
| 하루 8개 초과 **경고** | ✗ | ✓ |
| 총 소요 시간 과밀 **경고** | ✗ | ✓ |
| DEFAULT 운영시간 **경고** | ✗ | ✓ |
| MUST_VISIT_CLOSED **수집·변환** | ✗ | ✓ |
| RESERVATION_LATE **수집·변환** | ✗ | ✓ |
| Gap 대기시간 **경고** | ✗ | ✓ |
| 숙소 중복 배치 **경고** | ✗ (assert로 방어) | ✓ (2차 방어) |

> Planner는 일정을 **수정**하고, Validator는 사용자에게 **알립니다**.

---

## ④ Alternative Agent

> **파일**: `backend/agents/alternative_agent.py`

### 역할
확정된 일정의 각 장소에 대해 대안(플랜 B/C)을 최대 2개 탐색합니다.

### 입출력

| 입력 | 출력 |
|------|------|
| `days` (확정 일정) | `alternatives` (`{place_id: [alt1, alt2]}`) |
| `valid_places` (내부 후보 풀) | |

### 처리 단계 (7단계)

```
[Step 1] 메인 일정 인덱스 구성
   place_id → kakao_place_id 매핑
   날짜별 배치 장소 집합 (places_by_date)
   메인 일정 전체 kakao_place_id 집합 (main_kakao_ids)

[Step 2] 내부 후보 탐색 (위시리스트 기반)
   조건: 같은 장소 제외 + 같은 날 배치 제외 + 카테고리 일치 + 시간 적합성
   거리 소프트 제한: 7km 이내 (없으면 15km까지 확장)

[Step 3] 외부 후보 탐색 (Kakao Maps, 내부 2개 미만일 때만)
   반경: 500m → 1km → 2km 순차 확장
   size=8, 메인 일정 장소 및 당일 대안 중복 제외
   seen_ids로 반경 확장 시 동일 장소 중복 방지

[Step 4] Hybrid 병합 + 스코어링
   score = -distance_m * 0.3 + time_fit_bonus(max+200) + category_match_bonus(+300)
   다양성: alt1=동일 카테고리, alt2=유사/인접 카테고리

[Step 5] 맛집 cuisine 부스팅
   origin cuisine == alt cuisine → +200점 보너스
   (CUISINE_KEYWORDS: 한식, 일식, 중식, 양식, 분식, 해산물, 고기, 치킨)

[Step 6] check_alt_availability
   DEFAULT_HOURS 기준 시간 적합성 검사
   관광지 + 방문 시작 > 18:00 → 불가

[Step 7] used_alt_ids_by_day 관리
   같은 날 중복 대안 방지 (날짜별 범위 제한)
   다른 날짜 간 동일 대안 재등장 허용
```

### 스코어링 가중치

| 항목 | 계산 | 최대 효과 |
|------|------|---------|
| 거리 패널티 | `-distance_m * 0.3` | 1km = -300점 |
| 시간 적합도 | `max(0, 200 - abs(visit_start - center_time))` | +200점 |
| 카테고리 일치 | 동일 카테고리 +300 | +300점 |
| cuisine 일치 | 맛집 한정, 동일 cuisine +200 | +200점 |

### 출처 표시

| `source` | 의미 | 프론트엔드 레이블 |
|----------|------|----------------|
| `INTERNAL` | 위시리스트 기반 | "위시리스트 기반 추천" |
| `EXTERNAL` | Kakao Maps 검색 | "주변 추천" |

### Kakao 카테고리 코드 변환

| Kakao 코드 | 내부 카테고리 |
|-----------|-------------|
| `FD6` | 맛집 |
| `CE7` | 카페 |
| `AT4` | 관광지 |
| `AD5` | 숙소 |
| `CT1` | 액티비티 |

---

## State 구조 (LangGraph)

> **파일**: `backend/agents/state.py`

```python
class ItineraryState(TypedDict):
    # 입력
    places: list[dict]           # 원본 위시리스트
    travel_dates: list[str]      # 여행 날짜 목록
    schedule_pins: list[dict]    # RESERVATION / STAY 핀

    # Filter Agent 출력
    valid_places: list[dict]     # 운영시간 포함 유효 장소
    excluded_places: list[dict]  # 제외 장소 (사유 포함)

    # Planner Agent 출력
    days: list[dict]             # 날짜별 ordered_places

    # Validator Agent 출력
    validation_warnings: list[str]

    # Alternative Agent 출력
    alternatives: dict[str, list[dict]]  # place_id → [alt1, alt2]

    # 공통
    messages: list[str]          # 각 에이전트 완료 로그
```

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/agents/pipeline.py` | LangGraph 파이프라인 구성 (노드 연결) |
| `backend/agents/state.py` | 전체 State 구조 정의 |
| `backend/agents/filter_agent.py` | Filter Agent |
| `backend/agents/planner_agent.py` | Planner Agent |
| `backend/agents/validator.py` | Validator Agent |
| `backend/agents/alternative_agent.py` | Alternative Agent |
| `backend/agents/time_utils.py` | 공통 상수·유틸 (거리 계산, 시간 변환, DEFAULT_HOURS 등) |
| `backend/services/hours_resolver.py` | Google Places API 운영시간 수집 (Filter용) |
| `backend/services/kakao.py` | Kakao Maps/Mobility API 클라이언트 |
| `backend/core/config.py` | API 키 등 환경 설정 |
| `backend/tests/test_agents.py` | 에이전트 통합 테스트 |

---

## API 키 의존성

| 환경변수 | 사용 에이전트 | 미설정 시 동작 |
|---------|-------------|-------------|
| `GOOGLE_PLACES_API_KEY` | Filter Agent | DEFAULT_HOURS fallback |
| `KAKAO_MOBILITY_API_KEY` | Planner Agent | haversine fallback |
| `KAKAO_API_KEY` | Alternative Agent | 외부 탐색 생략, 내부 후보만 사용 |

---

## 공통 설계 원칙

1. **LLM 미사용**: 4개 에이전트 모두 rule-based + 수치 알고리즘
2. **보수적 처리**: 애매하면 포함(Filter), 경고만 하고 제거 안 함(Validator)
3. **Fallback 계층**: 외부 API 실패 시 항상 합리적인 기본값으로 대체
4. **단방향 이동 정책**: Planner에서 이미 이동된 장소는 재충돌 시 즉시 제거(핑퐁 방지)
5. **is_must_visit 보호**: 사용자 필수 장소는 시스템이 임의 제거 불가
