"""Planner Agent — 5단계 내부 파이프라인.

LLM 호출 없음. haversine 그리디 클러스터링 + TSP + Kakao Mobility route_matrix 선계산.
repair_conflict 단방향 이동 정책으로 핑퐁 방지.
"""
import asyncio
import logging
from datetime import date as date_type, timedelta

from agents.state import ItineraryState
from agents.time_utils import (
    DEFAULT_FALLBACK_HOURS,
    DEFAULT_HOURS,
    MAX_CATEGORY_PER_DAY,
    MAX_DAY_END,
    MAX_MEAL_JUMP_MIN,
    MAX_PLACES_PER_DAY,
    MEAL_WINDOWS,
    MIN_TRAVEL_MIN,
    RESERVATION_LATE_SHIFT_MAX,
    RESERVATION_TOLERANCE,
    STAY_DURATION,
    STAY_DURATION_RANGE,
    from_mod,
    get_stay_duration,
    haversine_meters,
    normalize_slot,
    to_mod,
    to_mod_from_str,
)
from services.kakao import get_travel_time

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# 모듈 레벨 Route Cache / Semaphore
# ---------------------------------------------------------------------------

# 동시 Kakao Mobility API 요청 수 제한 (10개)
_ROUTE_SEMAPHORE = asyncio.Semaphore(10)

# (origin_id, dest_id) → 이동시간(분) 캐시
_ROUTE_CACHE: dict[tuple[str, str], int] = {}


# ---------------------------------------------------------------------------
# [1] day_allocation_greedy
# ---------------------------------------------------------------------------

def _select_seeds(places: list[dict], n_days: int) -> list[dict]:
    """지리적으로 최대 분산된 n_days개의 seed를 선택한다 (centroid 기반 그리디).

    1. 후보 풀: must_visit 장소 우선, 부족하면 전체 장소로 보충
    2. seed[0] = 전체 후보 centroid에서 가장 가까운 장소 (밀도 중심)
    3. seed[i] = 기존 seed들까지의 min-distance가 최대인 장소
    """
    candidates = [p for p in places if p.get("is_must_visit")]
    if len(candidates) < n_days:
        extras = [p for p in places if not p.get("is_must_visit")]
        candidates = candidates + extras

    if not candidates:
        return []

    # centroid 계산
    centroid_lat = sum(p["lat"] for p in candidates) / len(candidates)
    centroid_lng = sum(p["lng"] for p in candidates) / len(candidates)

    # seed[0]: centroid에서 가장 가까운 장소 (밀도 중심 — outlier 편중 방지)
    first_seed = min(
        candidates,
        key=lambda p: haversine_meters(centroid_lat, centroid_lng, p["lat"], p["lng"]),
    )
    seeds = [first_seed]
    remaining = [p for p in candidates if p["id"] != first_seed["id"]]

    while len(seeds) < n_days and remaining:
        # seed[i]: 기존 모든 seed까지의 min-distance가 최대인 장소 (최대 분산)
        best = max(
            remaining,
            key=lambda p: min(
                haversine_meters(p["lat"], p["lng"], s["lat"], s["lng"])
                for s in seeds
            ),
        )
        seeds.append(best)
        remaining.remove(best)

    return seeds


