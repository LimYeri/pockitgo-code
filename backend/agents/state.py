from typing import Annotated, TypedDict


class ItineraryState(TypedDict):
    room_id: str
    places: list[dict]
    travel_dates: list[str]
    schedule_pins: list[dict]
    destination: str
    valid_places: list[dict]
    excluded_places: list[dict]
    days: list[dict]
    alternatives: dict
    validation_warnings: list[str]
    messages: Annotated[list[str], lambda x, y: x + y]
    error: str | None
