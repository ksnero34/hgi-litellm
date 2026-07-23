import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from litellm.proxy.guardrails.usage_tracking import process_spend_logs_guardrail_usage


@pytest.mark.asyncio
async def test_process_spend_logs_tracks_each_policy_once_and_prefers_usage_action():
    daily_guardrail = SimpleNamespace(upsert=AsyncMock())
    daily_policy = SimpleNamespace(upsert=AsyncMock())
    guardrail_index = SimpleNamespace(create_many=AsyncMock())
    policy_index = SimpleNamespace(create_many=AsyncMock())
    prisma_client = SimpleNamespace(
        db=SimpleNamespace(
            litellm_dailyguardrailmetrics=daily_guardrail,
            litellm_dailypolicymetrics=daily_policy,
            litellm_spendlogguardrailindex=guardrail_index,
            litellm_spendlogpolicyindex=policy_index,
        )
    )
    metadata = {
        "applied_policies": ["alpha", "beta"],
        "policy_information": [
            {"policy_name": "alpha", "policy_id": "policy-a", "source": "request"},
            {"policy_name": "beta", "policy_id": "policy-b", "source": "team_metadata"},
        ],
        "guardrail_information": [
            {
                "guardrail_name": "guard-a",
                "guardrail_status": "guardrail_intervened",
                "usage_action": "passed",
                "policy_ids": ["policy-a", "policy-b"],
            },
            {
                "guardrail_name": "guard-b",
                "guardrail_status": "success",
                "usage_action": "flagged",
                "policy_ids": ["policy-b"],
            },
            {
                "guardrail_name": "guard-config",
                "guardrail_status": "success",
                "policy_name": "config-policy",
                "policy_names": ["config-policy"],
            },
        ],
    }
    log = {
        "request_id": "request-1",
        "startTime": datetime(2026, 7, 23, tzinfo=timezone.utc),
        "metadata": json.dumps(metadata),
    }

    await process_spend_logs_guardrail_usage(prisma_client, [log, log])

    policy_index.create_many.assert_awaited_once()
    guardrail_index.create_many.assert_awaited_once()
    guardrail_index_data = guardrail_index.create_many.await_args.kwargs["data"]
    assert guardrail_index_data[0]["policy_id"] == "policy-a"
    assert (
        next(row for row in guardrail_index_data if row["guardrail_id"] == "guard-config")["policy_id"]
        == "config-policy"
    )
    assert policy_index.create_many.await_args.kwargs["data"] == [
        {
            "request_id": "request-1",
            "policy_id": "policy-a",
            "start_time": log["startTime"],
        },
        {
            "request_id": "request-1",
            "policy_id": "policy-b",
            "start_time": log["startTime"],
        },
    ]
    assert daily_policy.upsert.await_count == 2
    creates = {
        call.kwargs["data"]["create"]["policy_id"]: call.kwargs["data"]["create"]
        for call in daily_policy.upsert.await_args_list
    }
    assert creates["policy-a"]["passed_count"] == 1
    assert creates["policy-a"]["blocked_count"] == 0
    assert creates["policy-b"]["flagged_count"] == 1
    assert creates["policy-b"]["requests_evaluated"] == 1
