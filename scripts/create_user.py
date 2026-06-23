import asyncio

from typer import Argument, Typer

from redis.asyncio import Redis as AsyncRedis

from novae.accounts import Role, UserStore
from novae.config import get_config

app = Typer()


@app.command()
def create_user(
    username: str = Argument(..., help="用户名"),
    password: str = Argument(..., help="密码（明文，存储前会哈希）"),
    role: Role = Argument("user", help="角色"),
) -> None:
    """创建或更新 Novae 用户。"""
    cfg = get_config()

    async def _run() -> None:
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
        finally:
            await redis.aclose()

    asyncio.run(_run())


if __name__ == "__main__":
    app()
