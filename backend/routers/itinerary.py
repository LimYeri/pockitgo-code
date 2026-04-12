import json
import logging
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, AsyncGenerator

from fastapi import APIRouter, HTTPException, Path

logger = logging.getLogger(__name__)
from fastapi.responses import StreamingResponse

from agents.pipeline import get_pipeline
from core.supabase import supabase
from models.schemas import (
    AddItineraryPlaceRequest,
    ItineraryDayResponse,
    ItineraryGenerateResponse,
    ReplaceRequest,
    UpdateOrderRequest,
)
from services import kakao as kakao_service

router = APIRouter(prefix="/rooms", tags=["itinerary"])

# 각 Agent 단계별 메시지
STEP_MESSAGES: dict[str, dict[str, str]] = {
    "filter": {
        "started": "여행 가능 장소 분류 중...",
        "completed": "Filter Agent 완료",
    },
    "planner": {
        "started": "최적 동선 생성 중...",
        "completed": "Planner Agent 완료",
    },
    "validator": {
        "started": "일정 검증 중...",
        "completed": "Validator 완료",
    },
    "alternative": {
        "started": "대안 장소 탐색 중...",
        "completed": "Alternative Agent 완료",
    },
}

TARGET_NODES = set(STEP_MESSAGES.keys())


def _attach_travel_time_after(places: list[dict]) -> list[dict]:
    """ordered_places의 travel_minutes_from_prev를 travel_time_after로 변환한다.

    Planner Agent는 각 장소에 이전 장소→현재 장소 이동시간(travel_minutes_from_prev)을 저장한다.
    프론트엔드 TimelineCard는 현재 장소→다음 장소 이동시간(travel_time_after)을 기대하므로
    upsert 직전에 변환하여 저장한다.
    """
    for i in range(len(places)):
        if i < len(places) - 1:
            places[i]["travel_time_after"] = places[i + 1].get("travel_minutes_from_prev")
        else:
            places[i]["travel_time_after"] = None
    return places


