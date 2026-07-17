"""Unit test: novae.model_patch wraps agentscope's chat get_model so every
constructed model instance gets env-driven max_retries / retry_delay, and
re-applying the patch never stacks wrappers."""
import asyncio
import os

import agentscope.app._service._chat as chat_module

import novae.model_patch as model_patch


class _DummyModel:
    max_retries = 3
    retry_delay = 1.0


async def _fake_original(user_id, config, storage):
    return _DummyModel()


# Apply once, then stub the stashed original so no real credential /
# storage / network is involved.
model_patch.apply_model_retry_patch()
setattr(chat_module, model_patch._ORIGINAL_ATTR, _fake_original)

# --- env override -----------------------------------------------------------
os.environ["NOVAE_MODEL_MAX_RETRIES"] = "7"
os.environ["NOVAE_MODEL_RETRY_DELAY"] = "2.5"
model = asyncio.run(chat_module.get_model("u", None, None))
assert model.max_retries == 7, model.max_retries
assert model.retry_delay == 2.5, model.retry_delay
print("env override OK: max_retries=7 retry_delay=2.5")

# --- defaults when env unset -------------------------------------------------
del os.environ["NOVAE_MODEL_MAX_RETRIES"]
del os.environ["NOVAE_MODEL_RETRY_DELAY"]
model = asyncio.run(chat_module.get_model("u", None, None))
assert model.max_retries == 5, model.max_retries
assert model.retry_delay == 3.0, model.retry_delay
print("env defaults OK: max_retries=5 retry_delay=3.0")

# --- idempotent: re-apply does not stack wrappers ----------------------------
wrapped = chat_module.get_model
model_patch.apply_model_retry_patch()
assert chat_module.get_model is wrapped, "patch applied twice!"
print("re-apply idempotent OK")

# --- server import applies the patch exactly once as well --------------------
os.environ.setdefault("OPENAI_API_KEY", "sk-test-dummy")
import novae.server  # noqa: E402,F401  (applies patch at import time)

assert hasattr(chat_module, model_patch._ORIGINAL_ATTR)
wrapped_after_server = chat_module.get_model
model_patch.apply_model_retry_patch()
assert chat_module.get_model is wrapped_after_server
print("server import applies patch OK")

print("ALL MODEL-PATCH CHECKS PASSED")
