"""운영시간 2단계 Fallback 수집 서비스.

수집 우선순위: Google Places API → 카테고리 기본 시간(DEFAULT_HOURS)
UNKNOWN 개념 없음 — 항상 요일별 opening_hours dict 반환.
"""
import asyncio

import httpx

from agents.time_utils import DEFAULT_FALLBACK_HOURS, DEFAULT_HOURS
from core.config import settings

# -------------------------------------------------------------------
# Google 요일 인덱스 변환
# Google: 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
# Python: 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
# -------------------------------------------------------------------
GOOGLE_TO_PYTHON_WEEKDAY: dict[int, int] = {
    0: 6,  # 일 → 6
    1: 0,  # 월 → 0
    2: 1,  # 화 → 1
    3: 2,  # 수 → 2
    4: 3,  # 목 → 3
    5: 4,  # 금 → 4
    6: 5,  # 토 → 5
}


def _parse_google_all_days(opening_hours_raw: dict) -> dict[str, list]:
    """Google opening_hours.periods에서 전체 7요일 슬롯을 파싱한다.

    반환: {"0": [[open_min, close_min], ...], "1": [...], ..., "6": [...]}
    - 키: Python 요일 문자열 (0=월 … 6=일)
    - 값: 해당 요일의 [open_min, close_min] 슬롯 리스트 (휴무면 [])
    - overnight(close_min < open_min)은 그대로 저장 (Planner가 normalize_slot 처리)
    """
    result: dict[str, list] = {str(i): [] for i in range(7)}

    periods = opening_hours_raw.get("periods", [])

    # 24시간 영업 특수 케이스: periods에 open.day=0, open.time="0000" 하나만 있고 close 없음
    if len(periods) == 1 and "close" not in periods[0]:
        return {str(i): [[0, 1440]] for i in range(7)}

    for period in periods:
        open_data = period.get("open", {})
        close_data = period.get("close")

        g_day = open_data.get("day")
        if g_day is None:
            continue

        py_day = GOOGLE_TO_PYTHON_WEEKDAY.get(g_day)
        if py_day is None:
            continue

        try:
            open_time = open_data.get("time", "")
            open_min = int(open_time[:2]) * 60 + int(open_time[2:])
        except (ValueError, IndexError):
            continue

        if close_data:
            try:
                close_time = close_data.get("time", "")
                close_min = int(close_time[:2]) * 60 + int(close_time[2:])
            except (ValueError, IndexError):
                close_min = 1440
        else:
            close_min = 1440  # close 없으면 자정까지

        result[str(py_day)].append([open_min, close_min])

    return result


def _make_default_opening_hours(category: str) -> dict[str, list]:
    """카테고리 기본 슬롯을 전체 7요일에 동일 적용한 opening_hours dict를 생성한다."""
    slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
    return {str(i): slots for i in range(7)}


# -------------------------------------------------------------------
# 1순위: Google Places Details API
# -------------------------------------------------------------------

async def try_google_places(place: dict, semaphore: asyncio.Semaphore) -> dict | None:
    """Google Places API로 전체 요일 운영시간을 조회한다.

    반환: {hours_source: 'GOOGLE', opening_hours: dict} 또는 None
    """
    if not settings.GOOGLE_PLACES_API_KEY:
        return None

    async with semaphore:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Step 1: 장소 ID 조회
                search_resp = await client.get(
                    "https://maps.googleapis.com/maps/api/place/findplacefromtext/json",
                    params={
                        "input": place["name"],
                        "inputtype": "textquery",
                        "fields": "place_id",
                        "locationbias": f"point:{place['lat']},{place['lng']}",
                        "key": settings.GOOGLE_PLACES_API_KEY,
                    },
                )
                candidates = search_resp.json().get("candidates", [])
                if not candidates:
                    return None

                # Step 2: 운영시간 상세 조회
                details_resp = await client.get(
                    "https://maps.googleapis.com/maps/api/place/details/json",
                    params={
                        "place_id": candidates[0]["place_id"],
                        "fields": "opening_hours",
                        "key": settings.GOOGLE_PLACES_API_KEY,
                    },
                )
                oh = details_resp.json().get("result", {}).get("opening_hours")
                if not oh:
                    return None

                opening_hours = _parse_google_all_days(oh)
                return {
                    "hours_source": "GOOGLE",
                    "opening_hours": opening_hours,
                }
        except Exception:
            return None


# -------------------------------------------------------------------
# 통합 resolver
# -------------------------------------------------------------------

async def hours_resolver(
    place: dict,
    sema_google: asyncio.Semaphore,
    request_cache: dict | None = None,
) -> dict:
    """2단계 Fallback으로 운영시간을 수집한다.

    1순위: Google Places API → 7요일 opening_hours dict
    2순위: DEFAULT_HOURS[category] → 전 요일 동일 슬롯 적용

    반환: {hours_source: 'GOOGLE' | 'DEFAULT', opening_hours: dict}
    - opening_hours 키: '0'(월) ~ '6'(일) Python 요일 기준
    - 항상 opening_hours dict 반환 (UNKNOWN 없음)
    """
    if request_cache is None:
        request_cache = {}

    cache_key = (
        place.get("kakao_place_id")
        or place.get("id")
        or f"{place['name']}_{place['lat']}_{place['lng']}"
    )

    if cache_key and cache_key in request_cache:
        return request_cache[cache_key]

    # 1순위: Google Places
    result = await try_google_places(place, sema_google)

    # 2순위: DEFAULT_HOURS fallback
    if not result:
        category = place.get("category", "")
        result = {
            "hours_source": "DEFAULT",
            "opening_hours": _make_default_opening_hours(category),
        }

    if cache_key:
        request_cache[cache_key] = result

    return result
