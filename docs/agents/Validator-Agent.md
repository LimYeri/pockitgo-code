# Validator Agent

> **파일**: `backend/agents/validator.py`
> **역할**: Planner Agent가 생성한 일정을 사후 검증하고, 사용자에게 표시할 경고 메시지를 생성합니다.

---

## 설계 원칙

- **사후 경고 전담**: Planner의 내부 수정(repair_conflict)과 역할을 분리. 일정을 **바꾸지 않고** 경고만 생성
- **Planner 경고 수집**: Planner가 각 장소에 부착한 `place_warning` 필드를 수집하여 사용자 친화적 메시지로 변환
- **Rule-based**: LLM 미사용. 외부 API 호출 없음. 경량 노드
- **정보 제공 목적**: 경고는 일정 차단이 아닌 사용자 안내용
- **Deduplication**: 동일 장소·유형 경고 중복 방지 (`(place_id, warning_type)` 키 기반)
- **경고 그룹화**: DEFAULT 경고가 다수일 경우 요약하여 노이즈 최소화

---

## 입력

| 필드 | 타입 | 설명 |
|------|------|------|
| `days` | `list[dict]` | Planner Agent가 생성한 날짜별 일정 목록 |

**`days`의 각 항목 구조**:
```json
{
  "date": "2025-07-01",
  "ordered_places": [
    {
      "place_id": "uuid",
      "name": "경복궁",
      "category": "관광지",
      "start_at": "09:00",
      "end_at": "11:00",
      "travel_minutes_from_prev": 15,
      "hours_source": "DEFAULT",
      "place_warning": {
        "warning_type": "MUST_VISIT_CLOSED",
        "warning_message": "해당 장소는 휴무일일 가능성이 높으나, 설정하신 필수 장소이므로 일정에 포함되었습니다."
      }
    }
  ]
}
```

---

## 출력

| 필드 | 타입 | 설명 |
|------|------|------|
| `validation_warnings` | `list[str]` | 사용자에게 표시할 경고 메시지 목록 |

```json
{
  "validation_warnings": [
    "2025-07-01: 하루 일정에 9개 장소가 포함되어 있습니다. 8개 이하로 줄이는 것을 권장합니다.",
    "2025-07-01: 하루 일정의 총 소요 시간이 13시간입니다. 여유 있는 일정을 권장합니다.",
    "2025-07-01 경복궁: 여행 기간 중 운영시간 외 배치되었습니다. 필수 방문 장소이므로 포함되었으나, 방문 전 운영 여부를 확인하세요.",
    "2025-07-01 제주 흑돼지 맛집: 예약 시각보다 20분 늦게 도착할 수 있습니다. 일정 조정을 권장합니다.",
    "2025-07-01: 경복궁 외 3곳의 운영 시간이 카테고리 기본값으로 추정되었습니다. 방문 전 확인을 권장합니다.",
    "2025-07-01: 국립민속박물관 → 인사동 사이에 45분 대기 시간이 발생합니다."
  ]
}
```

---

## 동작 상세

### Step 1. 하루 장소 수 초과 경고

하루 일정에 장소가 8개를 초과하면 경고를 생성합니다.

```python
def check_day_density(day: dict) -> list[str]:
    warnings = []
    date_str = day.get("date", "")
    ordered_places = day.get("ordered_places", [])

    # [경고 1-1] 하루 8개 초과
    if len(ordered_places) > 8:
        warnings.append(
            f"{date_str}: 하루 일정에 {len(ordered_places)}개 장소가 포함되어 있습니다. "
            "8개 이하로 줄이는 것을 권장합니다."
        )

    # [경고 1-2] 총 소요 시간 초과 (12시간 기준)
    if len(ordered_places) >= 2:
        first_start = to_mod_from_str(ordered_places[0]["start_at"])
        last_end = to_mod_from_str(ordered_places[-1]["end_at"])
        total_minutes = last_end - first_start
        if total_minutes > 720:  # 12시간 초과
            total_hours = round(total_minutes / 60)
            warnings.append(
                f"{date_str}: 하루 일정의 총 소요 시간이 {total_hours}시간입니다. "
                "여유 있는 일정을 권장합니다."
            )

    return warnings
```

> Planner Agent가 repair_conflict 단계에서 초과를 방지하려 하지만, 핀 장소나 `is_must_visit` 강제 포함으로 인해 초과될 수 있습니다.

---

### Step 2. 장소별 신뢰도 경고

각 장소의 `hours_source`와 `place_warning`을 확인하여 경고를 생성합니다.  
**Deduplication**: `(place_id, warning_type)` 조합이 이미 처리된 경우 건너뜁니다.

