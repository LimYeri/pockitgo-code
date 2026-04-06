from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from core.supabase import supabase
from models.schemas import SchedulePinCreate, SchedulePinResponse

router = APIRouter(prefix="/rooms", tags=["pins"])


@router.get("/{room_id}/pins")
def get_pins(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> list[SchedulePinResponse]:
    # room_id에 속한 place_id 목록 조회
    places = (
        supabase.table("places")
        .select("id")
        .eq("room_id", room_id)
        .execute()
    )
    if not places.data:
        return []

    place_ids = [p["id"] for p in places.data]
    result = (
        supabase.table("schedule_pins")
        .select("*")
        .in_("place_id", place_ids)
        .execute()
    )
    return result.data


@router.post("/{room_id}/pins", status_code=201)
def create_pin(
    room_id: Annotated[str, Path(description="여행방 ID")],
    data: SchedulePinCreate,
) -> SchedulePinResponse:
    # 장소가 해당 여행방에 속하는지 확인
    place = (
        supabase.table("places")
        .select("id")
        .eq("id", str(data.place_id))
        .eq("room_id", room_id)
        .execute()
    )
    if not place.data:
        raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다")

    # RESERVATION 타입: 동일 여행방 내 날짜·시간 충돌 검사
    if data.type == "RESERVATION" and data.pinned_date and data.pinned_time:
        places_in_room = (
            supabase.table("places")
            .select("id")
            .eq("room_id", room_id)
            .execute()
        )
        place_ids = [p["id"] for p in places_in_room.data]

        conflict = (
            supabase.table("schedule_pins")
            .select("id")
            .in_("place_id", place_ids)
            .eq("type", "RESERVATION")
            .eq("pinned_date", str(data.pinned_date))
            .eq("pinned_time", str(data.pinned_time))
            .execute()
        )
        if conflict.data:
            raise HTTPException(
                status_code=400,
                detail="해당 시간대에 이미 고정된 일정이 있습니다",
            )

    result = (
        supabase.table("schedule_pins")
        .insert(data.model_dump(mode="json"))
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="핀 등록에 실패했습니다")
    return result.data[0]


@router.delete("/{room_id}/pins/{pin_id}", status_code=204)
def delete_pin(
    room_id: Annotated[str, Path(description="여행방 ID")],
    pin_id: Annotated[str, Path(description="핀 ID")],
) -> None:
    # 핀이 해당 여행방 장소에 속하는지 확인 후 삭제
    places_in_room = (
        supabase.table("places")
        .select("id")
        .eq("room_id", room_id)
        .execute()
    )
    place_ids = [p["id"] for p in places_in_room.data] if places_in_room.data else []

    result = (
        supabase.table("schedule_pins")
        .delete()
        .eq("id", pin_id)
        .in_("place_id", place_ids)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="핀을 찾을 수 없습니다")
