from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    SUPABASE_URL: str
    SUPABASE_SERVICE_ROLE_KEY: str
    KAKAO_API_KEY: str = ""
    KAKAO_MOBILITY_API_KEY: str = ""
    ALLOWED_ORIGINS: str = "http://localhost:3000"
    ANTHROPIC_API_KEY: str = ""
    GOOGLE_PLACES_API_KEY: str = ""
    TAVILY_API_KEY: str = ""

    # LangSmith 추적 설정
    LANGCHAIN_TRACING_V2: str = "false"
    LANGCHAIN_API_KEY: str = ""
    LANGCHAIN_PROJECT: str = "pockit-go"

    class Config:
        env_file = ".env"


settings = Settings()
