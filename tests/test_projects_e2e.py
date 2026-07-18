"""集成测试：/projects 路由端到端（登录 -> 建项目 -> 绑定会话 ->
文件树/内容 -> 级联删除）。"""
import json

from novae.config import get_config


def test_projects_end_to_end(client, admin_headers):
    workspaces = get_config().workspace_root

    # health
    r = client.get("/health")
    assert r.status_code == 200, r.text

    # 未登录 -> 401
    r = client.get("/projects/")
    assert r.status_code == 401, r.status_code

    # 空列表
    r = client.get("/projects/", headers=admin_headers)
    assert r.status_code == 200 and r.json()["projects"] == [], r.text

    # 播种的内置 agent
    r = client.get("/agent/", headers=admin_headers)
    assert r.status_code == 200, r.text
    agents = r.json()["agents"]
    assert agents, "应至少有播种的内置 agent"
    agent_id = agents[0]["id"]

    #  bogus agent -> 404
    r = client.post("/projects/", headers=admin_headers, json={"name": "x", "agent_id": "nope"})
    assert r.status_code == 404, r.status_code

    # 创建项目
    r = client.post(
        "/projects/",
        headers=admin_headers,
        json={"name": "测试项目", "description": "demo", "agent_id": agent_id},
    )
    assert r.status_code == 201, r.text
    pid = r.json()["id"]

    # 列表按 updated_at 倒序
    r = client.get("/projects/", headers=admin_headers)
    assert r.status_code == 200 and r.json()["total"] == 1

    # 改名
    r = client.patch(f"/projects/{pid}", headers=admin_headers, json={"name": "改名项目"})
    assert r.status_code == 200 and r.json()["name"] == "改名项目", r.text

    # 不存在的项目 -> 404
    r = client.patch("/projects/deadbeef", headers=admin_headers, json={"name": "x"})
    assert r.status_code == 404, r.status_code

    # 绑定项目的会话
    r = client.post(
        "/sessions/",
        headers=admin_headers,
        json={"agent_id": agent_id, "workspace_id": pid, "name": "项目会话"},
    )
    assert r.status_code == 201, r.text
    session_id = r.json()["session_id"]
    r = client.get("/sessions/", headers=admin_headers, params={"agent_id": agent_id})
    sess = [s for s in r.json()["sessions"] if s["session"]["id"] == session_id][0]
    assert sess["session"]["config"]["workspace_id"] == pid

    # 在项目工作目录里放置测试文件
    workdir = workspaces / "admin" / pid
    (workdir / "src").mkdir(parents=True, exist_ok=True)
    (workdir / "src" / "main.py").write_text("print('hello')\n", encoding="utf-8")
    (workdir / "note.md").write_text("# 笔记\n中文内容\n", encoding="utf-8")
    (workdir / "bin.dat").write_bytes(b"\x00\x01\x02")
    (workdir / ".git").mkdir(exist_ok=True)

    # 文件树
    r = client.get(f"/projects/{pid}/files", headers=admin_headers)
    assert r.status_code == 200, r.text
    names = [n["name"] for n in r.json()["tree"]]
    assert names == ["src", "bin.dat", "note.md"], json.dumps(r.json()["tree"], ensure_ascii=False)

    # 文件内容（含中文）
    r = client.get(
        f"/projects/{pid}/files/content", headers=admin_headers, params={"path": "note.md"}
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["content"].replace("\r\n", "\n") == "# 笔记\n中文内容\n"
    assert body["truncated"] is False

    # 嵌套文件
    r = client.get(
        f"/projects/{pid}/files/content",
        headers=admin_headers,
        params={"path": "src/main.py"},
    )
    assert r.status_code == 200 and "hello" in r.json()["content"]

    # 二进制 -> 415
    r = client.get(
        f"/projects/{pid}/files/content", headers=admin_headers, params={"path": "bin.dat"}
    )
    assert r.status_code == 415, r.status_code

    # 路径穿越 -> 400
    for bad in ("../server.py", "..\\..\\pyproject.toml", "/abs/path", "C:\\x"):
        r = client.get(
            f"/projects/{pid}/files/content", headers=admin_headers, params={"path": bad}
        )
        assert r.status_code == 400, (bad, r.status_code)

    # 缺失文件 -> 404
    r = client.get(
        f"/projects/{pid}/files/content", headers=admin_headers, params={"path": "nope.txt"}
    )
    assert r.status_code == 404, r.status_code

    # 删除项目：会话级联删除 + 工作目录移除
    r = client.delete(f"/projects/{pid}", headers=admin_headers)
    assert r.status_code == 204, r.status_code
    r = client.get("/sessions/", headers=admin_headers, params={"agent_id": agent_id})
    remaining = [s for s in r.json()["sessions"] if s["session"]["id"] == session_id]
    assert not remaining, "会话应被级联删除"
    assert not workdir.exists(), "工作目录应被移除"
    r = client.get("/projects/", headers=admin_headers)
    assert r.json()["total"] == 0
