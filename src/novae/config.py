import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[2]
load_dotenv(ROOT_DIR / ".env")

@dataclass(frozen=True)
class Config:
    model_id: str
    api_key: str
    base_url: str
    db_file: str
    agent_name: str


def get_config() -> Config:
    api_key = os.getenv("OPENAI_API_KEY", "")
    base_url = os.getenv("OPENAI_BASE_URL", "")
    model_id = os.getenv("NOVAE_MODEL", "")
    if not (api_key and base_url and model_id):
        raise RuntimeError(
            "Missing model config: set OPENAI_API_KEY, OPENAI_BASE_URL, "
            "NOVAE_MODEL (see .env.example)"
        )

    db_file = Path(
        os.getenv(
            "NOVAE_HOME",
            str(Path.home() / ".novae" / "novae_session.db"),
        )
    )
    db_file.parent.mkdir(parents=True, exist_ok=True)

    agent_name = "novae"

    return Config(
        model_id=model_id,
        api_key=api_key,
        base_url=base_url,
        db_file=str(db_file),
        agent_name=agent_name,
    )
