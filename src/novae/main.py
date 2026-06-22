from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, status
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from redis.asyncio import Redis as AsyncRedis

from agentscope.app import create_app
from agentscope.app._lifespan import lifespan as _agentscope_lifespan
from agentscope.app.deps import get_current_user_id as _agentscope_get_user_id
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.storage import RedisStorage
from agentscope.app.workspace_manager import LocalWorkspaceManager

from novae.agents import seed_builtin_agent
from novae.auth import (
    UserStore,
    create_token,
    decode_token,
    seed_default_users,
)
from novae.config import get_config

cfg = get_config()


async def _jwt_user_id(
    authorization: str = Header(
        default="",
        description="Bearer JWT token. Obtained from POST /auth/login.",
    ),
) -> str:
    """Validate the Bearer JWT and return the authenticated username."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(cfg, token)
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token.",
        )
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )
    return username


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    username: str
    role: str


class MeResponse(BaseModel):
    username: str
    role: str


@asynccontextmanager
async def novae_lifespan(app: FastAPI):
    """Extend the AgentScope lifespan to seed built-in users and agent."""
    async with _agentscope_lifespan(app):
        redis = AsyncRedis(
            host=cfg.redis_host,
            port=cfg.redis_port,
            db=cfg.redis_db,
            password=cfg.redis_password,
            decode_responses=True,
        )
        app.state.novae_user_store = UserStore(redis)
        try:
            await seed_default_users(app.state.novae_user_store)
            await seed_builtin_agent(app)
            yield
        finally:
            await redis.aclose()


app: FastAPI = create_app(
    storage=RedisStorage(
        host=cfg.redis_host,
        port=cfg.redis_port,
        db=cfg.redis_db,
        password=cfg.redis_password,
    ),
    message_bus=RedisMessageBus(
        host=cfg.redis_host,
        port=cfg.redis_port,
        db=cfg.redis_db,
        password=cfg.redis_password,
    ),
    workspace_manager=LocalWorkspaceManager(
        basedir=str(cfg.workspace_root),
    ),
    title="Novae",
    extra_middlewares=[
        Middleware(
            CORSMiddleware,
            allow_origins=["http://localhost:5173"],
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        ),
    ],
)

# Replace the lifespan so seeding runs after AgentScope resources are up.
app.router.lifespan_context = novae_lifespan

# Override the AgentScope user-id dependency with our JWT-based one.
app.dependency_overrides[_agentscope_get_user_id] = _jwt_user_id


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest) -> LoginResponse:
    user_store: UserStore = app.state.novae_user_store
    record = await user_store.authenticate(body.username, body.password)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )
    token = create_token(cfg, record["username"], record["role"])
    return LoginResponse(
        token=token,
        username=record["username"],
        role=record["role"],
    )


@app.get("/auth/me", response_model=MeResponse)
async def me(username: str = Depends(_jwt_user_id)) -> MeResponse:
    user_store: UserStore = app.state.novae_user_store
    record = await user_store.get(username)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found.",
        )
    return MeResponse(username=record["username"], role=record["role"])
