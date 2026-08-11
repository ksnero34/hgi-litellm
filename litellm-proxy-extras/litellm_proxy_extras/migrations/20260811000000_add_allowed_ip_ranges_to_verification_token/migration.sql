ALTER TABLE "LiteLLM_VerificationToken"
ADD COLUMN IF NOT EXISTS "allowed_ip_ranges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "LiteLLM_DeletedVerificationToken"
ADD COLUMN IF NOT EXISTS "allowed_ip_ranges" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
