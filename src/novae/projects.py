"""Redis-backed per-user project registry for Novae.

A project binds a name/description to one agent and owns a working
directory (``workspace_root/<user>/<project_id>``). Sessions reference
their project through ``SessionRecord.config.workspace_id == project_id``.

Projects are stored in Redis under ``novae:project:{user}:{project_id}``
as a JSON blob; the set ``novae:projects:{user}`` indexes all project ids
of a user.
"""
import json
import uuid
from datetime import datetime, timezone

from redis.asyncio import Redis


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ProjectStore:
    """Redis-backed project store, scoped per user."""

    KEY_PREFIX = "novae:project:"
    SET_PREFIX = "novae:projects:"

    def __init__(self, client: Redis) -> None:
        self._client = client

    @classmethod
    def _key(cls, user: str, project_id: str) -> str:
        return f"{cls.KEY_PREFIX}{user}:{project_id}"

    @classmethod
    def _set_key(cls, user: str) -> str:
        return f"{cls.SET_PREFIX}{user}"

    async def list(self, user: str) -> list[dict]:
        """Return all projects of a user, newest-updated first."""
        project_ids = await self._client.smembers(self._set_key(user))
        projects = []
        for project_id in project_ids:
            raw = await self._client.get(self._key(user, project_id))
            if raw is not None:
                projects.append(json.loads(raw))
        projects.sort(key=lambda p: p["updated_at"], reverse=True)
        return projects

    async def get(self, user: str, project_id: str) -> dict | None:
        raw = await self._client.get(self._key(user, project_id))
        if raw is None:
            return None
        return json.loads(raw)

    async def create(
        self,
        user: str,
        name: str,
        description: str,
        agent_id: str,
    ) -> dict:
        project_id = uuid.uuid4().hex
        now = _now_iso()
        record = {
            "id": project_id,
            "name": name,
            "description": description,
            "agent_id": agent_id,
            "created_at": now,
            "updated_at": now,
        }
        await self._client.set(self._key(user, project_id), json.dumps(record))
        await self._client.sadd(self._set_key(user), project_id)
        return record

    async def update(
        self,
        user: str,
        project_id: str,
        *,
        name: str | None = None,
        description: str | None = None,
    ) -> dict | None:
        record = await self.get(user, project_id)
        if record is None:
            return None
        if name is not None:
            record["name"] = name
        if description is not None:
            record["description"] = description
        record["updated_at"] = _now_iso()
        await self._client.set(self._key(user, project_id), json.dumps(record))
        return record

    async def delete(self, user: str, project_id: str) -> bool:
        removed = await self._client.delete(self._key(user, project_id))
        await self._client.srem(self._set_key(user), project_id)
        return removed > 0
