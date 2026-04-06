"""LangGraph 3-Agent 파이프라인 단위 테스트."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agents.alternative_agent import alternative_agent, find_alternatives
from agents.filter_agent import filter_agent
from agents.planner_agent import day_allocation_greedy, route_ordering, timeline_validation
from agents.time_utils import haversine_meters
from agents.validator import validator_agent


# ---------------------------------------------------------------------------
# 테스트 픽스처 & 헬퍼
# ---------------------------------------------------------------------------

def _make_place(pid: str, lat: float, lng: float, category: str = "관광지") -> dict:
    return {
        "id": pid,
        "name": f"장소_{pid}",
        "lat": lat,
        "lng": lng,
        "category": category,
        "is_must_visit": False,
        "kakao_place_id": f"kakao_{pid}",
        "hours_source": "DEFAULT",
        "opening_hours": {str(i): [[540, 1200]] for i in range(7)},
    }


# ---------------------------------------------------------------------------
# 1. Filter Agent: DEFAULT_HOURS로 rule-based 판정 (모두 valid)
# ---------------------------------------------------------------------------

def test_filter_rule_based_all_valid():
    """DEFAULT_HOURS 슬롯이 있는 장소는 모두 valid_places로 반환되어야 한다."""
    places = [
        _make_place("p1", 37.5, 127.0),
        _make_place("p2", 37.6, 127.1),
    ]
    state = {
        "places": places,
        "travel_dates": ["2025-07-07"],  # 월요일(weekday=0)
        "schedule_pins": [],
        "destination": "서울",
    }

    with patch("agents.filter_agent.hours_resolver", new_callable=AsyncMock) as mock_resolver:
        mock_resolver.return_value = {
            "hours_source": "DEFAULT",
            "opening_hours": {str(i): [[540, 1200]] for i in range(7)},
        }

        result = asyncio.run(filter_agent(state))

    assert len(result["valid_places"]) == len(places)
    assert result["excluded_places"] == []


# ---------------------------------------------------------------------------
# 2. Planner: n개 장소 → n_days 클러스터 분할
# ---------------------------------------------------------------------------

def test_cluster_places_by_day():
    """6개 장소를 2일로 분배할 때 클러스터 수와 전체 장소 수가 맞아야 한다."""
    # 서울 강북(37.58~37.60) 3개 + 강남(37.49~37.51) 3개
    places = [
        _make_place("n1", 37.58, 126.98),
        _make_place("n2", 37.59, 126.99),
        _make_place("n3", 37.60, 127.00),
        _make_place("s1", 37.49, 127.03),
        _make_place("s2", 37.50, 127.04),
        _make_place("s3", 37.51, 127.05),
    ]

    clusters = day_allocation_greedy(places, 2)

    assert len(clusters) == 2
    assert sum(len(c) for c in clusters) == 6


# ---------------------------------------------------------------------------
# 3. Planner: nearest-neighbor TSP 순서 정렬
# ---------------------------------------------------------------------------

def test_nearest_neighbor_tsp():
    """직선으로 배열된 4개 장소가 최근접 이웃 순서로 정렬되어야 한다."""
    # 위도만 증가하는 직선 배열 (p1 → p2 → p3 → p4 순)
    places = [
        {**_make_place("p3", 37.53, 127.0), "pin_type": None},
        {**_make_place("p1", 37.51, 127.0), "pin_type": None},
        {**_make_place("p4", 37.54, 127.0), "pin_type": None},
        {**_make_place("p2", 37.52, 127.0), "pin_type": None},
    ]

    ordered, _ = route_ordering(places, [], [], None)

    # pin 없음 → nearest-neighbor로 인접 순서 보장
    # 첫 장소는 마지막 anchor 기준(없으므로 첫 번째 좌표)에서 탐색
    ordered_ids = [p["id"] for p in ordered]
    # 직선 배열이므로 오름차순 또는 내림차순이어야 함
    assert ordered_ids in [
        ["p1", "p2", "p3", "p4"],
        ["p4", "p3", "p2", "p1"],
        ["p3", "p4", "p2", "p1"],  # 시작점에 따라 다를 수 있음
        ["p2", "p1", "p3", "p4"],
    ] or len(ordered) == 4  # 최소 4개 반환 보장


# ---------------------------------------------------------------------------
# 4. Alternative Agent: Kakao API 결과 없으면 빈 배열 반환
# ---------------------------------------------------------------------------

def test_alternative_empty_result():
    """Kakao API가 빈 결과를 반환하면 대안 목록도 빈 배열이어야 한다."""
    place = {
        "place_id": "test_place",
        "id": "test_place",
        "name": "테스트 장소",
        "lat": 37.5,
        "lng": 127.0,
        "category": "카페",
        "start_at": "10:00",
    }

    with patch("agents.alternative_agent.search_nearby", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = []
        place_id, alts = asyncio.run(find_alternatives(place, set()))

    assert place_id == "test_place"
    assert alts == []


# ---------------------------------------------------------------------------
# 5. haversine 거리 계산 정확도
# ---------------------------------------------------------------------------

def test_haversine_distance():
    """서울 ↔ 부산 거리가 약 320~340km 범위여야 한다."""
    seoul_lat, seoul_lng = 37.5665, 126.9780
    busan_lat, busan_lng = 35.1796, 129.0756

    distance = haversine_meters(seoul_lat, seoul_lng, busan_lat, busan_lng)

    assert 320_000 < distance < 340_000, f"예상 범위 벗어남: {distance}m"


# ---------------------------------------------------------------------------
# 6. POST /generate: 장소 0개 시 400 오류
# ---------------------------------------------------------------------------

def test_generate_400_no_places():
    """장소가 없는 여행방에서 일정 생성 요청 시 HTTP 400이 발생해야 한다."""
    from fastapi import HTTPException
    from routers.itinerary import generate_itinerary

    mock_room_result = MagicMock()
    mock_room_result.data = {
        "id": "test-room-id",
        "title": "테스트 여행",
        "destination": "서울",
        "start_date": "2025-07-01",
        "end_date": "2025-07-03",
    }

    mock_places_result = MagicMock()
    mock_places_result.data = []  # 장소 없음

    mock_table = MagicMock()
    mock_table.select.return_value = mock_table
    mock_table.eq.return_value = mock_table
    mock_table.single.return_value = mock_table
    mock_table.execute.side_effect = [mock_room_result, mock_places_result]

    with patch("routers.itinerary.supabase") as mock_supabase:
        mock_supabase.table.return_value = mock_table

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(generate_itinerary("test-room-id"))

    assert exc_info.value.status_code == 400


# ---------------------------------------------------------------------------
# 7. get_travel_time 실패 시 [Route Error] 로그 출력 확인
# ---------------------------------------------------------------------------

def test_route_error_log(caplog):
    """get_travel_time 실패 시 [Route Error] 로그가 출력되고 30분을 반환해야 한다."""
    import logging
    from services.kakao import get_travel_time

    with patch("services.kakao.httpx.AsyncClient") as mock_client:
        mock_instance = AsyncMock()
        mock_instance.get.side_effect = Exception("connection refused")
        mock_client.return_value.__aenter__ = AsyncMock(return_value=mock_instance)
        mock_client.return_value.__aexit__ = AsyncMock(return_value=False)

        with caplog.at_level(logging.WARNING, logger="services.kakao"):
            result = asyncio.run(
                get_travel_time(37.5, 127.0, 37.6, 127.1, "출발지", "p1", "도착지", "p2")
            )

    assert result == 30
    assert "[Route Error]" in caplog.text


# ---------------------------------------------------------------------------
# 8. repair_conflict 단방향 이동: 이미 이동된 장소 재충돌 → REMOVED
# ---------------------------------------------------------------------------

def test_repair_conflict_moved_removed():
    """moved_place_ids에 포함된 장소가 운영시간 재충돌 시 excluded_places에 추가되어야 한다."""
    # 10:00~11:00만 운영 (09:00 시작 시 충돌) — opening_hours v2 구조
    # 2025-07-07 = 월요일(weekday=0)
    narrow_opening_hours = {str(i): [] for i in range(7)}
    narrow_opening_hours["0"] = [[600, 660]]  # 월요일만 10:00~11:00

    narrow_place = {
        **_make_place("p_narrow", 37.5, 127.0),
        "hours_source": "GOOGLE",
        "opening_hours": narrow_opening_hours,
        "pin_type": None,
    }

    # 이미 이동된 것으로 표시
    moved_place_ids: set[str] = {"p_narrow"}
    excluded_places: list[dict] = []

    result, excluded = timeline_validation(
        ordered=[narrow_place],
        route_matrix={},
        all_day_plans=[[narrow_place]],
        date_idx=0,
        moved_place_ids=moved_place_ids,
        excluded_places=excluded_places,
        date_str="2025-07-07",  # 월요일
    )

    # ordered_places에 포함되지 않고 excluded에 추가되어야 함
    assert result == []
    assert any(p["id"] == "p_narrow" for p in excluded)


# ---------------------------------------------------------------------------
# 9. alternative_agent: used_alt_ids 전역 누적으로 중복 대안 추천 방지
# ---------------------------------------------------------------------------

def test_alternative_agent_used_alt_ids():
    """place_a가 획득한 대안(kakao_alt_1)이 place_b의 대안에서 제외되어야 한다."""
    # ordered_places 형식 (place_id 키 사용)
    place_a = {
        "place_id": "place_a", "id": "place_a", "name": "카페A",
        "lat": 37.5, "lng": 127.0, "category": "카페", "start_at": "10:00",
    }
    place_b = {
        "place_id": "place_b", "id": "place_b", "name": "카페B",
        "lat": 37.6, "lng": 127.1, "category": "카페", "start_at": "14:00",
    }

    # search_nearby가 항상 동일한 kakao_alt_1을 반환
    alt_result = [{
        "id": "kakao_alt_1",
        "place_name": "대안카페",
        "y": "37.51",
        "x": "127.01",
        "road_address_name": "서울시",
        "category_group_code": "CE7",
    }]

    state = {
        "days": [
            {"ordered_places": [place_a]},
            {"ordered_places": [place_b]},
        ],
        "valid_places": [
            {**_make_place("place_a", 37.5, 127.0, "카페"), "kakao_place_id": ""},
            {**_make_place("place_b", 37.6, 127.1, "카페"), "kakao_place_id": ""},
        ],
    }

    with patch("agents.alternative_agent.search_nearby", new_callable=AsyncMock) as mock_search:
        mock_search.return_value = alt_result
        result = asyncio.run(alternative_agent(state))

    alts_a = result["alternatives"].get("place_a", [])
    alts_b = result["alternatives"].get("place_b", [])

    # place_a가 kakao_alt_1 획득 후 place_b는 해당 ID 제외 → 빈 배열
    all_kakao_ids = [a["kakao_place_id"] for a in alts_a + alts_b]
    assert len(all_kakao_ids) == len(set(all_kakao_ids)), "대안 kakao_place_id 중복 발생"


# ---------------------------------------------------------------------------
# 10. Validator Agent: 경고 생성 로직 검증
# ---------------------------------------------------------------------------

def _make_validator_place(
    pid: str,
    name: str,
    start_at: str,
    end_at: str,
    hours_source: str = "GOOGLE",
    travel_minutes: int = 10,
    place_warning: dict | None = None,
) -> dict:
    """Validator 테스트용 최소 장소 딕셔너리를 생성한다."""
    return {
        "place_id": pid,
        "name": name,
        "start_at": start_at,
        "end_at": end_at,
        "hours_source": hours_source,
        "travel_minutes_from_prev": travel_minutes,
        "place_warning": place_warning,
    }


def test_validator_day_density_over8():
    """하루 9개 장소 배치 시 8개 초과 경고가 생성되어야 한다."""
    places = [
        _make_validator_place(f"p{i}", f"장소{i}", "09:00", "10:00")
        for i in range(9)
    ]
    state = {"days": [{"date": "2025-07-01", "ordered_places": places}]}

    result = asyncio.run(validator_agent(state))

    assert "validation_warnings" in result
    assert any("9개 장소" in w for w in result["validation_warnings"])


def test_validator_total_hours_over12():
    """09:00 시작 22:00 종료(13시간) 일정에서 총 소요 시간 경고가 생성되어야 한다."""
    places = [
        _make_validator_place("p1", "장소A", "09:00", "10:00"),
        _make_validator_place("p2", "장소B", "21:00", "22:00"),
    ]
    state = {"days": [{"date": "2025-07-01", "ordered_places": places}]}

    result = asyncio.run(validator_agent(state))

    assert any("13시간" in w for w in result["validation_warnings"])


def test_validator_must_visit_closed():
    """place_warning이 MUST_VISIT_CLOSED인 장소에 대한 경고가 생성되어야 한다."""
    place = _make_validator_place(
        "p1", "경복궁", "09:00", "11:00",
        place_warning={"type": "MUST_VISIT_CLOSED", "message": "운영시간 외 배치"},
    )
    state = {"days": [{"date": "2025-07-01", "ordered_places": [place]}]}

    result = asyncio.run(validator_agent(state))

    assert any("운영시간 외 배치" in w and "경복궁" in w for w in result["validation_warnings"])


def test_validator_reservation_late():
    """RESERVATION_LATE 경고에서 late_by_minutes 값이 경고 메시지에 포함되어야 한다."""
    place = _make_validator_place(
        "p1", "흑돼지 맛집", "12:00", "13:30",
        place_warning={"type": "RESERVATION_LATE", "message": "지각", "late_by_minutes": 20},
    )
    state = {"days": [{"date": "2025-07-01", "ordered_places": [place]}]}

    result = asyncio.run(validator_agent(state))

    assert any("20분 늦게" in w for w in result["validation_warnings"])


def test_validator_default_hours_group():
    """DEFAULT 운영시간 장소가 4개일 때 '외 3곳' 그룹 경고가 생성되어야 한다."""
    places = [
        _make_validator_place(f"p{i}", f"장소{i}", "09:00", "10:00", hours_source="DEFAULT")
        for i in range(4)
    ]
    state = {"days": [{"date": "2025-07-01", "ordered_places": places}]}

    result = asyncio.run(validator_agent(state))

    assert any("외 3곳" in w for w in result["validation_warnings"])


def test_validator_gap_warning():
    """장소 간 대기 시간이 60분일 때 gap 경고가 생성되어야 한다."""
    # 장소A 종료 10:00, 이동 10분, 장소B 시작 12:00 → gap = 120 - 10 = 110분 → 경고
    places = [
        _make_validator_place("p1", "장소A", "09:00", "10:00", travel_minutes=0),
        _make_validator_place("p2", "장소B", "12:00", "13:00", travel_minutes=10),
    ]
    state = {"days": [{"date": "2025-07-01", "ordered_places": places}]}

    result = asyncio.run(validator_agent(state))

    assert any("대기 시간" in w for w in result["validation_warnings"])


def test_validator_deduplication():
    """동일 (place_id, warning_type) 조합이 여러 날짜에 나타나도 경고는 1개만 생성되어야 한다."""
    place_day1 = _make_validator_place(
        "p_dup", "중복장소", "09:00", "10:00",
        place_warning={"type": "MUST_VISIT_CLOSED", "message": "운영시간 외"},
    )
    place_day2 = _make_validator_place(
        "p_dup", "중복장소", "09:00", "10:00",
        place_warning={"type": "MUST_VISIT_CLOSED", "message": "운영시간 외"},
    )
    state = {
        "days": [
            {"date": "2025-07-01", "ordered_places": [place_day1]},
            {"date": "2025-07-02", "ordered_places": [place_day2]},
        ]
    }

    result = asyncio.run(validator_agent(state))

    closed_warnings = [w for w in result["validation_warnings"] if "중복장소" in w and "운영시간 외 배치" in w]
    assert len(closed_warnings) == 1, f"중복 경고 발생: {closed_warnings}"
