"""Redis-backed user accounts and JWT authentication for Novae.

Users are stored in Redis under ``novae:user:{username}`` as a JSON blob
with ``username``, ``password_hash``, ``salt`` and ``role``. Passwords are
hashed with PBKDF2-HMAC-SHA256 (stdlib only, no native build deps).
"""
import hashlib
import json
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from redis.asyncio import Redis

from novae.config import Config


Role = Literal["user", "admin"]

# Seed users created on first startup. Extend this list to add more
# built-in accounts (e.g. an admin). Runtime user management via API
# can be layered on top of `UserStore` later.
DEFAULT_USERS: tuple[tuple[str, str, Role], ...] = (
    ("admin", "admin", "admin"),
)


@dataclass
class User:
    username: str
    role: Role


def _hash_password(password: str, salt: bytes) -> str:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return salt.hex() + ":" + digest.hex()


def _verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, digest_hex = stored.split(":", 1)
    except ValueError:
        return False
    salt = bytes.fromhex(salt_hex)
    expected = _hash_password(password, salt)
    return secrets.compare_digest(expected, stored)


class UserStore:
    """Redis-backed user account store."""

    KEY_PREFIX = "novae:user:"

    def __init__(self, client: Redis) -> None:
        self._client = client

    @classmethod
    def _key(cls, username: str) -> str:
        return f"{cls.KEY_PREFIX}{username}"

    async def get(self, username: str) -> dict | None:
        raw = await self._client.get(self._key(username))
        if raw is None:
            return None
        return json.loads(raw)

    async def upsert(self, username: str, password: str, role: Role) -> None:
        # 已存在用户保留原创建时间（upsert 也用于重置密码）
        existing = await self.get(username)
        created_at = (existing or {}).get("created_at") or datetime.now(
            timezone.utc
        ).isoformat()
        salt = secrets.token_bytes(16)
        record = {
            "username": username,
            "password_hash": _hash_password(password, salt),
            "role": role,
            "created_at": created_at,
        }
        await self._client.set(self._key(username), json.dumps(record))

    async def delete(self, username: str) -> bool:
        """删除用户记录，返回是否真的删掉了（不存在则 False）。"""
        return bool(await self._client.delete(self._key(username)))

    async def list_usernames(self) -> list[str]:
        """返回所有已注册用户的用户名列表。"""
        usernames = []
        cursor = 0
        while True:
            cursor, keys = await self._client.scan(
                cursor, match=f"{self.KEY_PREFIX}*"
            )
            for key in keys:
                usernames.append(key.removeprefix(self.KEY_PREFIX))
            if cursor == 0:
                break
        return usernames

    async def authenticate(self, username: str, password: str) -> dict | None:
        record = await self.get(username)
        if record is None:
            return None
        if not _verify_password(password, record["password_hash"]):
            return None
        return record


def create_token(cfg: Config, username: str, role: Role) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": username,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(hours=cfg.jwt_expire_hours)).timestamp()),
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm="HS256")


def decode_token(cfg: Config, token: str) -> dict:
    return jwt.decode(token, cfg.jwt_secret, algorithms=["HS256"])


async def seed_default_users(store: UserStore) -> None:
    """Ensure built-in users exist (idempotent — preserves existing passwords)."""
    for username, password, role in DEFAULT_USERS:
        if await store.get(username) is None:
            await store.upsert(username, password, role)
