# 에이전트 파일 구조 및 의존성 분석

## 각 에이전트 파일 위치

| 에이전트 | 파일 경로 |
|---------|----------|
| Filter Agent | `backend/agents/filter_agent.py` |
| Planner Agent | `backend/agents/planner_agent.py` |
| Validator Agent | `backend/agents/validator.py` |
| Alternative Agent | `backend/agents/alternative_agent.py` |

---

## 의존성 그래프

```
routers/itinerary.py  (FastAPI 엔드포인트 - SSE 스트리밍)
    └── agents/pipeline.py  (LangGraph StateGraph 조립)
         │
         ├── agents/filter_agent.py
         │    ├── agents/state.py          (ItineraryState)
         │    ├── agents/time_utils.py     (DEFAULT_HOURS 등 상수)
         │    └── services/hours_resolver.py  ──→ Google Places API
         │
         ├── agents/planner_agent.py
         │    ├── agents/state.py
         │    ├── agents/time_utils.py
         │    └── services/kakao.py (get_travel_time)  ──→ Kakao Mobility API
         │         └── core/config.py
         │
         ├── agents/validator.py
         │    ├── agents/state.py
         │    └── agents/time_utils.py
         │
         └── agents/alternative_agent.py
              ├── agents/state.py
              ├── agents/time_utils.py
              ├── core/config.py
              └── services/kakao.py (search_nearby)  ──→ Kakao Maps API
```

---

## 각 에이전트 역할 및 의존 모듈

### Filter Agent

- **역할**: 여행 기간 중 방문 불가 장소 제거, must_visit 강제 포함
- **주요 함수**:
  - `is_visitable(opening_hours, travel_weekdays)`: 방문 가능 여부 판정
  - `filter_agent(state)`: 메인 필터링 함수
- **외부 의존**: `services/hours_resolver.py` → Google Places API
- **공유 의존**: `agents/state.py`, `agents/time_utils.py`
- **출력 키**: `valid_places`, `excluded_places`, `messages`

### Planner Agent

- **역할**: 날짜별 클러스터링 → TSP 동선 최적화 → 타임라인 배치
- **주요 함수**:
  - `day_allocation_greedy()`: 지리적 최대 분산 클러스터 분배
  - `route_ordering()`: TSP + 식사시간 제약 기반 순서 최적화
  - `build_route_matrix()`: Kakao Mobility API 이동시간 행렬 구성
  - `planner_agent(state)`: 메인 5단계 파이프라인
- **외부 의존**: `services/kakao.py` → Kakao Mobility API (이동시간 행렬)
- **공유 의존**: `agents/state.py`, `agents/time_utils.py`
- **출력 키**: `days`, `messages`

### Validator Agent

- **역할**: Planner 출력 규칙 기반 검증 (밀도, 갭, 숙소 등 경고 생성)
- **주요 함수**:
  - `check_day_density()`: 하루 8개 초과, 12시간 초과 경고
  - `check_place_reliability()`: 장소별 경고 수집
  - `check_gap()`: 인접 장소 간 45분 이상 대기 경고
  - `check_lodging_consistency()`: 하루 STAY 2개 이상 감지
  - `validator_agent(state)`: 메인 검증 함수
- **외부 의존**: 없음 (순수 규칙 기반)
- **공유 의존**: `agents/state.py`, `agents/time_utils.py`
- **출력 키**: `validation_warnings`

### Alternative Agent

- **역할**: 각 장소별 플랜 B/C 2개 탐색 (내부 + Kakao 외부 하이브리드)
- **주요 함수**:
  - `filter_internal()`: valid_places에서 내부 대안 후보 필터링 (7km → 15km 확장)
  - `find_external()`: Kakao API 외부 탐색 (반경 500m → 1km → 2km)
  - `find_alternatives()`: Hybrid 방식 대안 탐색
  - `alternative_agent(state)`: 순차 실행으로 race condition 방지
- **외부 의존**: `services/kakao.py` → Kakao Maps API (주변 장소 검색)
- **공유 의존**: `agents/state.py`, `agents/time_utils.py`, `core/config.py`
- **출력 키**: `alternatives`, `messages`

---

## 실행 순서 (파이프라인)

```
Filter Agent → Planner Agent → Validator Agent → Alternative Agent → END
```

- **조립 위치**: `agents/pipeline.py` (LangGraph StateGraph)
- **호출 위치**: `routers/itinerary.py` (`.astream_events()`로 SSE 스트리밍)
- **테스트 위치**: `tests/test_agents.py`

---

## 공유 핵심 모듈

| 모듈 | 역할 |
|-----|------|
| `agents/state.py` | `ItineraryState` TypedDict — 모든 에이전트가 공유하는 상태 |
| `agents/time_utils.py` | 시간 계산, 카테고리 상수, haversine 거리 등 유틸리티 |
| `core/config.py` | 환경 변수 (API 키, Supabase URL 등) |

### ItineraryState 주요 필드

| 필드 | 담당 에이전트 | 설명 |
|-----|-------------|------|
| `places` | 초기 입력 | 원본 장소 목록 |
| `travel_dates` | 초기 입력 | ISO 형식 여행 날짜 목록 |
| `schedule_pins` | 초기 입력 | RESERVATION/STAY 핀 |
| `valid_places` | Filter Agent 출력 | 방문 가능 장소 |
| `excluded_places` | Filter Agent 출력 | 제외된 장소 (이유 포함) |
| `days` | Planner Agent 출력 | 날짜별 순서화된 일정 |
| `validation_warnings` | Validator Agent 출력 | 규칙 위반 경고 메시지 |
| `alternatives` | Alternative Agent 출력 | 장소별 플랜 B/C |
| `messages` | 누적 | 각 에이전트 완료 메시지 |
| `error` | 공통 | 에러 발생 시 메시지 |

---

## 외부 서비스 연결 요약

| 서비스 | 호출 위치 | 용도 |
|--------|----------|------|
| Google Places API | `services/hours_resolver.py` | 장소 운영시간 수집 |
| Kakao Mobility API | `services/kakao.py` (`get_travel_time`) | 자차 이동시간 계산 |
| Kakao Maps API | `services/kakao.py` (`search_nearby`) | 주변 대안 장소 검색 |
