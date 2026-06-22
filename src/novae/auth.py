"""JWT authentication and Redis-backed user accounts for Novae.

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
from fastapi import Header, HTTPException, status
from redis.asyncio import Redis

from novae.config import Config


Role = Literal["user", "admin"]

# Seed users created on first startup. Extend this list to add more
# built-in accounts (e.g. an admin). Runtime user management via API
# can be layered on top of `UserStore` later.
DEFAULT_USERS: tuple[tuple[str, str, Role], ...] = (
    ("liripo", "liripo", "user"),
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
        salt = secrets.token_bytes(16)
        record = {
            "username": username,
            "password_hash": _hash_password(password, salt),
            "role": role,
        }
        await self._client.set(self._key(username), json.dumps(record))

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


async def get_current_user_id(
    cfg: Config,
    authorization: str = Header(default=""),
) -> str:
    """FastAPI dependency: validate the Bearer JWT and return the username."""
    if not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing bearer token.",
        )
    token = authorization.removeprefix("Bearer ").strip()
    try:
        payload = decode_token(cfg, token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token.",
        )
    username = payload.get("sub")
    if not username:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload.",
        )
    return username


async def seed_default_users(store: UserStore) -> None:
    """Ensure built-in users exist (idempotent — preserves existing passwords)."""
    for username, password, role in DEFAULT_USERS:
        if await store.get(username) is None:
            await store.upsert(username, password, role)
