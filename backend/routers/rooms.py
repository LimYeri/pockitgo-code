from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from core.supabase import supabase
from models.schemas import (
    MemberCreate,
    MemberResponse,
    TravelRoomCreate,
    TravelRoomResponse,
)

router = APIRouter(prefix="/rooms", tags=["rooms"])


@router.post("/", status_code=201)
def create_room(data: TravelRoomCreate) -> TravelRoomResponse:
    result = supabase.table("travel_rooms").insert(data.model_dump(mode="json")).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="여행방 생성에 실패했습니다")
    return result.data[0]


@router.get("/by-invite/{invite_token}")
def get_room_by_invite(
    invite_token: Annotated[str, Path(description="초대 링크 토큰")],
) -> TravelRoomResponse:
    try:
        result = (
            supabase.table("travel_rooms")
            .select("*")
            .eq("invite_link", invite_token)
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=404, detail="유효하지 않은 링크입니다")
    if not result.data:
        raise HTTPException(status_code=404, detail="유효하지 않은 링크입니다")
    return result.data[0]


@router.get("/{room_id}/members")
def get_room_members(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> list[MemberResponse]:
    result = (
        supabase.table("members")
        .select("*")
        .eq("room_id", room_id)
        .execute()
    )
    return result.data


@router.get("/{room_id}/members/me")
def get_my_membership(
    room_id: Annotated[str, Path(description="여행방 ID")],
    auth_id: Annotated[str, Query(description="Supabase 익명 로그인 auth_id")],
) -> MemberResponse:
    result = (
        supabase.table("members")
        .select("*")
        .eq("room_id", room_id)
        .eq("auth_id", auth_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="멤버를 찾을 수 없습니다")
    return result.data[0]


@router.get("/{room_id}")
def get_room(
    room_id: Annotated[str, Path(description="여행방 ID")],
) -> TravelRoomResponse:
    result = (
        supabase.table("travel_rooms")
        .select("*")
        .eq("id", room_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="여행방을 찾을 수 없습니다")
    return result.data[0]


@router.post("/{room_id}/members", status_code=201)
def join_room(
    room_id: Annotated[str, Path(description="여행방 ID")],
    data: MemberCreate,
) -> MemberResponse:
    # 여행방 존재 확인
    room = (
        supabase.table("travel_rooms")
        .select("id")
        .eq("id", room_id)
        .execute()
    )
    if not room.data:
        raise HTTPException(status_code=404, detail="여행방을 찾을 수 없습니다")

    # 닉네임 중복 확인
    dup = (
        supabase.table("members")
        .select("id")
        .eq("room_id", room_id)
        .eq("nickname", data.nickname)
        .execute()
    )
    if dup.data:
        raise HTTPException(status_code=400, detail="이미 사용 중인 닉네임입니다")

    result = (
        supabase.table("members")
        .insert({"room_id": room_id, "nickname": data.nickname, "auth_id": data.auth_id})
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=500, detail="멤버 등록에 실패했습니다")
    return result.data[0]
