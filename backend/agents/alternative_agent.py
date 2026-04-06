"""Alternative Agent — 각 장소의 플랜 B/C 대안을 탐색한다.

반경 500m→1km→2km 가변 확장. used_alt_ids 전역 공유 순차 실행.
asyncio.gather 미사용 — race condition 방지.
"""
import logging
from datetime import datetime

from agents.state import ItineraryState
from agents.time_utils import DEFAULT_FALLBACK_HOURS, DEFAULT_HOURS, haversine_meters
from core.config import settings
from services.kakao import search_nearby

logger = logging.getLogger(__name__)

# 반경 순서: 가변 확장
SEARCH_RADII = [500, 1000, 2000]

# Kakao API 카테고리 코드 → 내부 카테고리명
KAKAO_CODE_TO_CATEGORY: dict[str, str] = {
    "FD6": "맛집",
    "CE7": "카페",
    "AT4": "관광지",
    "AD5": "숙소",
    "CT1": "액티비티",
}

# 기본 방문 시작 시간 (09:30 = 570분)
DEFAULT_VISIT_START = 570

# 내부 후보(위시리스트) 탐색 반경 (m)
MAX_INTERNAL_RADIUS = 7000
MAX_INTERNAL_RADIUS_EX = 15000

# 맛집 cuisine 분류 키워드 목록
CUISINE_KEYWORDS = ["한식", "일식", "중식", "양식", "분식", "해산물", "고기", "치킨"]

# 관광지 방문 허용 최대 시간 (18:00 = 1080분)
SIGHTSEEING_CLOSE = 1080


def check_alt_availability(category: str, visit_start_at: int, weekday: int = 0) -> bool:
    """DEFAULT_HOURS 기반으로 대안 장소 방문 가능 여부를 확인한다.

    슬롯이 없거나 전일 영업(숙소 등)이면 soft-pass(True) 반환.
    관광지는 18:00(1080분) 이후 방문 불가.

    Args:
        category: 장소 카테고리
        visit_start_at: 방문 시작 시각 (자정 기준 분)
        weekday: 요일 (0=월요일, 6=일요일, 향후 확장 포인트)
    """
    # 관광지 18:00 이후 방문 불가
    if category == "관광지" and visit_start_at > SIGHTSEEING_CLOSE:
        return False

    slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
    if not slots:
        return True  # 빈 슬롯 → soft-pass

    open_mod, close_mod = slots[0][0], slots[0][1]
    # 숙소(0~1440)는 항상 True
    if open_mod == 0 and close_mod == 1440:
        return True

    return open_mod <= visit_start_at <= close_mod


def get_cuisine(category_name: str) -> str | None:
    """Kakao category_name에서 cuisine 키워드를 추출한다.

    예: "음식점 > 한식 > 삼계탕" → "한식"
    매칭 키워드 없으면 None 반환.
    """
    for keyword in CUISINE_KEYWORDS:
        if keyword in category_name:
            return keyword
    return None


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
    """위시리스트(valid_places)에서 내부 대안 후보를 필터링한다.

    필터 조건:
    - 자기 자신 제외 (place_id 일치)
    - 같은 날 배치된 장소 제외 (same_day_ids)
    - 카테고리 불일치 제외
    - 방문 불가 시간대 제외
    - max_radius 초과 거리 제외

    반환 dict에는 distance_m 필드가 포함된다.
    """
    category = place.get("category", "관광지")
    place_id = place.get("place_id") or place.get("id", "")

    candidates: list[dict] = []
    for p in valid_places:
        pid = p.get("id", "")

        # 자기 자신 제외
        if pid == place_id:
            continue

        # 같은 날 배치 장소 제외
        if pid in same_day_ids:
            continue

        # 카테고리 불일치 제외
        if p.get("category") != category:
            continue

        # 방문 불가 시간대 제외
        if not check_alt_availability(p.get("category", ""), visit_start_at, weekday):
            continue

        # 반경 초과 제외
        dist = haversine_meters(
            origin_lat, origin_lng,
            float(p.get("lat", 0)), float(p.get("lng", 0)),
        )
        if dist > max_radius:
            continue

        candidates.append({**p, "distance_m": dist})

    return candidates


