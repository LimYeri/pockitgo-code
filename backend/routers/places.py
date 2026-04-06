from typing import Annotated

from fastapi import APIRouter, HTTPException, Path

from core.supabase import supabase
from models.schemas import PlaceCreate, PlaceResponse, PlaceUpdate

router = APIRouter(prefix="/rooms", tags=["places"])


@router.get("/{room_id}/places")
def get_places(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> list[PlaceResponse]:
    result = (
        supabase.table("places")
        .select("*")
        .eq("room_id", room_id)
        .order("created_at")
        .execute()
    )
    return result.data


@router.post("/{room_id}/places", status_code=201)
def add_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    data: PlaceCreate,
) -> PlaceResponse:
    # 여행방 존재 확인
    room = supabase.table("travel_rooms").select("id").eq("id", room_id).execute()
    if not room.data:
        raise HTTPException(status_code=404, detail="여행방을 찾을 수 없습니다")

    # 동일 room 내 kakao_place_id 중복 검사
    existing = (
        supabase.table("places")
        .select("id")
        .eq("room_id", room_id)
        .eq("kakao_place_id", data.kakao_place_id)
        .execute()
    )
    if existing.data:
        raise HTTPException(status_code=409, detail="이미 위시리스트에 추가된 장소입니다")

    payload = {"room_id": room_id, **data.model_dump(mode="json")}
    result = supabase.table("places").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="장소 추가에 실패했습니다")
    return result.data[0]


@router.patch("/{room_id}/places/{place_id}")
def update_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    place_id: Annotated[str, Path(description="장소 ID")],
    data: PlaceUpdate,
) -> PlaceResponse:
    # 변경할 필드만 추출
    updates = data.model_dump(exclude_none=True)
    if not updates:
        raise HTTPException(status_code=400, detail="변경할 필드가 없습니다")

    result = (
        supabase.table("places")
        .update(updates)
        .eq("id", place_id)
        .eq("room_id", room_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다")
    return result.data[0]


@router.delete("/{room_id}/places/{place_id}", status_code=204)
def delete_place(
    room_id: Annotated[str, Path(description="여행방 ID")],
    place_id: Annotated[str, Path(description="장소 ID")],
) -> None:
    # 장소 존재 확인 (CASCADE로 schedule_pins도 자동 삭제됨)
    result = (
        supabase.table("places")
        .delete()
        .eq("id", place_id)
        .eq("room_id", room_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다")
