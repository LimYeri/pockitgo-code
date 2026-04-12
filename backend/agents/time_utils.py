import math


# 카테고리별 운영 시간 휴리스틱: (open_mod, close_mod, peak_range)
# peak_range는 (start_mod, end_mod) 형태, None이면 피크 없음
HOURS_HEURISTIC: dict[str, tuple] = {
    "카페": (600, 1200, None),
    "맛집": (690, 1260, (900, 1020)),
    "관광지": (540, 1080, None),
    "숙소": (None, None, None),
    "액티비티": (600, 1200, None),
}

# 카테고리별 기본 영업 슬롯 (v2 Filter Agent용)
# 형식: [[open_min, close_min]] — 전 요일 동일 적용
DEFAULT_HOURS: dict[str, list] = {
    "맛집":     [[660, 1260]],   # 11:00 ~ 21:00
    "카페":     [[600, 1320]],   # 10:00 ~ 22:00
    "관광지":   [[540, 1200]],   # 09:00 ~ 20:00
    "숙소":     [[0, 1440]],     # 항상 접근 가능
    "액티비티": [[600, 1200]],   # 10:00 ~ 20:00
}

# 카테고리 매핑 없을 때 사용하는 기본 슬롯
DEFAULT_FALLBACK_HOURS: list = [[600, 1200]]  # 10:00 ~ 20:00

# 카테고리별 평균 체류 시간 (분) — 하위 호환성 유지
STAY_DURATION: dict[str, int] = {
    "카페": 60,
    "맛집": 90,
    "관광지": 90,
    "숙소": 30,
    "액티비티": 120,
}

# 카테고리별 체류 시간 범위 (min, max) — 장소 수에 따른 동적 조정용
STAY_DURATION_RANGE: dict[str, tuple[int, int]] = {
    "카페": (45, 75),
    "맛집": (60, 120),
    "관광지": (60, 120),
    "숙소": (20, 40),
    "액티비티": (90, 150),
}

# 식사 시간대 윈도우 [(start_mod, end_mod)] — 점심(11:00~14:30), 저녁(17:00~20:30)
MEAL_WINDOWS: list[tuple[int, int]] = [(660, 870), (1020, 1230)]

# 하루 최대 방문 장소 수 (hard cap)
MAX_PLACES_PER_DAY: int = 8

# 카테고리별 하루 최대 방문 수 (soft cap)
MAX_CATEGORY_PER_DAY: dict[str, int] = {
    "카페": 2,
    "맛집": 2,
}

# 하루 일정 최대 종료 시각 (분) — 21:00
MAX_DAY_END: int = 1260

# 이동 시간 최솟값 (분) — 도보 등 최소 이동 시간
MIN_TRAVEL_MIN: int = 5

# 식사 시간대 허용 최대 이동 분 — 맛집을 식사 윈도우 내 배치 시 최대 점프 허용치
MAX_MEAL_JUMP_MIN: int = 60

# RESERVATION 핀 도착 허용 오차 (분) — 예약 시간보다 일찍 도착 허용
RESERVATION_TOLERANCE: int = 10

# RESERVATION 핀 지각 최대 시프트 (분) — 지각 시 일정 뒤로 밀기 한도
RESERVATION_LATE_SHIFT_MAX: int = 30

# 맛집 RESERVATION 전용 지각 허용 폭 (분) — 30분 지각은 사실상 노쇼이므로 강화
RESERVATION_LATE_SHIFT_MAX_RESTAURANT: int = 15

# TSP 연속 배치 제한 카테고리 — 동일 카테고리 연속 배치 방지 대상
CONSECUTIVE_RESTRICTED: frozenset = frozenset({"맛집", "카페"})


def get_stay_duration(category: str, n_places_today: int) -> int:
    """장소 수에 따라 카테고리별 체류 시간을 동적으로 계산한다.

    하루 장소 수가 많을수록 체류 시간을 단축 (max_dur → min_dur 선형 보간).
    n_places_today <= 3이면 max_dur, n_places_today >= 6이면 min_dur.
    """
    min_dur, max_dur = STAY_DURATION_RANGE.get(category, (60, 90))
    ratio = min(1.0, max(0.0, (n_places_today - 3) / 3))
    return int(max_dur - (max_dur - min_dur) * ratio)


def normalize_slot(open_min: int, close_min: int) -> tuple[int, int]:
    """overnight 영업 슬롯 정규화 (close_min < open_min → close_min += 1440).

    예: (1020, 120) → (1020, 1560)  # 17:00 ~ 익일 02:00
    """
    if close_min < open_min:
        close_min += 1440
    return open_min, close_min


def to_mod(h: int, m: int) -> int:
    """시(h)·분(m)을 자정 기준 분(minutes of day)으로 변환."""
    return h * 60 + m


def from_mod(mod: int) -> str:
    """자정 기준 분을 'HH:MM' 문자열로 변환."""
    h = mod // 60
    m = mod % 60
    return f"{h:02d}:{m:02d}"


def to_mod_from_str(hhmm: str) -> int:
    """'HH:MM' 문자열을 자정 기준 분으로 변환."""
    parts = hhmm.split(":")
    return int(parts[0]) * 60 + int(parts[1])


def haversine_meters(lat1: float, lng1: float, lat2: float, lng2: float) -> int:
    """두 좌표 간 Haversine 거리(미터)를 반환한다."""
    R = 6_371_000  # 지구 반지름(m)
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)

    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return int(R * c)
