import json
from datetime import datetime, timezone
from types import SimpleNamespace

from litellm.proxy.guardrails.usage_endpoints import (
    _build_policy_usage_logs_where,
    _policy_overview_rows,
    _policy_usage_log_entry_from_row,
)


def test_policy_log_entry_selects_requested_policy_from_shared_request():
    spend_log = SimpleNamespace(
        request_id="request-1",
        startTime=datetime(2026, 7, 23, tzinfo=timezone.utc),
        metadata=json.dumps(
            {
                "policy_information": [
                    {"policy_name": "alpha", "policy_id": "policy-a"},
                    {"policy_name": "beta", "policy_id": "policy-b"},
                ],
                "guardrail_information": [
                    {
                        "guardrail_name": "guard-a",
                        "policy_ids": ["policy-a"],
                        "guardrail_status": "guardrail_intervened",
                    },
                    {
                        "guardrail_name": "guard-b",
                        "policy_ids": ["policy-b"],
                        "guardrail_status": "guardrail_intervened",
                        "usage_action": "passed",
                    },
                ],
            }
        ),
        model="model",
        messages={},
        response={},
        proxy_server_request=None,
    )

    alpha = _policy_usage_log_entry_from_row(
        SimpleNamespace(request_id="request-1", policy_id="policy-a"), spend_log, None
    )
    beta = _policy_usage_log_entry_from_row(
        SimpleNamespace(request_id="request-1", policy_id="policy-b"), spend_log, None
    )

    assert alpha is not None and alpha.action == "blocked"
    assert beta is not None and beta.action == "passed"


def test_build_policy_usage_logs_where_targets_policy_index():
    where = _build_policy_usage_logs_where("policy-a", "2026-07-01", "2026-07-31")

    assert where["policy_id"] == "policy-a"
    assert where["start_time"]["gte"].isoformat() == "2026-07-01T00:00:00+00:00"
    assert where["start_time"]["lte"].isoformat() == "2026-07-31T23:59:59+00:00"


def test_policy_overview_includes_config_policy_metrics_without_db_row():
    rows = _policy_overview_rows(
        policies=[],
        agg={"config-policy": {"requests": 2, "passed": 1, "blocked": 1, "flagged": 0}},
        prev_agg={},
    )

    assert len(rows) == 1
    assert rows[0].id == "config-policy"
    assert rows[0].provider == "Config"
    assert rows[0].requestsEvaluated == 2
    assert rows[0].failRate == 50.0
