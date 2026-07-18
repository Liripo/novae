"""集成测试：用户工作目录文件浏览路由。

GET /files/ 返回 ``workspace_root/<user>/`` 的目录树（缺省自动创建），
嵌套文件内容读取、路径穿越 -> 400、二进制 -> 415、缺失 -> 404。
"""
import shutil
from pathlib import Path

import pytest

import novae.server as server_module


@pytest.fixture()
def user_tree():
    """在 admin 工作区根下放置测试目录树，测试后清理。"""
    user_root = Path(server_module.cfg.workspace_root).resolve() / "admin"
    nested = user_root / "proj1" / "results" / "tables"
    nested.mkdir(parents=True, exist_ok=True)
    (nested / "degs.tsv").write_text("gene\tlog2fc\nTP53\t2.1\n", encoding="utf-8")
    (user_root / "proj1" / "raw.bin").write_bytes(b"\x00\x01\x02")
    yield user_root
    shutil.rmtree(user_root / "proj1", ignore_errors=True)


def test_files_requires_auth(client):
    r = client.get("/files/")
    assert r.status_code == 401, r.status_code


def test_workspace_tree_contains_project_dir(client, admin_headers, user_tree):
    r = client.get("/files/", headers=admin_headers)
    assert r.status_code == 200, r.text
    top = {n["name"]: n for n in r.json()["tree"]}
    assert "proj1" in top and top["proj1"]["type"] == "dir", r.json()["tree"]


def test_nested_file_content(client, admin_headers, user_tree):
    r = client.get(
        "/files/content",
        headers=admin_headers,
        params={"path": "proj1/results/tables/degs.tsv"},
    )
    assert r.status_code == 200, r.text
    assert "TP53" in r.json()["content"], r.json()
    assert r.json()["truncated"] is False, r.json()


def test_path_traversal_rejected(client, admin_headers, user_tree):
    r = client.get("/files/content", headers=admin_headers, params={"path": "../secret.txt"})
    assert r.status_code == 400, r.status_code
    r = client.get(
        "/files/content", headers=admin_headers, params={"path": "C:/Windows/win.ini"}
    )
    assert r.status_code == 400, r.status_code


def test_binary_file_rejected(client, admin_headers, user_tree):
    r = client.get("/files/content", headers=admin_headers, params={"path": "proj1/raw.bin"})
    assert r.status_code == 415, r.status_code


def test_missing_file_404(client, admin_headers, user_tree):
    r = client.get("/files/content", headers=admin_headers, params={"path": "proj1/nope.txt"})
    assert r.status_code == 404, r.status_code