def day_allocation_greedy(valid_places: list[dict], n_days: int) -> list[list[dict]]:
    """valid_places를 n_days개 날짜 클러스터로 분배한다 (같은 날 = 가까운 곳).

    - seed 선택: must_visit 장소 중 지리적 최대 분산 n_days개
    - remaining: argmin haversine → best_day, 편중 방지(len < avg+1)
    """
    if n_days <= 0 or not valid_places:
        return [[] for _ in range(n_days)]

    seeds = _select_seeds(valid_places, n_days)

    # seed가 n_days보다 적으면 빈 클러스터로 채움
    clusters: list[list[dict]] = [[s] for s in seeds]
    while len(clusters) < n_days:
        clusters.append([])

    seed_ids = {s["id"] for s in seeds}
    remaining = [p for p in valid_places if p["id"] not in seed_ids]

    avg = len(valid_places) / n_days

    def _try_assign(
        clusters: list[list[dict]],
        ignore_soft_cap: bool = False,
        ignore_balance: bool = False,
    ) -> int:
        """장소를 배정할 최적 날짜 인덱스를 반환한다. 없으면 -1.

        - hard cap(MAX_PLACES_PER_DAY)은 항상 적용
        - balance 체크(avg+1)는 ignore_balance=False 일 때만 적용
        - soft cap(MAX_CATEGORY_PER_DAY)은 ignore_soft_cap=False 일 때만 적용
        """
        best_day = -1
        best_dist = float("inf")
        category = place.get("category", "")

        for day_idx, cluster in enumerate(clusters):
            # hard cap: 항상 적용
            if len(cluster) >= MAX_PLACES_PER_DAY:
                continue

            # balance 체크: 편중 방지 (빈 클러스터 제외)
            if not ignore_balance and cluster and len(cluster) >= avg + 1:
                continue

            # soft cap: 카테고리별 최대 수 제한
            if not ignore_soft_cap and category in MAX_CATEGORY_PER_DAY:
                cat_count = sum(1 for p in cluster if p.get("category") == category)
                if cat_count >= MAX_CATEGORY_PER_DAY[category]:
                    continue

            if not cluster:
                dist = 0.0
            else:
                dist = min(
                    haversine_meters(place["lat"], place["lng"], p["lat"], p["lng"])
                    for p in cluster
                )

            if dist < best_dist:
                best_dist = dist
                best_day = day_idx

        return best_day

    for place in remaining:
        # 3단계 시도: soft cap + balance → soft cap 해제 → 모두 해제 → 최소 클러스터
        best_day = _try_assign(clusters)
        if best_day == -1:
            best_day = _try_assign(clusters, ignore_soft_cap=True)
        if best_day == -1:
            best_day = _try_assign(clusters, ignore_soft_cap=True, ignore_balance=True)
        if best_day == -1:
            best_day = min(range(n_days), key=lambda i: len(clusters[i]))

        clusters[best_day].append(place)

    return clusters


# ---------------------------------------------------------------------------
# [2] anchor_extraction
# ---------------------------------------------------------------------------

def anchor_extraction(
    cluster: list[dict],
    pins_for_date: list[dict],
    date: str,
    stay_place_for_date: dict | None = None,
) -> tuple[list[dict], list[tuple[str, dict]], list[dict]]:
    """클러스터에서 RESERVATION/STAY 앵커를 분리하여 반환한다.

    앵커를 클러스터에 즉시 삽입하지 않고 분리만 수행한다.
    - RESERVATION: (pinned_time, tagged_place) 튜플 리스트로 반환 (pinned_time 오름차순)
    - STAY: stay_place_for_date로 직접 주입 (멀티박 지원, pinned_date 날짜 비교 불필요)
    - 나머지: free_places 리스트로 반환

    Args:
        cluster: 해당 날짜의 장소 목록
        pins_for_date: 해당 날짜의 핀 목록 (RESERVATION 추출에 사용)
        date: 현재 날짜 문자열 (ISO 형식)
        stay_place_for_date: stay_for_date[date] 값 — 해당 날짜의 숙소 (없으면 None)

    Returns:
        (free_places, reservation_anchors, stay_anchors)
    """
    place_map = {p["id"]: p for p in cluster}
    anchor_ids: set[str] = set()

    reservation_anchors: list[tuple[str, dict]] = []  # (pinned_time, place)

    # RESERVATION 앵커만 pins_for_date에서 추출
    for pin in pins_for_date:
        pid = pin.get("place_id")
        ptype = pin.get("type")

        if ptype != "RESERVATION":
            continue

        place = place_map.get(pid)
        if place is None:
            # 핀 대상 장소가 해당 날짜 클러스터에 없으면 무시
            continue

        tagged = {**place, "pin_type": "RESERVATION", "_pinned_time": pin.get("pinned_time")}
        reservation_anchors.append((pin.get("pinned_time", "09:00"), tagged))
        anchor_ids.add(pid)

    # RESERVATION 앵커를 pinned_time 오름차순으로 정렬
    reservation_anchors.sort(key=lambda x: x[0])

    # STAY 앵커: stay_place_for_date로 직접 주입 (pinned_date 날짜 비교 불필요)
    # 멀티박 숙소의 중간 날짜도 정확히 처리됨
    if stay_place_for_date is not None:
        stay_anchors: list[dict] = [{**stay_place_for_date, "pin_type": "STAY"}]
        anchor_ids.add(stay_place_for_date["id"])
    else:
        stay_anchors = []

    # 불변 조건: 날짜당 STAY 앵커는 최대 1개
    assert len(stay_anchors) <= 1, (
        f"[Planner] {date}에 STAY 앵커가 {len(stay_anchors)}개 — invariant 위반"
    )

    # 앵커가 아닌 나머지 장소
    free_places = [p for p in cluster if p["id"] not in anchor_ids]

    return free_places, reservation_anchors, stay_anchors


# ---------------------------------------------------------------------------
# [3] route_ordering (nearest-neighbor TSP)
# ---------------------------------------------------------------------------

