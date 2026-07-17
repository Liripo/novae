import json
import os
import re
import shutil
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware import Middleware
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from redis.asyncio import Redis as AsyncRedis
from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from agentscope.app import create_app
from agentscope.app._lifespan import lifespan as _agentscope_lifespan
from agentscope.app._service import SessionService
from agentscope.app.deps import get_current_user_id as _agentscope_get_user_id
from agentscope.app.deps import get_session_service
from agentscope.app.message_bus import RedisMessageBus
from agentscope.app.storage import RedisStorage
from agentscope.credential import OpenAICredential
from pydantic import SecretStr

from novae.accounts import (
    Role,
    UserStore,
    create_token,
    decode_token,
    seed_default_users,
)
from novae.agents import seed_builtin_agent
from novae.config import get_config
from novae.model_patch import apply_model_retry_patch
from novae.projects import ProjectStore
from novae.runtime_env import RuntimeEnvMiddleware
from novae.workspace import ProjectWorkspaceManager

# Retune chat-model retries (429-friendly) before any chat run builds a
# model. Idempotent — safe under module re-imports.
apply_model_retry_patch()

cfg = get_config()

# Fixed id of the backend-managed credential seeded from .env. The
# credential page was removed from the UI — API keys are configured
# centrally via OPENAI_API_KEY / OPENAI_BASE_URL in the backend .env.
ENV_CREDENTIAL_ID = "env-openai"


class EnvModelConfigMiddleware:
    """Inject the .env-configured default chat model into creation requests.

    The model-selection UI was removed: the chat model is centrally
    configured via ``NOVAE_MODEL`` in the backend .env. This pure-ASGI
    middleware intercepts ``POST /sessions/`` and ``POST /schedule/`` and,
    when the JSON body lacks ``chat_model_config`` (or carries ``null``),
    injects the env default so downstream validation and the chat runtime
    always find a model. Requests that already carry a config pass through
    untouched, as do non-JSON / empty bodies. When ``NOVAE_MODEL`` is not
    configured the middleware is a no-op.
    """

    _TARGET_PATHS = frozenset(
        {"/sessions/", "/sessions", "/schedule/", "/schedule"}
    )

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] != "http"
            or scope.get("method") != "POST"
            or scope.get("path") not in self._TARGET_PATHS
        ):
            await self.app(scope, receive, send)
            return

        model_name = os.getenv("NOVAE_MODEL")
        if not model_name:
            await self.app(scope, receive, send)
            return

        # Consume the full request body (standard consume/replay pattern).
        body = b""
        while True:
            message = await receive()
            if message["type"] == "http.request":
                body += message.get("body", b"")
                if not message.get("more_body"):
                    break

        try:
            payload = json.loads(body) if body else None
        except ValueError:
            payload = None

        if isinstance(payload, dict) and not payload.get("chat_model_config"):
            payload["chat_model_config"] = {
                "type": "openai_credential",
                "credential_id": ENV_CREDENTIAL_ID,
                "model": model_name,
                "parameters": {},
            }
            new_body = json.dumps(payload).encode("utf-8")
            headers = MutableHeaders(scope=scope)
            headers["content-length"] = str(len(new_body))
        else:
            new_body = body

        sent = False

        async def replay_receive() -> Message:
            nonlocal sent
            if sent:
                return {"type": "http.request", "body": b"", "more_body": False}
            sent = True
            return {"type": "http.request", "body": new_body, "more_body": False}

        await self.app(scope, replay_receive, send)


