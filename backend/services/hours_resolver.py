"""운영시간 2단계 Fallback 수집 서비스.

수집 우선순위: Google Places API (New v1) → 카테고리 기본 시간(DEFAULT_HOURS)
UNKNOWN 개념 없음 — 항상 요일별 opening_hours dict 반환.
"""
import asyncio
import logging

import httpx

from agents.time_utils import DEFAULT_FALLBACK_HOURS, DEFAULT_HOURS
from core.config import settings

# -------------------------------------------------------------------
# Google 요일 인덱스 변환
# Google Places API (신구 공통): 0=일, 1=월, 2=화, 3=수, 4=목, 5=금, 6=토
# Python: 0=월, 1=화, 2=수, 3=목, 4=금, 5=토, 6=일
# -------------------------------------------------------------------
_GOOGLE_TO_PYTHON_WEEKDAY: dict[int, int] = {
    0: 6,  # 일 → 6
    1: 0,  # 월 → 0
    2: 1,  # 화 → 1
    3: 2,  # 수 → 2
    4: 3,  # 목 → 3
    5: 4,  # 금 → 4
    6: 5,  # 토 → 5
}

_NEW_PLACES_API_URL = "https://places.googleapis.com/v1/places:searchText"
_FIELD_MASK = "places.id,places.regularOpeningHours"


def _parse_new_places_periods(periods: list) -> dict[str, list]:
    """Google Places API v1의 regularOpeningHours.periods를 파싱한다.

    반환: {"0": [[open_min, close_min], ...], ..., "6": [...]}
    - 키: Python 요일 문자열 (0=월 … 6=일)
    - 값: 해당 요일의 [open_min, close_min] 슬롯 리스트 (휴무면 [])
    - overnight(close_min < open_min)은 그대로 저장 (Planner가 normalize_slot 처리)
    - 구 API: open.time 문자열("HHMM") / 신 API: open.hour + open.minute 정수
    """
    result: dict[str, list] = {str(i): [] for i in range(7)}

    # 24시간 영업 특수 케이스: period 1개 + close 없음
    if len(periods) == 1 and "close" not in periods[0]:
        return {str(i): [[0, 1440]] for i in range(7)}

    for period in periods:
        open_data = period.get("open", {})
        close_data = period.get("close")

        g_day = open_data.get("day")
        if g_day is None:
            continue

        py_day = _GOOGLE_TO_PYTHON_WEEKDAY.get(g_day)
        if py_day is None:
            continue

        try:
            open_min = int(open_data.get("hour", 0)) * 60 + int(open_data.get("minute", 0))
        except (ValueError, TypeError):
            continue

        if close_data:
            try:
                close_min = int(close_data.get("hour", 0)) * 60 + int(close_data.get("minute", 0))
                # close.day가 open.day와 다르면 익일 닫힘 (자정 초과) → 1440 추가
                # 예: open.day=1(월), close.day=2(화), close.hour=0 → close_min=1440 (24:00)
                g_close_day = close_data.get("day")
                if g_close_day is not None and g_close_day != g_day:
                    close_min += 1440
            except (ValueError, TypeError):
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
# 1순위: Google Places API v1 (New Places API)
# -------------------------------------------------------------------

async def try_google_places(
    place: dict,
    semaphore: asyncio.Semaphore,
    client: httpx.AsyncClient,
) -> dict | None:
    """Google Places API v1 (New)로 전체 요일 운영시간을 1-step으로 조회한다.

    반환: {hours_source: 'GOOGLE', opening_hours: dict} 또는 None
    """
    if not settings.GOOGLE_PLACES_API_KEY:
        return None

    name = place.get("name", "")
    async with semaphore:
        try:
            resp = await client.post(
                _NEW_PLACES_API_URL,
                headers={
                    "X-Goog-Api-Key": settings.GOOGLE_PLACES_API_KEY,
                    "X-Goog-FieldMask": _FIELD_MASK,
                },
                json={
                    "textQuery": name,
                    "languageCode": "ko",
                    "locationBias": {
                        "circle": {
                            "center": {
                                "latitude": place["lat"],
                                "longitude": place["lng"],
                            },
                            "radius": 500.0,
                        }
                    },
                    "maxResultCount": 1,
                },
            )

            if resp.status_code != 200:
                logging.warning(
                    "[Google Places] HTTP %s: %s",
                    resp.status_code, name,
                )
                return None

            data = resp.json()
            places_list = data.get("places", [])
            if not places_list:
                return None

            regular_hours = places_list[0].get("regularOpeningHours")
            if not regular_hours:
                return None

            periods = regular_hours.get("periods", [])
            if not periods:
                # periods 없는 경우 (연중무휴 야외 관광지 등) DEFAULT fallback
                return None

            opening_hours = _parse_new_places_periods(periods)

            # 파싱 후 모든 요일 슬롯이 비어 있으면 DEFAULT fallback
            if not any(slots for slots in opening_hours.values()):
                return None

            return {
                "hours_source": "GOOGLE",
                "opening_hours": opening_hours,
            }
        except httpx.TimeoutException:
            logging.warning("[Google Places] timeout: %s", name)
            return None
        except httpx.HTTPStatusError as e:
            logging.error(
                "[Google Places] HTTP %s: %s",
                e.response.status_code, name,
            )
            return None
        except Exception as e:
            logging.error("[Google Places] unexpected: %s %s", name, e)
            return None


# -------------------------------------------------------------------
# 통합 resolver
# -------------------------------------------------------------------

async def hours_resolver(
    place: dict,
    sema_google: asyncio.Semaphore,
    request_cache: dict | None = None,
    client: httpx.AsyncClient | None = None,
) -> dict:
    """2단계 Fallback으로 운영시간을 수집한다.

    1순위: Google Places API v1 → 7요일 opening_hours dict
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
    if client is not None:
        result = await try_google_places(place, sema_google, client)
    else:
        # client가 주입되지 않은 경우 임시 클라이언트 생성 (하위 호환)
        async with httpx.AsyncClient(timeout=10.0) as _client:
            result = await try_google_places(place, sema_google, _client)

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