def _nearest_neighbor_tsp(free_places: list[dict], start_lat: float, start_lng: float) -> list[dict]:
    """haversine 기반 nearest-neighbor TSP로 순서를 정렬한다."""
    remaining = list(free_places)
    ordered = []
    cur_lat, cur_lng = start_lat, start_lng

    while remaining:
        nearest = min(
            remaining,
            key=lambda p: haversine_meters(cur_lat, cur_lng, p["lat"], p["lng"]),
        )
        ordered.append(nearest)
        cur_lat, cur_lng = nearest["lat"], nearest["lng"]
        remaining.remove(nearest)

    return ordered


def infer_day_start_time(
    free_places: list[dict],
    reservation_anchors: list[tuple[str, dict]],
    prev_stay: dict | None,
) -> int:
    """하루 일정 시작 시각(분)을 동적으로 추론한다.

    우선순위:
    1. RESERVATION 있으면: 첫 예약 시각 기준으로 여유 있게 앞당김
    2. 전날 숙소(prev_stay) 있으면: 510분(08:30)
    3. free_places 모두 맛집이면: 660분(11:00) — 점심 시작
    4. 기본: 540분(09:00)
    """
    if reservation_anchors:
        first_res_time, _ = reservation_anchors[0]
        first_res_min = to_mod_from_str(first_res_time)
        free_count = len(free_places)
        return max(480, first_res_min - free_count * 120)

    if prev_stay is not None:
        return 510

    if free_places and all(p.get("category") == "맛집" for p in free_places):
        return 660

    return 540


def _insert_reservations_by_time(
    tsp_ordered: list[dict],
    reservation_anchors: list[tuple[str, dict]],
    day_start_min: int,
    n_places_today: int,
) -> list[dict]:
    """TSP 순서에 RESERVATION 앵커를 pinned_time 기준 타임라인 시뮬레이션으로 삽입한다.

    실제 타임라인을 시뮬레이션하여 예약 시각이 도래하면 해당 위치에 삽입.
    """
    AVG_TRAVEL_EST = 15  # 이동 시간 추정치(분)

    result: list[dict] = []
    t = day_start_min
    res_idx = 0

    for place in tsp_ordered:
        # 예약 시각이 현재 시각보다 이르면 먼저 삽입
        while res_idx < len(reservation_anchors):
            res_time_str, res_place = reservation_anchors[res_idx]
            res_time_min = to_mod_from_str(res_time_str)
            if t >= res_time_min:
                result.append(res_place)
                res_stay = get_stay_duration(res_place.get("category", "관광지"), n_places_today)
                t = res_time_min + res_stay + AVG_TRAVEL_EST
                res_idx += 1
            else:
                break

        result.append(place)
        stay = get_stay_duration(place.get("category", "관광지"), n_places_today)
        t += stay + AVG_TRAVEL_EST

    # 남은 RESERVATION 앵커를 뒤에 추가
    for _, res_place in reservation_anchors[res_idx:]:
        result.append(res_place)

    return result


def route_ordering(
    free_places: list[dict],
    reservation_anchors: list[tuple[str, dict]],
    stay_anchors: list[dict],
    prev_stay: dict | None = None,
) -> tuple[list[dict], int]:
    """free_places를 TSP로 정렬하고 RESERVATION을 타임라인 기반으로 삽입한다.

    Args:
        free_places: 앵커가 아닌 일반 장소 목록
        reservation_anchors: (pinned_time, place) 튜플 리스트 (오름차순 정렬됨)
        stay_anchors: STAY 핀 장소 목록 (맨 뒤 배치)
        prev_stay: 전날 숙소 장소 dict (TSP 시작점 및 시작 시각 추론용)

    Returns:
        (ordered_places, day_start_min)
    """
    n_places_today = len(free_places) + len(reservation_anchors) + len(stay_anchors)

    # TSP 시작점: prev_stay 좌표 우선, 없으면 free_places centroid
    if prev_stay is not None:
        start_lat = float(prev_stay["lat"])
        start_lng = float(prev_stay["lng"])
    elif free_places:
        start_lat = sum(p["lat"] for p in free_places) / len(free_places)
        start_lng = sum(p["lng"] for p in free_places) / len(free_places)
    elif reservation_anchors:
        _, first_res = reservation_anchors[0]
        start_lat = float(first_res["lat"])
        start_lng = float(first_res["lng"])
    else:
        return stay_anchors, 540

    # TSP 정렬
    tsp_ordered = _nearest_neighbor_tsp(free_places, start_lat, start_lng)

    # 하루 시작 시각 추론
    day_start_min = infer_day_start_time(free_places, reservation_anchors, prev_stay)

    # RESERVATION을 타임라인 시뮬레이션으로 삽입
    ordered = _insert_reservations_by_time(
        tsp_ordered, reservation_anchors, day_start_min, n_places_today
    )

    # STAY 앵커는 항상 맨 뒤
    return ordered + stay_anchors, day_start_min


