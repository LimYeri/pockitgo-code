import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from core.config import settings
from routers import rooms, places, pins, itinerary

# LangSmith 추적 환경 변수 설정 (설정 값을 os.environ에 반영)
if settings.LANGCHAIN_TRACING_V2 == "true" and settings.LANGCHAIN_API_KEY:
    os.environ["LANGCHAIN_TRACING_V2"] = "true"
    os.environ["LANGCHAIN_API_KEY"] = settings.LANGCHAIN_API_KEY
    os.environ["LANGCHAIN_PROJECT"] = settings.LANGCHAIN_PROJECT

app = FastAPI(title="PockitGo API")

origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",")]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(rooms.router)
app.include_router(places.router, tags=["places"])
app.include_router(pins.router, tags=["pins"])
app.include_router(itinerary.router, tags=["itinerary"])


@app.get("/health")
def health():
    return {"status": "ok"}
