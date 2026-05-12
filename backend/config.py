from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    MODEL_PATH: str = "./models/best_model.keras"
    META_PATH: str = "./models/meta.json"
    INDEX_MAPPING_PATH: str = "./models/100_index_mapping.json"

    SEQ_LEN: int = 60
    MIN_CONFIDENCE: float = 0.55
    DEVICE: str = "cpu"

    ALLOWED_ORIGINS: str = "http://localhost:5173"
    PI_SHARED_TOKEN: str = "change-me"

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.ALLOWED_ORIGINS.split(",") if o.strip()]


settings = Settings()
