# Filter Agent

> **파일**: `backend/agents/filter_agent.py`
> **역할**: 사용자가 위시리스트에 추가한 장소들 중 여행 기간에 방문 불가능한 장소를 걸러냅니다.

---

## 설계 원칙

- **Deterministic 우선**: 운영시간 판단은 rule-based 로직으로 처리. LLM은 사용하지 않음
- **보수적 필터링**: 애매하면 포함(valid). false negative(갈 수 있는 곳을 제거)가 최악
- **Multi-day 기준**: 여행 기간 중 단 하루라도 방문 가능하면 valid
- **항상 시간 존재**: UNKNOWN 개념 없음. Google 실패 시 카테고리 기본 시간 사용

---

## 입력

| 필드 | 타입 | 설명 |
|------|------|------|
| `places` | `list[dict]` | 사용자가 추가한 전체 장소 목록 |
| `travel_dates` | `list[str]` | 여행 날짜 목록 (ISO 형식, e.g. `["2025-07-01", "2025-07-02"]`) |

**장소 데이터 구조** (`places`의 각 항목):
```json
{
  "id": "uuid",
  "name": "경복궁",
  "lat": 37.5796,
  "lng": 126.9770,
  "category": "관광지",
  "is_must_visit": true,
  "kakao_place_id": "12345678"
}
```

---

## 출력

| 필드 | 타입 | 설명 |
|------|------|------|
| `valid_places` | `list[dict]` | 방문 가능한 장소 목록 (운영시간 정보 포함) |
| `excluded_places` | `list[dict]` | 제외된 장소 목록 (제외 사유 포함) |
| `messages` | `list[str]` | 완료 로그 (e.g. "Filter Agent 완료: 7개 유효, 2개 제외") |

**유효 장소 구조** (`valid_places`의 각 항목):
```json
{
  "id": "uuid",
  "name": "경복궁",
  "lat": 37.5796,
  "lng": 126.9770,
  "category": "관광지",
  "is_must_visit": true,
  "hours_source": "GOOGLE",
  "opening_hours": {
    "0": [],
    "1": [[540, 1140]],
    "2": [[540, 1140]],
    "3": [[540, 1140]],
    "4": [[540, 1140]],
    "5": [[540, 1140]],
    "6": [[540, 1140]]
  }
}
```

**`opening_hours` 구조 설명**:
- key: 요일 숫자 문자열, **Python 기준** (`"0"` = 월요일, `"6"` = 일요일)
- value: 해당 요일의 영업 시간 구간 리스트 (분 단위)
  - `[]` = 해당 요일 휴무
  - `[[540, 1140]]` = 09:00 ~ 19:00 영업
  - `[[540, 840], [960, 1260]]` = 브레이크 타임 있는 경우 (09:00~14:00, 16:00~21:00)
  - `[[1020, 120]]` = 17:00 ~ 익일 02:00 영업 (Overnight, close < open)
- `hours_source`: 운영시간 출처 (`"GOOGLE"` / `"DEFAULT"`)

**⚠️ Overnight 영업시간 처리**:

종료 시간이 시작 시간보다 작은 경우(`close_min < open_min`)는 익일 새벽까지 영업하는 케이스입니다.

```python
# 예: [[1020, 120]] → 17:00 ~ 익일 02:00
# 방문 가능 판단 시: open_min=1020, close_min=120+1440=1560 으로 정규화

def normalize_slot(open_min: int, close_min: int) -> tuple[int, int]:
    if close_min < open_min:
        close_min += 1440  # 익일로 정규화 (예: 120 → 1560)
    return open_min, close_min
```

Planner Agent는 정규화된 값을 사용하여 시간 겹침 여부를 계산합니다.

**제외 장소 구조** (`excluded_places`의 각 항목):
```json
{
  "id": "uuid",
  "name": "국립중앙박물관",
  "reason": "여행 기간(월~화) 중 방문 가능한 날이 없습니다. (월요일 휴무)"
}
```

---

## 동작 상세

### Step 1. 여행 요일 리스트 계산