```python
def check_place_reliability(
    place: dict,
    date_str: str,
    seen: set,
) -> list[str]:
    warnings = []
    place_id = place.get("place_id", "")
    place_name = place.get("name", "")

    # place_warning 구조 안정화: 필드 존재 여부 확인
    place_warning = place.get("place_warning") or {}
    warning_type = place_warning.get("type", "")
    late_by_minutes = place_warning.get("late_by_minutes")

    if warning_type:
        key = (place_id, warning_type)
        if key not in seen:
            seen.add(key)

            if warning_type == "MUST_VISIT_CLOSED":
                warnings.append(
                    f"{date_str} {place_name}: 여행 기간 중 운영시간 외 배치되었습니다. "
                    "필수 방문 장소이므로 포함되었으나, 방문 전 운영 여부를 확인하세요."
                )
            elif warning_type == "RESERVATION_LATE":
                late_min = late_by_minutes or 0
                warnings.append(
                    f"{date_str} {place_name}: 예약 시각보다 {late_min}분 늦게 도착할 수 있습니다. "
                    "일정 조정을 권장합니다."
                )

    return warnings
```

**`place_warning` 타입 목록** (Planner Agent 정의):

| warning_type | 발생 조건 | 필드 |
|------|-----------|------|
| `MUST_VISIT_CLOSED` | `is_must_visit=true` 장소가 운영시간 외 배치 | `warning_type`, `warning_message` |
| `RESERVATION_LATE` | RESERVATION 핀 장소에 30분 이내 지각 | `warning_type`, `warning_message` (지각 분은 메시지에 포함) |

---

### Step 3. DEFAULT 운영시간 경고 (그룹화)

`hours_source == "DEFAULT"`인 장소는 Google Places API 조회에 실패하여 카테고리 기본 시간을 사용한 것입니다.  
경고가 다수일 경우 **그룹화**하여 반복 노이즈를 줄입니다.

```python
def check_default_hours(day: dict) -> list[str]:
    warnings = []
    date_str = day.get("date", "")
    ordered_places = day.get("ordered_places", [])

    default_places = [
        p.get("name", "") for p in ordered_places
        if p.get("hours_source") == "DEFAULT"
    ]
    count = len(default_places)

    if count == 0:
        return warnings
    elif count == 1:
        warnings.append(
            f"{date_str} {default_places[0]}: 운영 시간이 카테고리 기본값으로 추정되었습니다. "
            "실제 운영 시간과 다를 수 있으니 방문 전 확인을 권장합니다."
        )
    elif count <= 3:
        names = ", ".join(default_places)
        warnings.append(
            f"{date_str}: {names}의 운영 시간이 카테고리 기본값으로 추정되었습니다. "
            "방문 전 확인을 권장합니다."
        )
    else:
        # 3개 초과: 첫 장소 + 나머지 수 요약
        warnings.append(
            f"{date_str}: {default_places[0]} 외 {count - 1}곳의 운영 시간이 "
            "카테고리 기본값으로 추정되었습니다. 방문 전 확인을 권장합니다."
        )

    return warnings
```

**`hours_source` 값 체계** (Filter Agent v2 기준):

| 값 | 의미 |
|----|------|
| `"GOOGLE"` | Google Places API에서 직접 조회한 실제 운영시간 |
| `"DEFAULT"` | Google 조회 실패 → 카테고리 기본 시간 적용 |

---

### Step 4. Gap(대기 시간) 경고

이전 장소 종료 후 이동 시간을 제외하고도 45분 이상 대기가 발생하면 경고합니다.

```python
def check_gap(day: dict) -> list[str]:
    warnings = []
    date_str = day.get("date", "")
    ordered_places = day.get("ordered_places", [])

    for i in range(1, len(ordered_places)):
        prev = ordered_places[i - 1]
        curr = ordered_places[i]

        # STAY 앵커는 end_at=None이므로 대기 시간 계산에서 제외
        if prev.get("end_at") is None or curr.get("start_at") is None:
            continue

        prev_end = to_mod_from_str(prev.get("end_at", "00:00"))
        curr_start = to_mod_from_str(curr.get("start_at", "00:00"))
        travel = curr.get("travel_minutes_from_prev", 0) or 0

        gap = curr_start - prev_end - travel
        if gap >= 45:
            warnings.append(
                f"{date_str}: {prev.get('name', '')} → {curr.get('name', '')} "
                f"사이에 {gap}분 대기 시간이 발생합니다."
            )

    return warnings
```

---

### Step 5. 숙소 일정 무결성 검증

하루에 STAY 앵커(숙소)가 2개 이상 배치된 경우 경고를 생성합니다.  
Planner의 `invariant assert`가 통과했더라도 2차 방어선으로 동작합니다.

```python
def check_lodging_consistency(days: list[dict]) -> list[str]:
    warnings = []
    for day in days:
        stay_places = [
            p for p in day.get("ordered_places", [])
            if p.get("pin_type") == "STAY"
        ]
        if len(stay_places) > 1:
            names = ", ".join(p.get("name", "") for p in stay_places)
            warnings.append(
                f"{day.get('date', '')}: 숙소가 {len(stay_places)}개 배치되었습니다 ({names}). "
                "체크인 날짜를 확인해주세요."
            )
    return warnings
```

