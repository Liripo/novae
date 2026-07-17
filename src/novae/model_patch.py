"""Env-configurable retry policy for chat models (rate-limit friendly).

``agentscope.app._service._chat`` builds chat models via its module-level
``get_model`` import. The model's retry loop reads the *instance*
attributes ``max_retries`` (default 3) and ``retry_delay`` (default 1.0s)
at run time, so wrapping ``get_model`` and setting those attributes on
every constructed instance retunes retries centrally — no agentscope
code changes.

The defaults here (5 attempts, 3s delay) target free-tier models that
answer 429 often; both are overridable via ``NOVAE_MODEL_MAX_RETRIES``
and ``NOVAE_MODEL_RETRY_DELAY`` and are re-read on every model build.
"""
import os

import agentscope.app._service._chat as _chat_module

# Attribute under which the unwrapped ``get_model`` is stashed on the
# chat module. Doubles as the "already patched" sentinel so repeated
# imports never stack wrappers.
_ORIGINAL_ATTR = "_novae_original_get_model"


def apply_model_retry_patch() -> None:
    """Wrap ``agentscope.app._service._chat.get_model`` exactly once."""
    if hasattr(_chat_module, _ORIGINAL_ATTR):
        return
    setattr(_chat_module, _ORIGINAL_ATTR, _chat_module.get_model)

    async def get_model_with_retry(user_id, config, storage):
        # Resolve the original at call time so tests can stub the
        # sentinel attribute without re-applying the patch.
        original = getattr(_chat_module, _ORIGINAL_ATTR)
        model = await original(user_id, config, storage)
        model.max_retries = int(os.getenv("NOVAE_MODEL_MAX_RETRIES", "5"))
        model.retry_delay = float(os.getenv("NOVAE_MODEL_RETRY_DELAY", "3"))
        return model

    _chat_module.get_model = get_model_with_retry
