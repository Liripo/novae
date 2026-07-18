"""单元测试：novae.model_patch 包装 agentscope 的 get_model，
为每个模型实例注入 env 驱动的 max_retries / retry_delay，
重复应用不会叠加包装器。"""
import asyncio

import agentscope.app._service._chat as chat_module

import novae.model_patch as model_patch


class _DummyModel:
    max_retries = 3
    retry_delay = 1.0


async def _fake_original(user_id, config, storage):
    return _DummyModel()


def _stub_original():
    """应用补丁并把stash的原始函数替换为假实现（不涉及真实凭证/网络）。"""
    model_patch.apply_model_retry_patch()
    setattr(chat_module, model_patch._ORIGINAL_ATTR, _fake_original)


def test_env_override(monkeypatch):
    _stub_original()
    monkeypatch.setenv("NOVAE_MODEL_MAX_RETRIES", "7")
    monkeypatch.setenv("NOVAE_MODEL_RETRY_DELAY", "2.5")
    model = asyncio.run(chat_module.get_model("u", None, None))
    assert model.max_retries == 7, model.max_retries
    assert model.retry_delay == 2.5, model.retry_delay


def test_env_defaults(monkeypatch):
    _stub_original()
    monkeypatch.delenv("NOVAE_MODEL_MAX_RETRIES", raising=False)
    monkeypatch.delenv("NOVAE_MODEL_RETRY_DELAY", raising=False)
    model = asyncio.run(chat_module.get_model("u", None, None))
    assert model.max_retries == 5, model.max_retries
    assert model.retry_delay == 3.0, model.retry_delay


def test_reapply_is_idempotent():
    model_patch.apply_model_retry_patch()
    wrapped = chat_module.get_model
    model_patch.apply_model_retry_patch()
    assert chat_module.get_model is wrapped, "补丁被重复叠加"


def test_server_import_applies_patch_once():
    # conftest 已导入 novae.server（导入时应用补丁）
    assert hasattr(chat_module, model_patch._ORIGINAL_ATTR)
    wrapped = chat_module.get_model
    model_patch.apply_model_retry_patch()
    assert chat_module.get_model is wrapped