# ---------------------------------------------------------------------------
# [4] route_matrix 선계산
# ---------------------------------------------------------------------------

def _haversine_fallback_travel(p_i: dict, p_j: dict) -> int:
    """Kakao Mobility API 실패 시 haversine 거리 기반 이동시간을 추정한다.

    1km당 3분으로 환산. MIN_TRAVEL_MIN 이하면 MIN_TRAVEL_MIN 반환.
    """
    dist_m = haversine_meters(p_i["lat"], p_i["lng"], p_j["lat"], p_j["lng"])
    return max(MIN_TRAVEL_MIN, int(dist_m / 1000 * 3))


async def _fetch_with_cache(p_i: dict, p_j: dict) -> tuple[tuple[str, str], int]:
    """캐시 조회 후 없으면 Kakao Mobility API를 호출하고 결과를 캐시에 저장한다.

    double-check 패턴으로 중복 API 호출을 방지한다.
    """
    key = (p_i["id"], p_j["id"])

    # 1차 캐시 조회 (락 없이)
    if key in _ROUTE_CACHE:
        return key, _ROUTE_CACHE[key]

    async with _ROUTE_SEMAPHORE:
        # 2차 캐시 조회 (Semaphore 획득 후 double-check)
        if key in _ROUTE_CACHE:
            return key, _ROUTE_CACHE[key]

        try:
            duration = await get_travel_time(
                origin_lat=float(p_i["lat"]),
                origin_lng=float(p_i["lng"]),
                dest_lat=float(p_j["lat"]),
                dest_lng=float(p_j["lng"]),
                origin_name=p_i.get("name", ""),
                origin_id=p_i.get("id", ""),
                dest_name=p_j.get("name", ""),
                dest_id=p_j.get("id", ""),
            )
        except Exception:
            duration = _haversine_fallback_travel(p_i, p_j)

    _ROUTE_CACHE[key] = duration
    return key, duration


async def build_route_matrix(places: list[dict]) -> dict[tuple[str, str], int]:
    """모든 인접 쌍에 대해 Kakao Mobility 이동시간을 선계산한다.

    순차 방문을 가정하므로 인접 쌍(i → i+1)만 계산 (전체 NxN 아님).
    _ROUTE_CACHE로 중복 호출 방지, _ROUTE_SEMAPHORE로 동시 요청 제한.
    """
    if len(places) < 2:
        return {}

    n = len(places)
    pairs = [(i, i + 1) for i in range(n - 1)]

    results = await asyncio.gather(
        *[_fetch_with_cache(places[i], places[j]) for i, j in pairs],
        return_exceptions=True,
    )

    matrix: dict[tuple[str, str], int] = {}
    for idx, res in enumerate(results):
        if isinstance(res, Exception):
            i, j = pairs[idx]
            key = (places[i]["id"], places[j]["id"])
            fallback = _haversine_fallback_travel(places[i], places[j])
            logger.warning(f"[RouteMatrix] {key} 계산 실패, haversine fallback({fallback}분) 사용")
            matrix[key] = fallback
        else:
            key, duration = res
            matrix[key] = duration

    return matrix


# ---------------------------------------------------------------------------
# [5] timeline_validation + repair_conflict
# ---------------------------------------------------------------------------

def _check_hours_fit(start_min: int, end_min: int, place: dict, weekday: int) -> bool:
    """장소 운영시간에 방문 시간이 맞는지 확인한다.

    opening_hours[str(weekday)] 슬롯 중 하나라도 방문 시간을 포함하면 True.
    슬롯이 비어있으면 soft-pass(True) — 숙소 등 항상 접근 가능한 경우.
    """
    opening_hours = place.get("opening_hours", {})
    slots = opening_hours.get(str(weekday), [])

    # 슬롯 없음 → soft-pass
    if not slots:
        return True

    for slot in slots:
        open_m, close_m = normalize_slot(slot[0], slot[1])
        if start_min >= open_m and end_min <= close_m:
            return True

    return False