> `check_lodging_consistency`는 모든 날짜를 한 번에 순회하므로, `validator_agent`에서 날짜 루프 외부에서 호출됩니다.

---

## 전체 처리 흐름

```
days (Planner Agent 출력)
    │
    ▼
[날짜별 순회]
    │
    ├─ [Step 1] check_day_density()
    │    ├─ 하루 8개 초과? → 경고
    │    └─ 총 소요 시간 12시간 초과? → 경고
    │
    ├─ [Step 2] check_place_reliability()  ← seen = set() (날짜 간 공유)
    │    ├─ place_warning.warning_type == "MUST_VISIT_CLOSED" → 경고
    │    └─ place_warning.warning_type == "RESERVATION_LATE"  → 경고 (warning_message에서 지각 분 추출)
    │
    ├─ [Step 3] check_default_hours()
    │    └─ DEFAULT 장소 수에 따라 단건/그룹 경고
    │
    └─ [Step 4] check_gap()
         ├─ STAY 앵커(end_at=None) 쌍 → 건너뜀
         └─ gap >= 45분 → 경고
    │
    ▼
[날짜 루프 외부]
    │
    └─ [Step 5] check_lodging_consistency()
         └─ 하루에 STAY 앵커 2개 이상 → 경고
    │
    ▼
validation_warnings (출력)
```

---

## Planner와 역할 분담

| 검증 항목 | Planner Agent | Validator Agent |
|----------|---------------|-----------------|
| 운영시간 충돌 자동 수정 | ✓ (repair_conflict 5단계) | ✗ |
| 일정 다른 날짜로 이동 | ✓ | ✗ |
| 당일 시간 시프트 | ✓ | ✗ |
| MUST_VISIT 강제 포함 | ✓ | ✗ |
| RESERVATION 시간 조정 | ✓ | ✗ |
| 하루 8개 초과 **경고** | ✗ | ✓ |
| 총 소요 시간 과밀 **경고** | ✗ | ✓ |
| DEFAULT 운영시간 **경고** | ✗ | ✓ (그룹화) |
| MUST_VISIT_CLOSED **경고** 수집 | ✗ (생성만) | ✓ (수집·변환) |
| RESERVATION_LATE **경고** 수집 | ✗ (생성만) | ✓ (수집·변환) |
| Gap 대기시간 **경고** | ✗ | ✓ |
| 숙소 중복 배치 **경고** | ✗ (assert로 방어) | ✓ (2차 방어) |

> Planner는 일정을 **수정**하고, Validator는 사용자에게 **알립니다**.

---

## 향후 고려 항목

현재 단계에서는 구현하지 않지만, 차후 추가를 고려할 수 있는 경고입니다.

| 항목 | 설명 | 보류 이유 |
|------|------|-----------|
| 이동 시간 부족 경고 | 거리 대비 이동 시간이 너무 짧은 경우 | false positive 위험. Kakao Mobility 실거리 기준이므로 별도 검증 필요 |
| 식사 일정 없음 경고 | 점심·저녁 시간대에 맛집 없음 | 사용자 여행 스타일(간식 위주 등) 미반영 위험 |
| 카테고리 편중 경고 | 카페만 5개 등 특정 카테고리 과다 | 사용자 의도가 명확한 경우 false negative 위험 |

---

## 관련 파일 목록

| 파일 | 역할 |
|------|------|
| `backend/agents/validator.py` | Validator Agent 메인 로직 |
| `backend/agents/planner_agent.py` | `place_warning` 생성 (`MUST_VISIT_CLOSED`, `RESERVATION_LATE`) |
| `backend/agents/state.py` | `validation_warnings` 필드 포함 State 정의 |
| `backend/agents/pipeline.py` | Filter → Planner → **Validator** → Alternative |
| `backend/tests/test_agents.py` | Validator Agent 관련 테스트 |

---

## 변경 이력

| 버전 | 변경 내용 |
|------|-----------|
| v1 | `HEURISTIC`/`UNKNOWN` 기반 경고 (Filter v1 기준, 현재 발동 안됨) |
| v2 | `DEFAULT` 기반 경고, `place_warning` 수집, `original_hours_source` 참조 제거 |
| v3 | `LATE` → `RESERVATION_LATE` 통일, 날짜 context 추가, deduplication, `place_warning` 구조 안정화, DEFAULT 경고 그룹화, gap 경고, 총 소요 시간 과밀 경고, 함수 분리 구조 (`check_day_density`, `check_place_reliability`, `check_default_hours`, `check_gap`) |
| v4 | `check_gap`에 STAY 앵커 null 체크 추가 (`end_at=None` 쌍 건너뜀), `check_lodging_consistency` 신규 추가 (날짜당 STAY 앵커 2개 이상 경고), `place_warning` 필드명 변경 반영 (`type`/`message`/`late_by_minutes` → `warning_type`/`warning_message`) |
