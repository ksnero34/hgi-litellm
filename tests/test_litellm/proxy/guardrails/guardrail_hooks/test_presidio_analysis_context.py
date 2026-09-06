import asyncio
from types import SimpleNamespace

import pytest

from litellm.proxy._types import UserAPIKeyAuth
from litellm.proxy.guardrails.guardrail_hooks.presidio_analysis_context import (
    analysis_request_scope,
    current_analysis_context,
)


@pytest.mark.asyncio
async def test_scope_shares_across_tasks_and_clears_on_failure():
    retained = None
    async def exercise():
        nonlocal retained
        with analysis_request_scope(tenant_scope="team:synthetic-a") as outer:
            retained = outer
            outer.results["synthetic-key"] = []

            async def check_nested():
                with analysis_request_scope() as inner:
                    assert inner is outer
                    assert inner.semaphore is outer.semaphore
                    assert inner.results["synthetic-key"] == []

            await asyncio.gather(check_nested(), check_nested())
            raise RuntimeError("synthetic failure")

    with pytest.raises(RuntimeError, match="synthetic failure"):
        await exercise()
    assert current_analysis_context() is None
    assert retained.results == {}
    assert retained.pending == {}
    assert retained.tenant_scope is None


@pytest.mark.asyncio
async def test_concurrent_requests_and_forced_scope_do_not_share_state():
    ready = asyncio.Event()
    contexts = []

    async def request(tenant):
        with analysis_request_scope(tenant_scope=tenant, force_new=True) as ctx:
            contexts.append(ctx)
            if len(contexts) == 2:
                ready.set()
            await ready.wait()
            assert current_analysis_context() is ctx
            assert ctx.tenant_scope == tenant
            with analysis_request_scope(tenant_scope="team:nested", force_new=True) as inner:
                assert inner is not ctx
            assert current_analysis_context() is ctx

    await asyncio.wait_for(asyncio.gather(request("team:a"), request("team:b")), timeout=1)
    assert contexts[0] is not contexts[1]
    assert current_analysis_context() is None


@pytest.mark.asyncio
async def test_deadline_includes_elapsed_pre_call_time(monkeypatch):
    monkeypatch.setenv("PRESIDIO_PRE_CALL_TIMEOUT_SECONDS", "0.01")
    with analysis_request_scope() as ctx:
        await asyncio.sleep(0.02)
        assert ctx.remaining() == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("value", ["nan", "inf", "-1", "0", "bad"])
async def test_invalid_deadline_configuration_remains_bounded(monkeypatch, value):
    monkeypatch.setenv("PRESIDIO_PRE_CALL_TIMEOUT_SECONDS", value)
    with analysis_request_scope() as ctx:
        assert 29 < ctx.remaining() <= 30


@pytest.mark.asyncio
async def test_proxy_boundary_uses_authenticated_team_and_resets_context():
    from litellm.proxy.utils import ProxyLogging

    class InspectingProxyLogging(ProxyLogging):
        def __init__(self):
            self.internal_usage_cache = SimpleNamespace(dual_cache=SimpleNamespace(redis_cache=None))
            self.scopes = []

        async def _pre_call_hook_impl(self, user_api_key_dict, data, call_type, guardrails_only=False):
            ctx = current_analysis_context()
            assert ctx is not None
            self.scopes.append(ctx.tenant_scope)
            return data

    proxy = InspectingProxyLogging()
    spoofed = {"metadata": {"tenant": "spoofed"}, "litellm_metadata": {"user_api_key_team_id": "spoofed"}}
    await proxy.pre_call_hook(UserAPIKeyAuth(team_id="trusted"), spoofed, "acompletion")
    await proxy.pre_call_hook(UserAPIKeyAuth(), spoofed, "acompletion")
    assert proxy.scopes == ["team:trusted", None]
    assert current_analysis_context() is None


@pytest.mark.asyncio
async def test_actual_unified_responses_shares_scope_across_copied_history_and_instructions():
    from litellm.caching.caching import DualCache
    from litellm.integrations.custom_guardrail import CustomGuardrail
    from litellm.proxy.guardrails.guardrail_hooks.unified_guardrail.unified_guardrail import UnifiedLLMGuardrails
    from litellm.proxy.utils import ProxyLogging

    class ScopeInspectingGuardrail(CustomGuardrail):
        requires_guardrailed_previous_response_history = True
        records_own_guardrail_information = True

        def __init__(self):
            super().__init__(guardrail_name="synthetic-scope", default_on=True, event_hook="pre_call")
            self.observed = []

        async def apply_guardrail(self, inputs, request_data, input_type, logging_obj=None):
            context = current_analysis_context()
            assert context is not None
            assert context.tenant_scope == "team:trusted"
            self.observed.append((context, id(request_data), tuple(inputs["texts"])))
            context.results.setdefault("same-synthetic-fragment", [])
            return inputs

    class UnifiedProxy(ProxyLogging):
        def __init__(self):
            self.internal_usage_cache = SimpleNamespace(dual_cache=SimpleNamespace(redis_cache=None))

        async def _pre_call_hook_impl(self, user_api_key_dict, data, call_type, guardrails_only=False):
            return await UnifiedLLMGuardrails().async_pre_call_hook(
                user_api_key_dict=user_api_key_dict,
                cache=DualCache(),
                data=data,
                call_type=call_type,
            )

    guardrail = ScopeInspectingGuardrail()
    data = {
        "model": "synthetic-model",
        "guardrail_to_apply": guardrail,
        "previous_response_id": "resp_synthetic",
        "instructions": "same synthetic fragment",
        "input": "same synthetic fragment",
        "metadata": {"tenant": "spoofed"},
        "litellm_metadata": {"user_api_key_team_id": "spoofed"},
        "litellm_logging_obj": SimpleNamespace(
            _guardrail_previous_response_id="resp_synthetic",
            _guardrail_previous_response_messages=[{"role": "user", "content": "same synthetic fragment"}],
        ),
    }
    result = await UnifiedProxy().pre_call_hook(UserAPIKeyAuth(team_id="trusted"), data, "aresponses")
    assert result is data
    assert len(guardrail.observed) == 3
    assert all(item[0] is guardrail.observed[0][0] for item in guardrail.observed)
    assert guardrail.observed[0][1] != id(data)
    assert all(item[1] == id(data) for item in guardrail.observed[1:])
    assert all(item[2] == ("same synthetic fragment",) for item in guardrail.observed)
    assert guardrail.observed[0][0].results == {}
    assert current_analysis_context() is None