def _find_best_day(
    place: dict,
    all_day_plans: list[list[dict]],
    current_day_idx: int,
) -> int:
    """repair_conflict에서 장소를 이동할 최적 날짜를 탐색한다.

    선택 우선순위:
      1순위: 해당 날짜의 장소 수 < 8
      2순위: 현재 장소와 haversine 거리 최소인 날짜
      3순위: RESERVATION/STAY 앵커와 시간 충돌 없는 날짜
    """
    candidates = []
    for day_idx, day_places in enumerate(all_day_plans):
        if day_idx == current_day_idx:
            continue
        if len(day_places) >= 8:
            continue

        # 앵커 충돌 체크: RESERVATION 핀이 있는 날짜는 추가 충돌 가능성이 있으므로 패스
        has_anchor_conflict = any(
            p.get("pin_type") in ("RESERVATION", "STAY") for p in day_places
        )
        if has_anchor_conflict and len(day_places) >= 6:
            continue

        # 해당 날짜 장소들과의 평균 거리 계산
        if day_places:
            avg_dist = sum(
                haversine_meters(place["lat"], place["lng"], p["lat"], p["lng"])
                for p in day_places
            ) / len(day_places)
        else:
            avg_dist = 0.0

        candidates.append((day_idx, avg_dist))

    if not candidates:
        return -1

    # haversine 거리 최소 날짜 선택
    best_day_idx = min(candidates, key=lambda x: x[1])[0]
    return best_day_idx


def _next_meal_slot_start(current_min: int) -> int | None:
    """맛집 방문을 식사 시간대(MEAL_WINDOWS)로 조정한다.

    current_min 이후에 가장 빠른 식사 시간대 시작점을 반환한다.
    gap이 MAX_MEAL_JUMP_MIN(60분) 이하인 경우에만 이동 허용.
    """
    for window_start, _ in MEAL_WINDOWS:
        target = max(current_min, window_start)
        gap = target - current_min
        if gap <= MAX_MEAL_JUMP_MIN:
            return target
    return None


def _try_shift_later(
    place: dict,
    current_start_min: int,
    weekday: int,
    n_places_today: int,
) -> int | None:
    """운영시간 충돌 시 당일 가능한 시간대로 시프트한다.

    당일 운영 슬롯 중 current_start_min 이후에 체류시간이 맞는 첫 슬롯을 반환.
    MAX_DAY_END 이내에 종료 가능해야 한다.
    """
    opening_hours = place.get("opening_hours", {})
    slots = opening_hours.get(str(weekday), [])
    category = place.get("category", "관광지")
    stay_dur = get_stay_duration(category, n_places_today)

    for slot in slots:
        open_m, close_m = normalize_slot(slot[0], slot[1])
        candidate_start = max(current_start_min, open_m)
        if candidate_start + stay_dur <= close_m and candidate_start <= MAX_DAY_END:
            return candidate_start
    return None


