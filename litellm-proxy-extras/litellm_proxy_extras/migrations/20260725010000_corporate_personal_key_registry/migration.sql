CREATE TABLE IF NOT EXISTS "CorporatePersonalKeyRegistry" (
    "user_id" TEXT NOT NULL,
    "logical_key_id" TEXT NOT NULL,
    "active_token_hash" TEXT,
    "generation" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "department_team_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CorporatePersonalKeyRegistry_pkey" PRIMARY KEY ("user_id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CorporatePersonalKeyRegistry_logical_key_id_key"
ON "CorporatePersonalKeyRegistry"("logical_key_id");

CREATE INDEX IF NOT EXISTS "CorporatePersonalKeyRegistry_active_token_hash_idx"
ON "CorporatePersonalKeyRegistry"("active_token_hash");

CREATE INDEX IF NOT EXISTS "CorporatePersonalKeyRegistry_organization_id_idx"
ON "CorporatePersonalKeyRegistry"("organization_id");
