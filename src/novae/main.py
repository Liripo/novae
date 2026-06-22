from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from agno.db.sqlite import SqliteDb
from agno.os import AgentOS
from agno.os.interfaces.agui import AGUI

from novae.agents import novae_agent
from novae.config import get_config

cfg = get_config()

db = SqliteDb(db_file=cfg.db_file)

agent_os = AgentOS(
    name=cfg.agent_name,
    description="Novae coding agent",
    agents=[novae_agent],
    db=db,
    interfaces=[AGUI(agent=novae_agent)]
)

app: FastAPI = agent_os.get_app()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
async def health():
    return {"status": "ok"}