def timeline_validation(
    ordered: list[dict],
    route_matrix: dict[tuple[str, str], int],
    all_day_plans: list[list[dict]],
    date_idx: int,
    moved_place_ids: set[str],
    excluded_places: list[dict],
    date_str: str,
    prev_stay: dict | None = None,
    day_start_min: int = 540,
) -> tuple[list[dict], list[dict]]:
    """운영시간 충돌을 검사하고 repair_conflict로 처리한다.

    Args:
        ordered: 정렬된 장소 목록
        route_matrix: (origin_id, dest_id) → 이동시간(분)
        all_day_plans: 모든 날짜의 ordered_places 리스트 (MOVED 대상 탐색용)
        date_idx: 현재 날짜 인덱스
        moved_place_ids: 이미 이동된 place_id 집합 (전체 범위 공유)
        excluded_places: 제외 장소 누적 리스트
        date_str: 현재 날짜 문자열 (ISO 형식, weekday 계산용)
        prev_stay: 전날 숙소 장소 dict (이동시간 fallback 계산용)
        day_start_min: 하루 시작 시각(분), 기본값 540(09:00)

    Returns:
        (최종 ordered_places, 업데이트된 excluded_places)
    """
    weekday = date_type.fromisoformat(date_str).weekday()
    n_places_today = len(ordered)
    start_min = day_start_min
    result: list[dict] = []
    prev_place: dict | None = prev_stay
    prev_id: str | None = prev_stay["id"] if prev_stay else None
    seen_place_ids: set[str] = set()  # 같은 날 중복 장소 탐지용

    for place in ordered:
        category = place.get("category", "관광지")
        stay = get_stay_duration(category, n_places_today)
        place_id = place["id"]

        # 같은 날 동일 place_id 중복 배치 방지
        if place_id in seen_place_ids:
            excluded_places.append({**place, "reason": "같은 날 중복 장소"})
            continue

        pin_type = place.get("pin_type")

        # STAY 앵커 조기 처리: 시간 계산에서 완전 제외
        # 숙소는 "하루의 끝을 결정하는 anchor"이므로 체류 시간·다음 출발 시각에 영향 없음
        if pin_type == "STAY":
            if prev_id is not None:
                travel = route_matrix.get((prev_id, place_id))
                if travel is None:
                    travel = (
                        _haversine_fallback_travel(prev_place, place)
                        if prev_place is not None
                        else 30
                    )
            else:
                travel = 0

            output_place = {
                "place_id": place_id,
                "name": place.get("name", ""),
                "lat": place.get("lat"),
                "lng": place.get("lng"),
                "category": category,
                "is_must_visit": place.get("is_must_visit", False),
                "kakao_place_id": place.get("kakao_place_id"),
                "start_at": from_mod(start_min),   # 도착 시각 (표시용)
                "end_at": None,                     # 종료 없음 (숙소는 하루 끝)
                "travel_minutes_from_prev": travel,
                "pin_type": "STAY",
                "hours_source": place.get("hours_source", "DEFAULT"),
                "place_warning": None,
                "affects_time": False,              # 시간 계산에서 제외 플래그
                "duration": 0,                      # 체류 시간 0
            }
            result.append(output_place)
            seen_place_ids.add(place_id)
            prev_place = place
            prev_id = place_id
            # start_min 갱신 없음 → 다음 장소에 영향 없음
            continue

        conflict_override = False  # RESERVATION 대폭 지각 시 강제 충돌
        late_warning = None

        # RESERVATION 처리: 지각 감지
        if pin_type == "RESERVATION":
            pinned_time = place.get("_pinned_time")
            if pinned_time:
                res_time = to_mod_from_str(pinned_time)
                if start_min <= res_time + RESERVATION_TOLERANCE:
                    # 정상: 예약 시각에 맞게 시작
                    start_min = res_time
                else:
                    late_by = start_min - res_time
                    if late_by <= RESERVATION_LATE_SHIFT_MAX:
                        # 소폭 지각: LATE warning 후 계속
                        late_warning = {
                            "warning_type": "RESERVATION_LATE",
                            "warning_message": (
                                f"예약 시간({pinned_time})보다 {late_by}분 늦게 도착 예정입니다."
                            ),
                        }
                    else:
                        # 대폭 지각: conflict 처리
                        conflict_override = True
        # 맛집 식사 시간대 보정 (RESERVATION 아닌 경우만)
        elif category == "맛집":
            adjusted = _next_meal_slot_start(start_min)
            if adjusted is not None:
                start_min = adjusted

        end_min = start_min + stay

        # 이동 시간 계산 (lazy haversine fallback)
        if prev_id is not None:
            travel = route_matrix.get((prev_id, place_id))
            if travel is None:
                if prev_place is not None:
                    travel = _haversine_fallback_travel(prev_place, place)
                else:
                    travel = 30
        else:
            travel = 0

        # 운영시간 + MAX_DAY_END 충돌 검사
        fits = (
            False
            if conflict_override
            else _check_hours_fit(start_min, end_min, place, weekday)
        )

        if not fits or end_min > MAX_DAY_END:
            # repair_conflict 단계별 처리
            if place.get("is_must_visit"):
                # 1단계: KEEP_WITH_WARNING — 필수 장소는 제거 불가
                place = {
                    **place,
                    "place_warning": {
                        "warning_type": "MUST_VISIT_CLOSED",
                        "warning_message": (
                            "해당 장소는 휴무일일 가능성이 높으나, 설정하신 필수 장소이므로 "
                            "일정에 포함되었습니다. 방문 전 확인을 권장합니다."
                        ),
                    },
                }
            elif place_id in moved_place_ids:
                # 2단계: 이미 이동된 장소 재충돌 → REMOVED (단방향 이동 정책)
                excluded_places.append({**place, "reason": "이동 후 재충돌로 제외"})
                prev_place = place
                prev_id = place_id
                start_min = end_min + travel
                continue
            else:
                # 3단계: _try_shift_later → SHIFTED
                shifted_start = _try_shift_later(place, start_min, weekday, n_places_today)
                if shifted_start is not None:
                    start_min = shifted_start
                    end_min = start_min + stay
                    place = {**place, "place_warning": None}
                else:
                    # 4단계: _find_best_day → MOVED
                    best_day = _find_best_day(place, all_day_plans, date_idx)
                    if best_day >= 0:
                        target_day_places = all_day_plans[best_day]
                        avg_stay = STAY_DURATION.get(category, 90)
                        est_end = 540 + len(target_day_places) * (avg_stay + 30)
                        default_slots = DEFAULT_HOURS.get(category, DEFAULT_FALLBACK_HOURS)
                        default_close = default_slots[0][1] if default_slots else 1200
                        if est_end + avg_stay > default_close:
                            # 5단계: 대상 날도 초과 예상 → REMOVED
                            excluded_places.append({
                                **place,
                                "reason": "이동 대상 날도 운영시간 초과 예상으로 제외",
                            })
                        else:
                            # MOVED
                            moved_place_ids.add(place_id)
                            all_day_plans[best_day].append({**place, "pin_type": None})
                        prev_place = place
                        prev_id = place_id
                        start_min = end_min + travel
                        continue
                    else:
                        # 5단계: REMOVED
                        excluded_places.append({
                            **place,
                            "reason": "운영시간 충돌로 제외 (이동 가능한 날짜 없음)",
                        })
                        prev_place = place
                        prev_id = place_id
                        start_min = end_min + travel
                        continue
        else:
            if "place_warning" not in place:
                place = {**place, "place_warning": None}

        # 소폭 지각 LATE warning 적용
        if late_warning is not None and place.get("place_warning") is None:
            place = {**place, "place_warning": late_warning}

        # ordered_places 출력 항목 구성
        output_place = {
            "place_id": place_id,
            "name": place.get("name", ""),
            "lat": place.get("lat"),
            "lng": place.get("lng"),
            "category": category,
            "is_must_visit": place.get("is_must_visit", False),
            "kakao_place_id": place.get("kakao_place_id"),
            "start_at": from_mod(start_min),
            "end_at": from_mod(end_min),
            "travel_minutes_from_prev": travel,
            "pin_type": pin_type,
            "hours_source": place.get("hours_source", "DEFAULT"),
            "place_warning": place.get("place_warning"),
        }
        result.append(output_place)
        seen_place_ids.add(place_id)

        prev_place = place
        prev_id = place_id
        start_min = end_min + travel

    return result, excluded_places


