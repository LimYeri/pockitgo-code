import logging
from agents.state import ItineraryState
from agents.time_utils import to_mod_from_str

logger = logging.getLogger(__name__)


def check_day_density(day: dict) -> list[str]:
    """하루 장소 수 초과 및 총 소요 시간 과밀 경고를 생성한다."""
    warnings = []
    date_str = day.get("date", "")
    ordered_places = day.get("ordered_places", [])

    # [경고 1-1] 하루 8개 초과
    if len(ordered_places) > 8:
        warnings.append(
            f"{date_str}: 하루 일정에 {len(ordered_places)}개 장소가 포함되어 있습니다. "
            "8개 이하로 줄이는 것을 권장합니다."
        )

    # [경고 1-2] 총 소요 시간 12시간 초과
    if len(ordered_places) >= 2:
        first_start = to_mod_from_str(ordered_places[0]["start_at"])
        last_end = to_mod_from_str(ordered_places[-1]["end_at"])
        total_minutes = last_end - first_start
        if total_minutes > 720:
            total_hours = round(total_minutes / 60)
            warnings.append(
                f"{date_str}: 하루 일정의 총 소요 시간이 {total_hours}시간입니다. "
                "여유 있는 일정을 권장합니다."
            )

    return warnings


def check_place_reliability(
    place: dict,
    date_str: str,
    seen: set,
) -> list[str]:
    """장소별 place_warning을 수집하여 사용자 친화적 경고를 생성한다.

    (place_id, warning_type) 키 기반으로 중복 경고를 방지한다.
    """
    warnings = []
    place_id = place.get("place_id", "")
    place_name = place.get("name", "")

    # place_warning 필드 없는 경우 안전 처리
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


def check_default_hours(day: dict) -> list[str]:
    """DEFAULT 운영시간 장소를 수집하여 그룹화 경고를 생성한다."""
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


def check_gap(day: dict) -> list[str]:
    """인접 장소 간 45분 이상 대기 시간 발생 시 경고를 생성한다."""
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


def check_lodging_consistency(days: list[dict]) -> list[str]:
    """숙소 일정 무결성 검증.

    하루에 STAY 앵커가 2개 이상 배치된 경우 경고를 생성한다.
    (Planner의 invariant assert가 통과했어도 2차 방어선으로 동작)
    """
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


async def validator_agent(state: ItineraryState) -> dict:
    """규칙 기반으로 일정을 검증하고 경고 메시지를 생성하는 Validator 노드."""
    warnings: list[str] = []
    # seen set을 날짜 간 공유하여 중복 경고 방지
    seen: set = set()

    for day in state.get("days", []):
        date_str = day.get("date", "")
        ordered_places = day.get("ordered_places", [])

        # Step 1: 하루 장소 수 초과 및 총 소요 시간 경고
        warnings.extend(check_day_density(day))

        # Step 2: 장소별 place_warning 수집 경고
        for place in ordered_places:
            warnings.extend(check_place_reliability(place, date_str, seen))

        # Step 3: DEFAULT 운영시간 그룹화 경고
        warnings.extend(check_default_hours(day))

        # Step 4: 장소 간 대기 시간 경고
        warnings.extend(check_gap(day))

    # Step 5: 숙소 일정 무결성 검증 (날짜당 STAY 앵커 2개 이상 감지)
    warnings.extend(check_lodging_consistency(state.get("days", [])))

    return {"validation_warnings": warnings}
