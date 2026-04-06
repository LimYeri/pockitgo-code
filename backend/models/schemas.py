from pydantic import BaseModel, ConfigDict
from datetime import date, time, datetime
from typing import Optional, Any
import uuid


class TravelRoomCreate(BaseModel):
    title: str
    destination: str
    start_date: date
    end_date: date


class TravelRoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str
    destination: str
    start_date: date
    end_date: date
    invite_link: uuid.UUID
    created_at: datetime


class MemberCreate(BaseModel):
    nickname: str
    auth_id: str


class MemberResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID
    nickname: str
    auth_id: str
    joined_at: datetime


class PlaceCreate(BaseModel):
    name: str
    lat: float
    lng: float
    category: str
    is_must_visit: bool = False
    memo: Optional[str] = None
    added_by: str
    kakao_place_id: str


class PlaceResponse(PlaceCreate):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    room_id: uuid.UUID


class PlaceUpdate(BaseModel):
    is_must_visit: Optional[bool] = None
    memo: Optional[str] = None
    category: Optional[str] = None


class SchedulePinCreate(BaseModel):
    place_id: uuid.UUID
    type: str
    pinned_date: Optional[date] = None
    pinned_time: Optional[time] = None
    checkout_date: Optional[date] = None


class SchedulePinResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    place_id: uuid.UUID
    type: str
    pinned_date: Optional[date] = None
    pinned_time: Optional[time] = None
    checkout_date: Optional[date] = None


class AlternativePlace(BaseModel):
    name: str
    lat: float
    lng: float
    address: str
    kakao_place_id: str
    category: str
    distance_m: int


class ExcludedPlace(BaseModel):
    id: str
    name: str
    category: str
    reason: str


class ItineraryDayResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: str
    ordered_places: list[Any]
    alternatives: dict[str, list[AlternativePlace]]
    excluded_places: list[ExcludedPlace]


class ItineraryGenerateResponse(BaseModel):
    room_id: str
    days: list[ItineraryDayResponse]
    generated_at: datetime


class ReplaceRequest(BaseModel):
    date: str
    original_place_id: str
    new_place: AlternativePlace


class UpdateOrderRequest(BaseModel):
    date: str
    ordered_places: list[dict]