`travel_dates` **전체**를 사용하여 요일 리스트를 생성합니다.  
기존의 `travel_dates[0]` 단일 기준 방식은 multi-day 여행에서 논리적으로 잘못된 결과를 냅니다.

```python
travel_dates = ["2025-07-07", "2025-07-08", "2025-07-09"]
→ travel_weekdays = [0, 1, 2]  # 월, 화, 수
```

---

### Step 2. 운영시간 병렬 수집 (`hours_resolver`)

> **파일**: `backend/services/hours_resolver.py`

모든 장소의 운영시간을 **병렬로 동시에** 조회합니다.  
Semaphore로 동시 요청 수를 제한하여 API rate limit을 준수합니다 (최대 5개 동시).

**2단계 Fallback 체계**:

```
1순위: Google Places API v1 (New Places API)
   └─ POST places:searchText → 장소명 + 좌표로 1-step 검색 및 운영시간 동시 조회
   └─ regularOpeningHours.periods → 요일별 opening_hours 추출
   └─ Google 요일 인덱스 → Python 요일 인덱스로 변환
   └─ 결과: opening_hours dict 구성

   ↓ 실패 시 (HTTP 200 외, 결과 없음, 예외 등)

2순위: 카테고리 기반 기본 시간 (DEFAULT)
   └─ DEFAULT_HOURS[category] 조회
   └─ 전 요일에 동일하게 적용
   └─ hours_source = "DEFAULT"
```

**Google Places API v1 요청 구조**:

```
POST https://places.googleapis.com/v1/places:searchText
Headers:
  X-Goog-Api-Key: {GOOGLE_PLACES_API_KEY}
  X-Goog-FieldMask: places.id,places.regularOpeningHours
Body:
  textQuery: "장소명"
  languageCode: "ko"
  locationBias.circle: { center: {lat, lng}, radius: 500.0 }
  maxResultCount: 1
```

구 API(`findplacefromtext` → `place/details` 2-step GET) 대비 개선점:
- API 호출 횟수 2N → N으로 절감
- `language=ko` 적용으로 한국어 응답 보장
- `locationBias.circle` 반경 500m 제한으로 동명이인 오매칭 감소
- HTTP 상태코드 기반 오류 감지 + 단계별 로깅 (`[Google Places]` 태그)
- 단일 `httpx.AsyncClient` 공유로 TCP 연결 오버헤드 제거

**⚠️ Google 요일 인덱스 변환 필수**:

Google Places API의 `regularOpeningHours.periods`는 **0 = 일요일** 기준입니다.  
Python `datetime.weekday()`는 **0 = 월요일** 기준입니다.  
시스템 전체는 Python 기준(0 = 월요일)으로 통일하며, 파싱 시 반드시 변환합니다.

```python
# Google: 0=일, 1=월, 2=화, ..., 6=토
# Python: 0=월, 1=화, ..., 5=토, 6=일
_GOOGLE_TO_PYTHON_WEEKDAY = {0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5}

python_weekday = _GOOGLE_TO_PYTHON_WEEKDAY[google_weekday]
```

**응답 파싱 (`_parse_new_places_periods`)**:

구 API의 `open.time` 문자열("HHMM") 방식에서 신 API의 `open.hour` + `open.minute` 정수 방식으로 변경:

```python
# 신 API 응답 예시
{"open": {"day": 1, "hour": 9, "minute": 0}, "close": {"day": 1, "hour": 17, "minute": 0}}

# 파싱
open_min  = open_data["hour"] * 60 + open_data["minute"]   # 540
close_min = close_data["hour"] * 60 + close_data["minute"]  # 1020
```

**카테고리별 기본 영업시간 (`DEFAULT_HOURS`)**:

| 카테고리 | 시간 구간 | 비고 |
|----------|-----------|------|
| `맛집` | 11:00 ~ 21:00 (660 ~ 1260) | 보수적 범위 |
| `카페` | 10:00 ~ 22:00 (600 ~ 1320) | |
| `관광지` | 09:00 ~ 20:00 (540 ~ 1200) | |
| `숙소` | 00:00 ~ 24:00 (0 ~ 1440) | 항상 접근 가능 |
| `액티비티` | 10:00 ~ 20:00 (600 ~ 1200) | |
| 그 외 | 10:00 ~ 20:00 (600 ~ 1200) | |

