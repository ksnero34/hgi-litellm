CREATE TABLE IF NOT EXISTS "LiteLLM_SpendLogPolicyIndex" (
    "request_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "start_time" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiteLLM_SpendLogPolicyIndex_pkey" PRIMARY KEY ("request_id","policy_id")
);

CREATE INDEX IF NOT EXISTS "LiteLLM_SpendLogPolicyIndex_policy_id_start_time_idx" ON "LiteLLM_SpendLogPolicyIndex"("policy_id", "start_time");