async def _generate_stream(
    initial_state: dict,
    room_id: str,
) -> AsyncGenerator[str, None]:
    """LangGraph 파이프라인을 실행하며 SSE 이벤트를 yield한다."""
    # 각 노드의 출력을 누적해 최종 상태 구성
    accumulated: dict = {}

    try:
        async for event in get_pipeline().astream_events(initial_state, version="v2"):
            node = event.get("metadata", {}).get("langgraph_node", "")
            if node not in TARGET_NODES:
                continue

            if event["event"] == "on_chain_start":
                payload = {
                    "type": "progress",
                    "step": node,
                    "status": "started",
                    "message": STEP_MESSAGES[node]["started"],
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

            elif event["event"] == "on_chain_end":
                # 노드 출력을 누적 (최종 Supabase upsert에 사용)
                output = event.get("data", {}).get("output") or {}
                if isinstance(output, dict):
                    accumulated.update(output)

                payload = {
                    "type": "progress",
                    "step": node,
                    "status": "completed",
                    "message": STEP_MESSAGES[node]["completed"],
                }
                yield f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"

        # 파이프라인 완료 후 Supabase upsert
        days = accumulated.get("days") or []
        alternatives = accumulated.get("alternatives") or {}
        excluded_places = accumulated.get("excluded_places") or []
        validation_warnings = accumulated.get("validation_warnings") or []

        for day in days:
            # travel_minutes_from_prev → travel_time_after 변환 (초기 로드 시 이동 시간 표시용)
            day["ordered_places"] = _attach_travel_time_after(day["ordered_places"])
            day_place_ids = {p["place_id"] for p in day.get("ordered_places", [])}
            day_alternatives = {
                k: v for k, v in alternatives.items() if k in day_place_ids
            }
            supabase.table("itineraries").upsert(
                {
                    "room_id": room_id,
                    "date": day["date"],
                    "ordered_places": day["ordered_places"],
                    "alternatives": day_alternatives,
                    "excluded_places": excluded_places,
                    "validation_warnings": validation_warnings,
                },
                on_conflict="room_id,date",
            ).execute()

        done_payload = {"type": "done", "room_id": room_id}
        yield f"data: {json.dumps(done_payload)}\n\n"

    except ValueError as e:
        # 숙소 날짜 충돌 등 사용자 입력 오류 → 상세 메시지 그대로 전달
        logger.warning(f"[Itinerary] 사용자 입력 오류: {e}")
        error_payload = {"type": "error", "message": str(e)}
        yield f"data: {json.dumps(error_payload, ensure_ascii=False)}\n\n"
    except Exception as e:
        logger.error(f"[Itinerary] 일정 생성 실패: {e}")
        error_payload = {"type": "error", "message": str(e)}
        yield f"data: {json.dumps(error_payload, ensure_ascii=False)}\n\n"


@router.post("/{room_id}/itinerary/generate")
async def generate_itinerary(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> StreamingResponse:
    # 1. 여행방 조회
    room_result = (
        supabase.table("travel_rooms").select("*").eq("id", room_id).single().execute()
    )
    if not room_result.data:
        raise HTTPException(status_code=404, detail="여행방을 찾을 수 없습니다")

    room = room_result.data

    # 2. 장소 목록 조회
    places_result = (
        supabase.table("places").select("*").eq("room_id", room_id).execute()
    )
    if not places_result.data:
        raise HTTPException(status_code=400, detail="장소를 먼저 추가해주세요")

    # 3. 고정 핀 조회
    pins_result = (
        supabase.table("schedule_pins")
        .select("*, places!inner(room_id)")
        .eq("places.room_id", room_id)
        .execute()
    )

    # 4. 여행 날짜 목록 생성
    start = date.fromisoformat(room["start_date"])
    end = date.fromisoformat(room["end_date"])
    travel_dates = [
        (start + timedelta(days=i)).isoformat()
        for i in range((end - start).days + 1)
    ]

    # 5. 초기 상태 구성
    initial_state = {
        "room_id": room_id,
        "places": places_result.data,
        "travel_dates": travel_dates,
        "schedule_pins": pins_result.data or [],
        "destination": room.get("destination", ""),
        "valid_places": [],
        "excluded_places": [],
        "days": [],
        "alternatives": {},
        "validation_warnings": [],
        "messages": [],
        "error": None,
    }

    # 6. SSE 스트리밍 응답 반환
    return StreamingResponse(
        _generate_stream(initial_state, room_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{room_id}/itinerary/stream")
async def stream_itinerary(room_id: Annotated[str, Path(description="여행방 ID")]):
    pass


@router.get("/{room_id}/itinerary")
async def get_itinerary(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> list[ItineraryDayResponse]:
    result = (
        supabase.table("itineraries")
        .select("*")
        .eq("room_id", room_id)
        .order("date")
        .execute()
    )
    return result.data or []


@router.post("/{room_id}/itinerary/replace")
async def replace_itinerary_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    body: ReplaceRequest,
) -> ItineraryDayResponse:
    """플랜B/C 대안 장소로 교체하고 인접 구간 이동 시간을 재계산한다."""
    result = (
        supabase.table("itineraries")
        .select("*")
        .eq("room_id", room_id)
        .eq("date", body.date)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="해당 날짜의 일정을 찾을 수 없습니다")

    row = result.data
    ordered_places: list[dict] = list(row["ordered_places"])
    alternatives: dict = dict(row.get("alternatives") or {})

    # 교체 대상 인덱스 탐색
    target_idx = next(
        (i for i, p in enumerate(ordered_places) if p["place_id"] == body.original_place_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(status_code=404, detail="교체 대상 장소를 찾을 수 없습니다")

    # 기존 장소 데이터 보존 (scheduled_time 유지)
    old_place = ordered_places[target_idx]
    new_entry: dict = {
        "place_id": body.new_place.kakao_place_id,
        "name": body.new_place.name,
        "lat": body.new_place.lat,
        "lng": body.new_place.lng,
        "category": body.new_place.category,
        "scheduled_time": old_place.get("scheduled_time"),
        "travel_time_after": old_place.get("travel_time_after"),
    }
    ordered_places[target_idx] = new_entry

    # 인접 구간 이동 시간 재계산 (실패 시 기존 값 유지)
    # 직전 → 교체 장소
    if target_idx > 0:
        prev = ordered_places[target_idx - 1]
        try:
            t = await kakao_service.get_travel_time(
                prev["lat"], prev["lng"],
                new_entry["lat"], new_entry["lng"],
                prev["name"], prev["place_id"],
                new_entry["name"], new_entry["place_id"],
            )
            ordered_places[target_idx - 1]["travel_time_after"] = t
        except Exception:
            pass

    # 교체 장소 → 다음 장소
    if target_idx < len(ordered_places) - 1:
        nxt = ordered_places[target_idx + 1]
        try:
            t = await kakao_service.get_travel_time(
                new_entry["lat"], new_entry["lng"],
                nxt["lat"], nxt["lng"],
                new_entry["name"], new_entry["place_id"],
                nxt["name"], nxt["place_id"],
            )
            ordered_places[target_idx]["travel_time_after"] = t
        except Exception:
            pass
    else:
        # 마지막 장소는 이동 시간 없음
        ordered_places[target_idx]["travel_time_after"] = None

    # 교체된 장소의 대안 목록 제거
    alternatives.pop(body.original_place_id, None)

    supabase.table("itineraries").upsert(
        {
            "room_id": room_id,
            "date": body.date,
            "ordered_places": ordered_places,
            "alternatives": alternatives,
            "excluded_places": row.get("excluded_places") or [],
            "validation_warnings": row.get("validation_warnings") or [],
        },
        on_conflict="room_id,date",
    ).execute()

    return ItineraryDayResponse(
        date=body.date,
        ordered_places=ordered_places,
        alternatives=alternatives,
        excluded_places=row.get("excluded_places") or [],
        validation_warnings=row.get("validation_warnings") or [],
    )


async def _recalculate_all_travel_times(places: list[dict]) -> list[dict]:
    """ordered_places 전구간 이동 시간을 재계산한다.

    연속된 장소 쌍마다 Kakao Mobility API를 호출하고,
    마지막 장소의 travel_time_after는 None으로 설정한다.
    """
    for i in range(len(places) - 1):
        cur = places[i]
        nxt = places[i + 1]
        try:
            t = await kakao_service.get_travel_time(
                cur["lat"], cur["lng"],
                nxt["lat"], nxt["lng"],
                cur.get("name", ""), cur.get("place_id", ""),
                nxt.get("name", ""), nxt.get("place_id", ""),
            )
            places[i]["travel_time_after"] = t
        except Exception:
            pass

    if places:
        places[-1]["travel_time_after"] = None

    return places


@router.patch("/{room_id}/itinerary")
async def update_itinerary(
    room_id: Annotated[str, Path(description="여행방 ID")],
    body: UpdateOrderRequest,
) -> ItineraryDayResponse:
    """장소 방문 순서를 변경하고 전체 구간 이동 시간을 재계산한다."""
    result = (
        supabase.table("itineraries")
        .select("*")
        .eq("room_id", room_id)
        .eq("date", body.date)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="해당 날짜의 일정을 찾을 수 없습니다")

    row = result.data
    ordered_places: list[dict] = list(body.ordered_places)

    # 헬퍼로 전구간 이동 시간 재계산
    ordered_places = await _recalculate_all_travel_times(ordered_places)

    supabase.table("itineraries").upsert(
        {
            "room_id": room_id,
            "date": body.date,
            "ordered_places": ordered_places,
            "alternatives": row.get("alternatives") or {},
            "excluded_places": row.get("excluded_places") or [],
            "validation_warnings": row.get("validation_warnings") or [],
        },
        on_conflict="room_id,date",
    ).execute()

    return ItineraryDayResponse(
        date=body.date,
        ordered_places=ordered_places,
        alternatives=row.get("alternatives") or {},
        excluded_places=row.get("excluded_places") or [],
        validation_warnings=row.get("validation_warnings") or [],
    )


@router.post("/{room_id}/itinerary/{date}/places")
async def add_itinerary_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    date: Annotated[str, Path(description="날짜 (YYYY-MM-DD)")],
    body: AddItineraryPlaceRequest,
) -> ItineraryDayResponse:
    """일정 결과의 특정 날짜 타임라인 끝에 장소를 추가하고 이동 시간을 재계산한다."""
    result = (
        supabase.table("itineraries")
        .select("*")
        .eq("room_id", room_id)
        .eq("date", date)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="해당 날짜의 일정을 찾을 수 없습니다")

    row = result.data
    ordered_places: list[dict] = list(row["ordered_places"])

    # 새 장소를 타임라인 끝에 추가
    new_place: dict = {
        "place_id": body.kakao_place_id,
        "name": body.name,
        "lat": body.lat,
        "lng": body.lng,
        "category": body.category,
        "travel_time_after": None,
    }
    ordered_places.append(new_place)

    # 전구간 이동 시간 재계산
    ordered_places = await _recalculate_all_travel_times(ordered_places)

    supabase.table("itineraries").upsert(
        {
            "room_id": room_id,
            "date": date,
            "ordered_places": ordered_places,
            "alternatives": row.get("alternatives") or {},
            "excluded_places": row.get("excluded_places") or [],
            "validation_warnings": row.get("validation_warnings") or [],
        },
        on_conflict="room_id,date",
    ).execute()

    return ItineraryDayResponse(
        date=date,
        ordered_places=ordered_places,
        alternatives=row.get("alternatives") or {},
        excluded_places=row.get("excluded_places") or [],
        validation_warnings=row.get("validation_warnings") or [],
    )


@router.delete("/{room_id}/itinerary/{date}/places/{place_id}")
async def remove_itinerary_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    date: Annotated[str, Path(description="날짜 (YYYY-MM-DD)")],
    place_id: Annotated[str, Path(description="제거할 장소 ID")],
) -> ItineraryDayResponse:
    """일정 결과의 특정 날짜에서 장소를 제거하고 이동 시간을 재계산한다."""
    result = (
        supabase.table("itineraries")
        .select("*")
        .eq("room_id", room_id)
        .eq("date", date)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="해당 날짜의 일정을 찾을 수 없습니다")

    row = result.data
    ordered_places: list[dict] = list(row["ordered_places"])
    alternatives: dict = dict(row.get("alternatives") or {})

    # 제거 대상 인덱스 탐색
    target_idx = next(
        (i for i, p in enumerate(ordered_places) if p["place_id"] == place_id),
        None,
    )
    if target_idx is None:
        raise HTTPException(status_code=404, detail="해당 장소를 일정에서 찾을 수 없습니다")

    ordered_places.pop(target_idx)

    # 해당 장소의 대안 목록도 제거
    alternatives.pop(place_id, None)

    # 전구간 이동 시간 재계산
    ordered_places = await _recalculate_all_travel_times(ordered_places)

    supabase.table("itineraries").upsert(
        {
            "room_id": room_id,
            "date": date,
            "ordered_places": ordered_places,
            "alternatives": alternatives,
            "excluded_places": row.get("excluded_places") or [],
            "validation_warnings": row.get("validation_warnings") or [],
        },
        on_conflict="room_id,date",
    ).execute()

    return ItineraryDayResponse(
        date=date,
        ordered_places=ordered_places,
        alternatives=alternatives,
        excluded_places=row.get("excluded_places") or [],
        validation_warnings=row.get("validation_warnings") or [],
    )
