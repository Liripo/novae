"""pytest 公共夹具。

共享逻辑（原 scripts/test_*.py 各文件重复的模板）：
- 导入 novae.server 之前注入 dummy 环境变量（.env 缺省时兜底）；
- 用 fakeredis 替换 redis.asyncio.Redis 与 novae.server.AsyncRedis，
  每个测试函数一个全新 FakeServer，互不污染；
- TestClient 上下文管理器触发应用 lifespan（播种 admin / 内置 agent）；
- admin_headers 提供已登录的管理员请求头。
"""
import os

# 必须在导入 novae.server 之前注入
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy")
os.environ.setdefault("OPENAI_BASE_URL", "https://api.example.com/v1")
os.environ.setdefault("NOVAE_MODEL", "env-test-model")

import fakeredis
import fakeredis.aioredis
import pytest
import redis.asyncio as aioredis
from fastapi.testclient import TestClient

import novae.server as server_module


def _make_fake_redis_factory(server):
    """构造绑定指定 FakeServer 的 Redis 工厂（丢弃真实连接参数）。"""

    def _factory(*args, **kwargs):
        kwargs.pop("connection_pool", None)
        for k in ("host", "port", "db", "password"):
            kwargs.pop(k, None)
        kwargs["decode_responses"] = True
        return fakeredis.aioredis.FakeRedis(server=server, **kwargs)

    return _factory


@pytest.fixture()
def app():
    """全新 fakeredis + 应用实例（函数级隔离）。"""
    factory = _make_fake_redis_factory(fakeredis.FakeServer())
    aioredis.Redis = factory
    server_module.AsyncRedis = factory
    return server_module.create_fastapi_app()


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def admin_headers(client):
    """登录 admin（同时触发 env 凭证与内置 agent 播种），返回请求头。"""
    r = client.post("/auth/login", json={"username": "admin", "password": "admin"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture(autouse=True)
def _cleanup_test_workdirs():
    """测试后清理会话/定时任务创建的工作目录（data/workspaces/admin/w*）。"""
    yield
    import shutil
    from pathlib import Path

    root = Path(server_module.cfg.workspace_root)
    for wid in ("w1", "w2", "w3"):
        shutil.rmtree(root / "admin" / wid, ignore_errors=True)