def score_candidate(
    candidate: dict,
    origin_lat: float,
    origin_lng: float,
    visit_start_at: int,
    category: str,
    origin_cuisine: str | None = None,
) -> float:
    """대안 후보의 종합 점수를 계산한다.

    점수 구성:
    - 거리 패널티:    -distance_m * 0.3
    - 시간 적합도:    max(0, 200 - abs(visit_start_at - center_time))
    - 카테고리 일치:  +300 (동일 카테고리)
    - cuisine 부스팅: +200 (맛집 cuisine 일치)
    """
    distance_m = candidate.get("distance_m")
    if distance_m is None:
        distance_m = haversine_meters(
            origin_lat, origin_lng,
            float(candidate.get("lat", 0)), float(candidate.get("lng", 0)),
        )

    distance_score = -distance_m * 0.3

    slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
    center_time = (slots[0][0] + slots[0][1]) / 2 if slots else 900.0
    time_fit_bonus = max(0.0, 200.0 - abs(visit_start_at - center_time))

    category_match_bonus = 300.0 if candidate.get("category") == category else 0.0

    cuisine_bonus = 0.0
    if origin_cuisine and get_cuisine(candidate.get("category_name", "")) == origin_cuisine:
        cuisine_bonus = 200.0

    return distance_score + time_fit_bonus + category_match_bonus + cuisine_bonus


async def find_external(
    lat: float,
    lng: float,
    category: str,
    exclude_ids: set[str],
    visit_start_at: int,
    weekday: int,
    need: int,
) -> list[dict]:
    """Kakao Maps API로 외부 대안 후보를 탐색한다.

    SEARCH_RADII 순으로 반경을 확장하며 need 개 이상 확보되면 중단.
    source 필드는 find_alternatives에서 부착하므로 여기서는 미포함.
    """
    alts: list[dict] = []

    for radius in SEARCH_RADII:
        candidates = await search_nearby(lat, lng, category, radius, size=8)

        for r in candidates:
            kakao_id = r.get("id", "")
            if kakao_id in exclude_ids:
                continue

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


async def find_alternatives(
    place: dict,
    exclude_ids: set[str],
    same_day_ids: set[str],
    valid_places: list[dict],
    weekday: int,
) -> tuple[str, list[dict]]:
    """장소에 대한 대안(플랜 B/C)을 Hybrid 방식으로 탐색한다.

    Step 1: 위시리스트(valid_places) 내부 후보 우선 탐색 (7km → 15km 확장)
    Step 2: 부족분만 Kakao API 외부 탐색으로 보완
    Step 3: 스코어링 정렬 후 다양성(동일 카테고리 + 인접 카테고리) 선택
    각 대안에는 distance_m, source(INTERNAL/EXTERNAL) 필드가 포함된다.
    """
    place_id = place.get("place_id") or place.get("id", "")
    lat = float(place.get("lat", 0))
    lng = float(place.get("lng", 0))
    category = place.get("category", "관광지")

    # 방문 시작 시간: start_at 문자열("HH:MM") 또는 기본값(09:30)
    start_at = place.get("start_at")
    if start_at and isinstance(start_at, str):
        try:
            h, m = start_at.split(":")
            visit_start_at = int(h) * 60 + int(m)
        except (ValueError, AttributeError):
            visit_start_at = DEFAULT_VISIT_START
    elif isinstance(start_at, int):
        visit_start_at = start_at
    else:
        visit_start_at = DEFAULT_VISIT_START

    # 맛집 cuisine 추출 (부스팅 스코어링용)
    origin_cuisine = get_cuisine(place.get("category_name", "")) if category == "맛집" else None

    # Step 1: 내부 탐색 (7km 이내)
    internal = filter_internal(
        place, valid_places, same_day_ids,
        lat, lng, visit_start_at, weekday,
        max_radius=MAX_INTERNAL_RADIUS,
    )
    # 7km 이내 후보 없으면 15km 확장 재탐색
    if not internal:
        internal = filter_internal(
            place, valid_places, same_day_ids,
            lat, lng, visit_start_at, weekday,
            max_radius=MAX_INTERNAL_RADIUS_EX,
        )

    # Step 2: 부족분 외부 탐색 (KAKAO_API_KEY 설정된 경우에만)
    need = max(0, 2 - len(internal))
    external: list[dict] = []
    if need > 0 and settings.KAKAO_API_KEY:
        external = await find_external(
            lat, lng, category, exclude_ids,
            visit_start_at, weekday, need,
        )

    # Step 3: Hybrid 병합 + source 필드 부착
    all_candidates: list[dict] = [
        {**p, "source": "INTERNAL"} for p in internal
    ] + [
        {**p, "source": "EXTERNAL"} for p in external
    ]

    # 정렬 (스코어 내림차순)
    ranked = sorted(
        all_candidates,
        key=lambda c: score_candidate(c, lat, lng, visit_start_at, category, origin_cuisine),
        reverse=True,
    )

    # 다양성: alt1=동일 카테고리, alt2=다른 카테고리 우선
    same_cat = [c for c in ranked if c.get("category") == category]
    diff_cat = [c for c in ranked if c.get("category") != category]
    alts = same_cat[:1] + diff_cat[:1]
    if len(alts) < 2:
        alts = ranked[:2]

    # 출력 필드 정제
    def _format(c: dict) -> dict:
        return {
            "name": c.get("name") or c.get("place_name", ""),
            "lat": float(c.get("lat") or c.get("y", 0)),
            "lng": float(c.get("lng") or c.get("x", 0)),
            "address": c.get("address") or c.get("road_address_name") or c.get("address_name", ""),
            "kakao_place_id": c.get("kakao_place_id") or c.get("id", ""),
            "category": c.get("category", category),
            "distance_m": c.get("distance_m", 0),
            "source": c.get("source", "EXTERNAL"),
        }

    return place_id, [_format(a) for a in alts]