# ---------------------------------------------------------------------------
# Planner Agent 진입점
# ---------------------------------------------------------------------------

async def planner_agent(state: ItineraryState) -> dict:
    """5단계 파이프라인으로 날짜별 최적 일정을 생성한다.

    LLM 호출 없음. route_matrix 선계산으로 Kakao Mobility API 호출 최소화.
    """
    valid_places = state.get("valid_places", [])
    travel_dates = state.get("travel_dates", [])
    schedule_pins = state.get("schedule_pins", [])
    excluded_places: list[dict] = list(state.get("excluded_places", []))

    n_days = len(travel_dates)
    if n_days == 0 or not valid_places:
        return {
            "days": [],
            "excluded_places": excluded_places,
            "messages": ["Planner Agent: 장소 또는 날짜 없음, 빈 일정 반환"],
        }

    # 날짜 → 핀 목록 매핑
    pins_by_date: dict[str, list[dict]] = {d: [] for d in travel_dates}
    for pin in schedule_pins:
        pinned_date = pin.get("pinned_date")
        if pinned_date in pins_by_date:
            pins_by_date[pinned_date].append(pin)

    # place_map 구성
    place_map = {p["id"]: p for p in valid_places}

    # stay_for_date 구성: STAY 핀 → checkin~checkout 전날 전체 날짜 → place
    # 멀티박 지원: 예) 1일차 체크인 ~ 3일차 체크아웃이면 1일차, 2일차에 매핑
    stay_for_date: dict[str, dict] = {}
    for pin in schedule_pins:
        if pin.get("type") != "STAY":
            continue
        pid = pin.get("place_id")
        checkin_str = pin.get("pinned_date")
        checkout_str = pin.get("checkout_date")

        if not (pid and checkin_str and pid in place_map):
            continue

        # 방어적 날짜 파싱: 잘못된 형식 → 플래너 크래시 방지
        try:
            checkin = date_type.fromisoformat(checkin_str)
            checkout = (
                date_type.fromisoformat(checkout_str)
                if checkout_str
                else checkin + timedelta(days=1)
            )
            if checkout <= checkin:
                # checkout이 checkin보다 이르면 1박으로 보정
                checkout = checkin + timedelta(days=1)
        except (ValueError, TypeError):
            logger.warning(
                f"[Planner] STAY 핀 날짜 파싱 실패: {checkin_str=}, {checkout_str=} — 건너뜀"
            )
            continue

        place = place_map[pid]
        cur = checkin
        # checkout 당일 제외 (체크아웃 당일 아침은 이미 숙소를 떠남 — 의도된 동작)
        while cur < checkout:
            date_key = cur.isoformat()
            # 충돌 감지: 동일 날짜에 다른 숙소 2개 → 명시적 오류 (silent overwrite 금지)
            if date_key in stay_for_date and stay_for_date[date_key]["id"] != pid:
                raise ValueError(
                    f"{date_key}에 숙소가 중복 등록되었습니다: "
                    f"'{stay_for_date[date_key]['name']}' vs '{place['name']}'. "
                    "한 날짜에 숙소는 1개만 등록 가능합니다."
                )
            stay_for_date[date_key] = place
            cur += timedelta(days=1)

    # prev_stay_map 구성: {day_idx: 전날 숙소 장소 or None}
    # day 0: 전날 없음(None), day i: travel_dates[i-1]의 STAY 숙소
    prev_stay_map: dict[int, dict | None] = {0: None}
    for i in range(1, n_days):
        prev_stay_map[i] = stay_for_date.get(travel_dates[i - 1])

    # STAY 핀이 있는 숙소 place_id 집합 (이중 제외 기준)
    stay_pinned_ids: set[str] = {
        pin["place_id"]
        for pin in schedule_pins
        if pin.get("type") == "STAY" and pin.get("place_id")
    }

    # STAY 핀 없는 숙소 → excluded_places 이동 (일정 생성은 정상 진행)
    for place in valid_places:
        if place.get("category") == "숙소" and place["id"] not in stay_pinned_ids:
            excluded_places.append({**place, "reason": "숙소 날짜 미등록"})
            logger.info(f"[Planner] 숙소 '{place['name']}' 날짜 미등록 → 일정 제외")

    # [1] day_allocation_greedy: 이중 제외 (카테고리 기반 + 핀 기반)
    # 숙소가 그리디 클러스터에 배정되지 않도록 완전히 제거
    places_for_allocation = [
        p for p in valid_places
        if p.get("category") != "숙소"          # 1차: 카테고리 기준
        and p["id"] not in stay_pinned_ids       # 2차: 핀 기준 (카테고리 누락 방어)
    ]
    clusters = day_allocation_greedy(places_for_allocation, n_days)

    # [2] anchor_extraction + [3] route_ordering
    ordered_clusters: list[list[dict]] = []
    day_start_mins: list[int] = []

    for day_idx, (date, cluster) in enumerate(zip(travel_dates, clusters)):
        pins_for_date = pins_by_date.get(date, [])
        prev_stay = prev_stay_map[day_idx]

        # [2] anchor_extraction: stay_for_date[date] 직접 주입으로 멀티박 정확 처리
        stay_place = stay_for_date.get(date)
        free_places, reservation_anchors, stay_anchors = anchor_extraction(
            cluster, pins_for_date, date, stay_place_for_date=stay_place
        )

        # [3] route_ordering
        ordered, day_start_min = route_ordering(
            free_places, reservation_anchors, stay_anchors, prev_stay
        )
        ordered_clusters.append(ordered)
        day_start_mins.append(day_start_min)

    # [4] route_matrix 선계산: 모든 날짜 병렬 실행
    route_matrices = await asyncio.gather(
        *[build_route_matrix(cluster) for cluster in ordered_clusters],
        return_exceptions=True,
    )

    # [5] timeline_validation: moved_place_ids를 전 날짜 범위에서 공유
    moved_place_ids: set[str] = set()

    # all_day_plans: MOVED 대상 탐색 시 다른 날짜에 삽입하기 위한 참조
    # 초기값은 ordered_clusters 복사본
    all_day_plans: list[list[dict]] = [list(c) for c in ordered_clusters]

    days_result: list[dict] = []
    for day_idx, (date, route_matrix) in enumerate(
        zip(travel_dates, route_matrices)
    ):
        # ordered_clusters 대신 all_day_plans 사용 → 이전 날에서 MOVED된 장소 포함
        cluster = all_day_plans[day_idx]
        if isinstance(route_matrix, Exception):
            logger.warning(f"[Planner] {date} route_matrix 실패, 기본 30분 사용: {route_matrix}")
            route_matrix = {}

        validated, excluded_places = timeline_validation(
            ordered=cluster,
            route_matrix=route_matrix,
            all_day_plans=all_day_plans,
            date_idx=day_idx,
            moved_place_ids=moved_place_ids,
            excluded_places=excluded_places,
            date_str=date,
            prev_stay=prev_stay_map[day_idx],
            day_start_min=day_start_mins[day_idx],
        )

        days_result.append({
            "date": date,
            "ordered_places": validated,
        })

    return {
        "days": days_result,
        "excluded_places": excluded_places,
        "messages": [
            f"Planner Agent 완료: {n_days}일, "
            f"총 {sum(len(d['ordered_places']) for d in days_result)}개 장소 배치, "
            f"제외 {len(excluded_places)}개"
        ],
    }
