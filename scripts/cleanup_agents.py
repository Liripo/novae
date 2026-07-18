"""一次性运维脚本：列出所有用户的 agent，并删除除 bio 以外的全部。

平台只保留一个通用生信 Agent（bio）。旧版本播种/创建的 agent
（flow、scrna、rnaseq、bioflow、novae、novae_optimizer 等）会残留在
Redis 中并显示在新建项目的下拉菜单里，本脚本直接清理。
删除会级联清理其会话与定时任务（同 storage.delete_agent 语义）。

用法：uv run python scripts/cleanup_agents.py
"""
import asyncio

from redis.asyncio import Redis

from agentscope.app.storage import RedisStorage
from novae.accounts import UserStore
from novae.config import get_config

KEEP_ID = "bio"


async def main() -> None:
    cfg = get_config()
    kwargs = {
        "host": cfg.redis_host,
        "port": cfg.redis_port,
        "db": cfg.redis_db,
        "password": cfg.redis_password,
    }
    redis = Redis(decode_responses=True, **kwargs)
    storage = RedisStorage(**kwargs)

    usernames = await UserStore(redis).list_usernames()
    if not usernames:
        print("未发现任何用户")
    async with storage:
        for username in usernames:
            agents = await storage.list_agents(username)
            if not agents:
                print(f"user={username}: 无 agent")
                continue
            for record in agents:
                keep = record.id == KEEP_ID
                print(f"[{'保留' if keep else '删除'}] user={username} id={record.id} name={record.data.name}")
                if not keep:
                    await storage.delete_agent(username, record.id)
    await redis.aclose()
    print("清理完成")


if __name__ == "__main__":
    asyncio.run(main())
