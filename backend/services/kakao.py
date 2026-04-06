import logging
import httpx
from core.config import settings

logger = logging.getLogger(__name__)

# Kakao Maps 카테고리 코드 매핑
CATEGORY_MAP = {
    "맛집": "FD6",
    "카페": "CE7",
    "관광지": "AT4",
    "숙소": "AD5",
    "액티비티": "CT1",
}


async def search_nearby(
    lat: float,
    lng: float,
    category: str,
    radius: int = 500,
    size: int = 3,
) -> list[dict]:
    """Kakao Maps 카테고리 검색으로 주변 장소를 반환한다."""
    category_code = CATEGORY_MAP.get(category)
    if not category_code:
        return []

    url = "https://dapi.kakao.com/v2/local/search/category.json"
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_API_KEY}"}
    params = {
        "category_group_code": category_code,
        "x": lng,
        "y": lat,
        "radius": radius,
        "size": size,
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            return data.get("documents", [])
    except Exception as e:
        logger.warning(f"[Kakao Search Error] category={category}, lat={lat}, lng={lng}: {e}")
        return []


async def get_travel_time(
    origin_lat: float,
    origin_lng: float,
    dest_lat: float,
    dest_lng: float,
    origin_name: str = "",
    origin_id: str = "",
    dest_name: str = "",
    dest_id: str = "",
) -> int:
    """Kakao Mobility로 자차 이동 시간(분)을 계산한다. 오류 시 30분 반환."""
    url = "https://apis-navi.kakaomobility.com/v1/directions"
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_MOBILITY_API_KEY}"}
    params = {
        "origin": f"{origin_lng},{origin_lat}",
        "destination": f"{dest_lng},{dest_lat}",
    }

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(url, headers=headers, params=params, timeout=10.0)
            response.raise_for_status()
            data = response.json()
            duration_sec = data["routes"][0]["summary"]["duration"]
            return duration_sec // 60
    except Exception as e:
        logger.warning(
            f"[Route Error] {origin_name}({origin_id}) -> {dest_name}({dest_id}) : Using Default 30min"
        )
        return 30