> 기본 시간은 넓게 잡아 false negative를 최소화합니다.  
> Planner Agent가 실제 배치 시 시간을 조정합니다.

---

### Step 3. Rule-based 필터링

LLM 없이 순수 rule-based 로직으로 각 장소를 분류합니다.

**판단 기준: 여행 기간 중 단 하루라도 방문 가능하면 valid**

```python
def is_visitable(opening_hours: dict, travel_weekdays: list[int]) -> bool:
    for weekday in travel_weekdays:
        slots = opening_hours.get(str(weekday), [])
        if slots:  # 해당 요일에 영업 구간이 하나라도 존재
            return True
    return False
```

**판정 결과**:

| 조건 | 분류 | 예시 |
|------|------|------|
| 여행 기간 중 하루라도 영업 구간 존재 | `VALID` | 화~일 영업, 여행이 월~수이면 화·수 이틀 방문 가능 |
| 모든 여행 날짜에 영업 구간 없음 (`[]`) | `EXCLUDED` | 월요일만 여행인데 월요일 휴무 |

---

### Step 4. is_must_visit 강제 포함

rule-based 판정 결과에 관계없이 `is_must_visit == true`인 장소는 **무조건 valid_places에 포함**됩니다.

```python
if place["is_must_visit"]:
    valid.append(place)  # 제외 불가
```

> 사용자가 반드시 가겠다고 명시한 장소를 시스템이 임의로 제거해서는 안 됩니다.

---

## 전체 처리 흐름

```
places (입력)
    │
    ▼
[여행 요일 리스트 계산]
travel_dates → travel_weekdays = [0, 1, 2, ...]
    │
    ▼
[운영시간 병렬 수집] ← asyncio.gather + Semaphore(5)
    ├─ Google Places API → 요일별 opening_hours dict
    └─ 실패 시: DEFAULT_HOURS[category] → 전 요일 동일 적용
    │
    ▼
places_with_hours (opening_hours 추가됨)
    │
    ▼
[Rule-based 필터링]
    ├─ travel_weekdays 중 영업일 존재? → VALID
    └─ 모든 날 휴무? → EXCLUDED
    │
    ▼
[is_must_visit 강제 포함]
    └─ is_must_visit=true → 강제 VALID (EXCLUDED 무시)
    │
    ▼
valid_places + excluded_places (출력)
```

---

## Fallback 정책 (API 키 미설정 시)

| 상황 | 동작 |
|------|------|
| `GOOGLE_PLACES_API_KEY` 미설정 | Google 단계 건너뜀 → 바로 DEFAULT_HOURS 사용 |

> LLM(ANTHROPIC_API_KEY), Tavily(TAVILY_API_KEY)는 더 이상 사용하지 않습니다.

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/agents/filter_agent.py` | Filter Agent 메인 로직 |
| `backend/services/hours_resolver.py` | 운영시간 수집 (Google → DEFAULT Fallback) |
| `backend/agents/state.py` | LangGraph State 구조 정의 |
| `backend/agents/pipeline.py` | LangGraph 파이프라인 구성 (노드 연결) |
| `backend/core/config.py` | API 키 등 환경 설정 |
| `backend/tests/test_agents.py` | Filter Agent 관련 테스트 |

---

## 변경 이력

| 버전 | 변경 내용 |
|------|-----------|
| v1 | `travel_dates[0]` 단일 기준, Claude Haiku LLM 필터링, Tavily Fallback, UNKNOWN soft-pass |
| v2 | `travel_weekdays` 전체 기준, LLM/Tavily 제거, rule-based 필터링, DEFAULT_HOURS Fallback, 요일별 `opening_hours` 구조 |
| v3 | Google Places API v1(New) 마이그레이션 — 구 API(`findplacefromtext` + `place/details` 2-step) → 신 API(`places:searchText` 1-step POST), `language=ko` 추가, `locationBias.circle` 반경 500m 적용, 단계별 예외 로깅, `httpx.AsyncClient` 공유로 성능 개선 |
