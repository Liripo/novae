import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")


@dataclass(frozen=True)
class Config:
    redis_host: str
    redis_port: int
    redis_db: int
    redis_password: str | None
    workspace_root: Path
    jwt_secret: str
    jwt_expire_hours: int


def get_config() -> Config:
    redis_host = os.getenv("NOVAE_REDIS_HOST", "localhost")
    redis_port = int(os.getenv("NOVAE_REDIS_PORT", "6379"))
    redis_db = int(os.getenv("NOVAE_REDIS_DB", "0"))
    redis_password = os.getenv("NOVAE_REDIS_PASSWORD") or None

    workspace_root = Path(
        os.getenv(
            "NOVAE_WORKSPACE_ROOT",
            str(ROOT_DIR / "data" / "workspaces"),
        )
    )
    workspace_root.mkdir(parents=True, exist_ok=True)

    jwt_secret = os.getenv(
        "NOVAE_JWT_SECRET",
        "novae-dev-jwt-secret-change-me-in-production",
    )
    jwt_expire_hours = int(os.getenv("NOVAE_JWT_EXPIRE_HOURS", "168"))

    return Config(
        redis_host=redis_host,
        redis_port=redis_port,
        redis_db=redis_db,
        redis_password=redis_password,
        workspace_root=workspace_root,
        jwt_secret=jwt_secret,
        jwt_expire_hours=jwt_expire_hours,
    )