async def seed_env_credential(app: FastAPI, username: str) -> None:
    """Seed the .env-configured OpenAI credential for a user (idempotent).

    Upserting with a fixed id keeps the .env as the single source of
    truth: every login/startup refreshes the record in place, and model
    selection works without any credential management UI.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return
    await app.state.storage.upsert_credential(
        username,
        OpenAICredential(
            id=ENV_CREDENTIAL_ID,
            name="系统默认",
            api_key=SecretStr(api_key),
            base_url=os.getenv("OPENAI_BASE_URL") or None,
        ),
    )


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


class CreateProjectRequest(BaseModel):
    name: str
    description: str = ""
    agent_id: str


class UpdateProjectRequest(BaseModel):
    name: str | None = None
    description: str | None = None


class CreateUserRequest(BaseModel):
    username: str
    password: str
    role: Role = "user"


# Directories never shown (nor recursed into) in the project file tree.
_TREE_SKIP_DIRS = {
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    "out",
    ".next",
    ".cache",
}
_TREE_MAX_DEPTH = 4
_TREE_MAX_ENTRIES = 200
_FILE_CONTENT_LIMIT = 256 * 1024
_SAFE_PATH_COMPONENT = re.compile(r"^[a-zA-Z0-9_-]+$")


def _scan_project_tree(workdir: Path) -> list[dict]:
    """Build the nested file tree of ``workdir``.

    Depth is capped at ``_TREE_MAX_DEPTH`` levels, each directory yields
    at most ``_TREE_MAX_ENTRIES`` entries, and hidden entries (``.``-prefixed)
    plus bulky generated directories (node_modules, .git, ...) are skipped.
    Paths are POSIX-style, relative to ``workdir``.
    """

    def scan(dir_abs: Path, rel: str, depth: int) -> list[dict]:
        try:
            entries = sorted(
                os.scandir(dir_abs),
                key=lambda e: (not e.is_dir(follow_symlinks=False), e.name.lower()),
            )
        except OSError:
            return []
        nodes: list[dict] = []
        for entry in entries:
            if len(nodes) >= _TREE_MAX_ENTRIES:
                break
            if entry.name.startswith("."):
                continue
            entry_rel = f"{rel}/{entry.name}" if rel else entry.name
            if entry.is_dir(follow_symlinks=False):
                if entry.name in _TREE_SKIP_DIRS:
                    continue
                children = (
                    scan(Path(entry.path), entry_rel, depth + 1)
                    if depth < _TREE_MAX_DEPTH
                    else []
                )
                nodes.append(
                    {
                        "name": entry.name,
                        "path": entry_rel,
                        "type": "dir",
                        "children": children,
                    }
                )
            elif entry.is_file(follow_symlinks=False):
                try:
                    size: int | None = entry.stat(follow_symlinks=False).st_size
                except OSError:
                    size = None
                nodes.append(
                    {
                        "name": entry.name,
                        "path": entry_rel,
                        "type": "file",
                        "size": size,
                    }
                )
        return nodes

    return scan(workdir, "", 1)


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
        app.state.novae_project_store = ProjectStore(redis)
        try:
            await seed_default_users(app.state.novae_user_store)
            await seed_builtin_agent(app)
            for username in await app.state.novae_user_store.list_usernames():
                await seed_env_credential(app, username)
            yield
        finally:
            await redis.aclose()


def create_fastapi_app() -> FastAPI:
    async def runtime_env_agent_middlewares(
        user_id: str,
        agent_id: str,
        session_id: str,
    ) -> list:
        """Per-chat-run factory injecting runtime-env facts (OS + workdir).

        ``app`` is late-bound from the enclosing scope: the factory only
        runs at chat time, long after ``app`` (and ``app.state.storage``)
        exists. Resolves the session's ``config.workspace_id`` to the
        project workdir ``workspace_root/<user_id>/<workspace_id>`` —
        the same layout ProjectWorkspaceManager uses. Returns ``[]`` for
        unknown sessions or unsafe path components; never raises into the
        chat pipeline.
        """
        try:
            session = await app.state.storage.get_session(
                user_id, agent_id, session_id
            )
        except Exception:
            return []
        if session is None:
            return []
        workspace_id = getattr(session.config, "workspace_id", None)
        if (
            not workspace_id
            or not _SAFE_PATH_COMPONENT.match(user_id)
            or not _SAFE_PATH_COMPONENT.match(workspace_id)
        ):
            return []
        workdir = Path(cfg.workspace_root).resolve() / user_id / workspace_id
        return [RuntimeEnvMiddleware(str(workdir))]

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
        workspace_manager=ProjectWorkspaceManager(
            basedir=str(cfg.workspace_root),
        ),
        title="Novae",
        extra_agent_middlewares=runtime_env_agent_middlewares,
        extra_middlewares=[
            Middleware(EnvModelConfigMiddleware),
            Middleware(
                CORSMiddleware,
                allow_origins=["http://localhost:5173"],
                allow_credentials=True,
                allow_methods=["*"],
                allow_headers=["*"],
            ),
        ],
    )
    app.router.lifespan_context = novae_lifespan
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
        await seed_env_credential(app, record["username"])
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

    # ------------------------------------------------------------------
    # Project routes — user-scoped projects that bind an agent, a group
    # of sessions (via ``config.workspace_id``) and a working directory
    # under ``workspace_root/<user>/<project_id>``.
    # ------------------------------------------------------------------

    def _project_store() -> ProjectStore:
        return app.state.novae_project_store

    def _project_workdir(user_id: str, project_id: str) -> Path:
        """Resolve and jail-check a project's working directory."""
        base = Path(cfg.workspace_root).resolve()
        workdir = (base / user_id / project_id).resolve()
        if workdir != base and base not in workdir.parents:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid project workdir.",
            )
        return workdir

    async def _get_owned_project(user_id: str, project_id: str) -> dict:
        """Fetch a project or raise 404 when it isn't owned by the user."""
        if not _SAFE_PATH_COMPONENT.match(project_id):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id!r} not found.",
            )
        project = await _project_store().get(user_id, project_id)
        if project is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Project {project_id!r} not found.",
            )
        return project

    @app.get("/projects/")
    async def list_projects(user_id: str = Depends(_jwt_user_id)) -> dict:
        projects = await _project_store().list(user_id)
        return {"projects": projects, "total": len(projects)}

    @app.post("/projects/", status_code=status.HTTP_201_CREATED)
    async def create_project(
        body: CreateProjectRequest,
        user_id: str = Depends(_jwt_user_id),
    ) -> dict:
        name = body.name.strip()
        if not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Project name must not be empty.",
            )
        agent = await app.state.storage.get_agent(user_id, body.agent_id)
        if agent is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Agent {body.agent_id!r} not found.",
            )
        return await _project_store().create(
            user_id,
            name,
            body.description,
            body.agent_id,
        )

    @app.patch("/projects/{project_id}")
    async def update_project(
        project_id: str,
        body: UpdateProjectRequest,
        user_id: str = Depends(_jwt_user_id),
    ) -> dict:
        await _get_owned_project(user_id, project_id)
        name = body.name.strip() if body.name is not None else None
        if body.name is not None and not name:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Project name must not be empty.",
            )
        project = await _project_store().update(
            user_id,
            project_id,
            name=name,
            description=body.description,
        )
        return project

    @app.delete("/projects/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
    async def delete_project(
        project_id: str,
        user_id: str = Depends(_jwt_user_id),
        session_service: SessionService = Depends(get_session_service),
    ) -> None:
        """Delete a project, every session bound to it, and its workdir."""
        project = await _get_owned_project(user_id, project_id)
        agent_id = project["agent_id"]

        sessions = await app.state.storage.list_sessions(user_id, agent_id)
        for session in sessions:
            if session.config.workspace_id == project_id:
                await session_service.delete_session(user_id, agent_id, session.id)

        # Evict the cached workspace before dropping the directory so a
        # later get_workspace() cannot resurrect deleted state.
        await app.state.workspace_manager.close(project_id)
        await _project_store().delete(user_id, project_id)
        shutil.rmtree(
            _project_workdir(user_id, project_id),
            ignore_errors=True,
        )

    # ------------------------------------------------------------------
    # Shared file-browse helpers — parameterized by a jail base dir so
    # both the project files routes and the user workspace routes reuse
    # the exact same tree/jail/truncation/binary rules.
    # ------------------------------------------------------------------

    def _list_files(base: Path) -> dict:
        """Return the nested file tree under ``base`` (empty if missing)."""
        tree = _scan_project_tree(base) if base.is_dir() else []
        return {"tree": tree}

    def _read_file(base: Path, path: str) -> dict:
        """Return a UTF-8 text file under ``base`` (≤ 256KB, jail-checked)."""
        if not path or path.startswith(("/", "\\")) or re.match(r"^[a-zA-Z]:", path):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path must be relative to the file root.",
            )
        base_resolved = base.resolve()
        target = (base_resolved / path).resolve()
        if target == base_resolved or base_resolved not in target.parents:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Path escapes the file root.",
            )
        if not target.is_file():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"File {path!r} not found.",
            )

        with open(target, "rb") as f:
            raw = f.read(_FILE_CONTENT_LIMIT + 1)
        truncated = len(raw) > _FILE_CONTENT_LIMIT
        raw = raw[:_FILE_CONTENT_LIMIT]
        if b"\x00" in raw:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Binary files are not supported.",
            )
        try:
            content = raw.decode("utf-8")
        except UnicodeDecodeError:
            raise HTTPException(
                status_code=status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
                detail="Only UTF-8 text files are supported.",
            )
        return {"path": path, "content": content, "truncated": truncated}

    @app.get("/projects/{project_id}/files")
    async def list_project_files(
        project_id: str,
        user_id: str = Depends(_jwt_user_id),
    ) -> dict:
        """Return the nested file tree of the project's workdir."""
        await _get_owned_project(user_id, project_id)
        return _list_files(_project_workdir(user_id, project_id))

    @app.get("/projects/{project_id}/files/content")
    async def read_project_file(
        project_id: str,
        path: str = Query(description="POSIX path relative to the workdir."),
        user_id: str = Depends(_jwt_user_id),
    ) -> dict:
        """Return a UTF-8 text file from the project's workdir (≤ 256KB)."""
        await _get_owned_project(user_id, project_id)
        return _read_file(_project_workdir(user_id, project_id), path)

    # ------------------------------------------------------------------
    # User workspace routes — browse ``workspace_root/<user>/`` itself
    # (top level = one directory per project). JWT-only, no admin needed.
    # ------------------------------------------------------------------

    def _user_workdir(user_id: str) -> Path:
        """Resolve, jail-check and create the user's workspace root."""
        base = Path(cfg.workspace_root).resolve()
        workdir = (base / user_id).resolve()
        if workdir != base and base not in workdir.parents:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid user workdir.",
            )
        workdir.mkdir(parents=True, exist_ok=True)
        return workdir

    @app.get("/files/")
    async def list_user_files(user_id: str = Depends(_jwt_user_id)) -> dict:
        """Return the nested file tree of the caller's workspace root."""
        return _list_files(_user_workdir(user_id))

    @app.get("/files/content")
    async def read_user_file(
        path: str = Query(description="POSIX path relative to the workspace root."),
        user_id: str = Depends(_jwt_user_id),
    ) -> dict:
        """Return a UTF-8 text file from the caller's workspace root."""
        return _read_file(_user_workdir(user_id), path)

    # ------------------------------------------------------------------
    # User management routes — admin only. The role check reads the
    # caller's record from the user store (JWT sub → role == "admin").
    # ------------------------------------------------------------------

    async def _require_admin(user_id: str = Depends(_jwt_user_id)) -> str:
        record = await app.state.novae_user_store.get(user_id)
        if record is None or record.get("role") != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin privileges required.",
            )
        return user_id

    @app.get("/users/")
    async def list_users(_: str = Depends(_require_admin)) -> dict:
        """List every registered user as ``{username, role}`` (admin only)."""
        user_store: UserStore = app.state.novae_user_store
        users = []
        for username in await user_store.list_usernames():
            record = await user_store.get(username)
            if record is not None:
                users.append(
                    {"username": record["username"], "role": record["role"]}
                )
        users.sort(key=lambda u: u["username"])
        return {"users": users, "total": len(users)}

    @app.post("/users/", status_code=status.HTTP_201_CREATED)
    async def create_user(
        body: CreateUserRequest,
        _: str = Depends(_require_admin),
    ) -> dict:
        """Create a user (admin only) and seed its .env credential."""
        username = body.username.strip()
        if not _SAFE_PATH_COMPONENT.match(username):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Username may only contain letters, digits, '_' and '-'.",
            )
        if not body.password:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Password must not be empty.",
            )
        user_store: UserStore = app.state.novae_user_store
        if await user_store.get(username) is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"User {username!r} already exists.",
            )
        await user_store.upsert(username, body.password, body.role)
        await seed_env_credential(app, username)
        return {"username": username, "role": body.role}

    return app


app = create_fastapi_app()