async def alternative_agent(state: ItineraryState) -> dict:
    """각 장소의 플랜 B/C 대안을 순차 탐색한다.

    asyncio.gather 미사용 — race condition 방지.
    used_alt_ids_by_day: 날짜별 독립 set으로 관리하여 같은 날 중복 추천 방지.
    다른 날짜 장소는 동일 kakao_place_id 대안 허용.
    """
    days = state.get("days", [])
    valid_places = state.get("valid_places", [])

    # valid_places에서 Supabase place_id → kakao_place_id 매핑 구성
    kakao_id_by_place_id: dict[str, str] = {
        p["id"]: p.get("kakao_place_id", "") for p in valid_places
    }

    # 모든 날짜의 ordered_places 합산 + 날짜별 place_id 집합 구성
    all_places: list[dict] = []
    places_by_date: dict[str, set[str]] = {}
    for day in days:
        date = day.get("date", "")
        ordered = day.get("ordered_places", [])
        all_places.extend(ordered)
        places_by_date[date] = {p.get("place_id", "") for p in ordered}

    if not all_places:
        return {
            "alternatives": {},
            "messages": ["Alternative Agent: 장소 없음, 빈 대안 반환"],
        }

    # 메인 일정에 포함된 kakao_place_id 집합 (모든 날짜 통합 — 대안 후보에서 항상 제외)
    main_kakao_ids: set[str] = set()
    for p in all_places:
        pid = p.get("place_id", "")
        kakao_id = kakao_id_by_place_id.get(pid, "")
        if kakao_id:
            main_kakao_ids.add(kakao_id)

    # used_alt_ids_by_day: 날짜별 이미 선택된 대안 kakao_place_id (날짜 독립)
    used_alt_ids_by_day: dict[str, set[str]] = {}
    alternatives: dict[str, list[dict]] = {}

    # 순차 for-loop (asyncio.gather 미사용 — race condition 방지)
    for place in all_places:
        date = place.get("date", "")

        # weekday 파생: date 없으면 0(월요일) fallback
        if date:
            try:
                weekday = datetime.strptime(date, "%Y-%m-%d").weekday()
            except ValueError:
                weekday = 0
        else:
            weekday = 0

        same_day_ids = places_by_date.get(date, set())
        used_alt_ids_by_day.setdefault(date, set())
        exclude_ids = main_kakao_ids | used_alt_ids_by_day[date]

        try:
            place_id, alts = await find_alternatives(
                place, exclude_ids, same_day_ids, valid_places, weekday
            )
        except Exception as e:
            # 개별 장소 오류 시 빈 배열로 처리, 나머지 계속 진행
            place_id = place.get("place_id") or place.get("id", "")
            alts = []
            logger.warning(f"[Alternative] {place_id} 대안 탐색 실패: {e!s}")

        # 선택된 대안의 kakao_place_id를 날짜별 집합에 추가 (날짜 내 중복 방지)
        used_alt_ids_by_day[date].update(
            alt["kakao_place_id"] for alt in alts if alt.get("kakao_place_id")
        )

        alternatives[place_id] = alts

    total_alts = sum(len(v) for v in alternatives.values())
    logger.info(
        f"[Alternative Agent] {len(all_places)}개 장소, 총 {total_alts}개 대안 생성"
    )

    return {
        "alternatives": alternatives,
        "messages": [
            f"Alternative Agent 완료: {len(all_places)}개 장소, "
            f"총 {total_alts}개 대안 생성"
        ],
    }
