"""Create or update a Novae user in Redis.

Usage:
    uv run python scripts/create_user.py <username> <password> [user|admin]

If the user already exists, its password and role are updated in place.
"""
import argparse
import asyncio
import sys

from redis.asyncio import Redis as AsyncRedis

from novae.auth import Role, UserStore
from novae.config import get_config

VALID_ROLES: tuple[str, ...] = ("user", "admin")


async def main(username: str, password: str, role: Role) -> int:
    cfg = get_config()
    redis = AsyncRedis(
        host=cfg.redis_host,
        port=cfg.redis_port,
        db=cfg.redis_db,
        password=cfg.redis_password,
        decode_responses=True,
    )
    try:
        store = UserStore(redis)
        existed = await store.get(username)
        await store.upsert(username, password, role)
        action = "Updated" if existed else "Created"
        print(f"{action} user {username!r} (role={role}).")
        return 0
    finally:
        await redis.aclose()


def cli() -> int:
    parser = argparse.ArgumentParser(description="Create or update a Novae user.")
    parser.add_argument("username", help="Username (unique key).")
    parser.add_argument("password", help="Password (plaintext; hashed before storage).")
    parser.add_argument(
        "role",
        nargs="?",
        default="user",
        choices=VALID_ROLES,
        help="Role (default: user).",
    )
    args = parser.parse_args()
    return asyncio.run(main(args.username, args.password, args.role))


if __name__ == "__main__":
    sys.exit(cli())
