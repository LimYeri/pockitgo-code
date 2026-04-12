"""Filter Agent — 운영시간 병렬 수집 + Rule-based 방문 가능 여부 판정.

LLM 없음. 여행 기간 전체 요일 기준으로 하루라도 방문 가능하면 valid.
is_must_visit=true 장소는 무조건 valid_places에 포함.
항상 opening_hours dict 반환 (UNKNOWN 없음).
"""
import asyncio
from datetime import date

import httpx

from agents.state import ItineraryState
from agents.time_utils import DEFAULT_FALLBACK_HOURS, DEFAULT_HOURS
from services.hours_resolver import hours_resolver

_WEEKDAY_KO = ["월", "화", "수", "목", "금", "토", "일"]


def is_visitable(opening_hours: dict, travel_weekdays: list[int]) -> bool:
    """여행 기간 중 단 하루라도 방문 가능하면 True를 반환한다.

    opening_hours 키: '0'(월) ~ '6'(일) Python 요일 기준
    슬롯이 하나라도 있으면 해당 요일에 방문 가능한 것으로 판단.
    """
    for weekday in travel_weekdays:
        if opening_hours.get(str(weekday), []):
            return True
    return False


async def filter_agent(state: ItineraryState) -> dict:
    """운영 불가 장소를 분류하고 유효 장소 목록을 반환한다.

    Step 1. 여행 전체 날짜 → travel_weekdays 리스트 계산
    Step 2. 운영시간 병렬 수집 (Google → DEFAULT_HOURS Fallback)
    Step 3. Rule-based 필터링 (여행 기간 중 하루라도 영업일 존재 → valid)
    Step 4. is_must_visit=true 강제 포함
    """
    places = state.get("places", [])
    travel_dates = state.get("travel_dates", [])

    # Step 1. 여행 전체 요일 리스트 계산
    travel_weekdays: list[int] = [
        date.fromisoformat(d).weekday() for d in travel_dates
    ]

    # Step 2. 운영시간 병렬 수집
    sema_g = asyncio.Semaphore(5)
    request_cache: dict = {}

    async with httpx.AsyncClient(timeout=10.0) as shared_client:
        hours_results = await asyncio.gather(
            *[hours_resolver(p, sema_g, request_cache, shared_client) for p in places],
            return_exceptions=True,
        )

    # 예외 발생 시 해당 카테고리의 DEFAULT_HOURS로 대체
    places_with_hours = []
    for p, hr in zip(places, hours_results):
        if isinstance(hr, Exception):
            category = p.get("category", "")
            slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
            hr = {
                "hours_source": "DEFAULT",
                "opening_hours": {str(i): slots for i in range(7)},
            }
        places_with_hours.append({**p, **hr})

    # Step 3 & 4. Rule-based 필터링 + is_must_visit 강제 포함
    valid: list[dict] = []
    excluded: list[dict] = []

    # 여행 요일 한국어 이름 (excluded reason 메시지용)
    weekday_names = "·".join(
        _WEEKDAY_KO[wd] for wd in sorted(set(travel_weekdays))
    )

    for p in places_with_hours:
        opening_hours = p.get("opening_hours", {})

        # is_must_visit=true → 무조건 valid (제외 불가)
        if p.get("is_must_visit"):
            valid.append(p)
            continue

        if is_visitable(opening_hours, travel_weekdays):
            valid.append(p)
        else:
            excluded.append({
                "id": p["id"],
                "name": p.get("name", ""),
                "reason": (
                    f"여행 기간({weekday_names}) 중 방문 가능한 날이 없습니다."
                ),
            })

    return {
        "valid_places": valid,
        "excluded_places": excluded,
        "messages": [
            f"Filter Agent 완료: {len(valid)}개 유효, {len(excluded)}개 제외"
        ],
    }
