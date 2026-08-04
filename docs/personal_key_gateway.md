# Personal key gateway

## Required configuration

```text
GENERIC_USER_ID_ATTRIBUTE=sub
HUMAN_ORGANIZATION_ID=human-default
PERSONAL_KEY_DURATION=90d
PERSONAL_KEY_ROTATION_GRACE_PERIOD=72h
```

Configure Generic OIDC Team mapping so `team_ids_jwt_field` points to `user_orgnm`. The claim must resolve to exactly one
department. The immutable OIDC `sub` becomes `sso_user_id`; email is a mutable profile attribute.

Users may retain manually managed project Team memberships, but personal-key authorization selects exactly one OIDC
department Team. Project Teams are not unioned into the key's model or MCP scope.

The SSO callback creates the Human Organization and its budget row if they do not exist. Administrators then set the
Organization TPM/RPM through the existing Organization management API or UI. Every OIDC department Team is attached to
that Organization.

The Organization endpoint, models, and migrations used here are all outside `enterprise/` and have no backend premium
check in this fork. The repository root license therefore places these files under MIT. This implementation reuses that
OSS code and does not unlock, copy, or import an Enterprise implementation.

## Database compatibility

This feature adds one independent table, `CorporatePersonalKeyRegistry`. It does not alter LiteLLM core tables and deliberately
has no foreign keys or triggers into them. The existing `LiteLLM_VerificationToken`, Organization, Team, membership,
object-permission, audit, and deprecated-token tables remain the source of runtime authentication data.

The registry row uses `user_id` as its primary key, which provides the database-level one-active-personal-key invariant.
The advisory transaction lock serializes create, rotate, delete, SSO transfer, and concurrent first-login work for the
same user. The independent table is the smallest schema change that can enforce this invariant across proxy replicas.

## Key management

Internal users use only:

- `POST /internal/personal-key`
- `GET /internal/personal-key`
- `POST /internal/personal-key/rotate`
- `DELETE /internal/personal-key`

The server derives owner, Team, Organization, models, MCP inheritance, expiry, key type, and lifecycle metadata. Unknown
request fields are rejected. The database registry has one row per user, so concurrent creates cannot produce two active
personal keys.

Proxy administrators use `/key/service-account/generate` for service keys. The endpoint clears `user_id`, forces the
`llm_api` key type, and stamps service-account ownership metadata.

Service isolation at the Organization/key limiter does not reserve provider capacity. Production model aliases must route
to separate provider deployments or reserved-capacity deployments from Human aliases. Configure service concurrency,
fallbacks, and circuit breakers on that deployment set; configure Human traffic shedding on the Human deployment set.
Sharing the same provider deployment can still let Human traffic consume provider TPM or increase service latency.

Redis is mandatory for multi-instance rate limiting and service-key auto-rotation leader locking. Treat Redis lock or
rate-limit failures as an operational fault and alert on skipped rotation cycles. Personal-key rotation additionally uses
a PostgreSQL advisory transaction lock per user.

## Rotation

Personal-key rotation is user initiated. The active VerificationToken row moves to a new hash and the previous hash is
inserted into `LiteLLM_DeprecatedVerificationToken` with a fixed revoke time. The new key receives a newly calculated
`PERSONAL_KEY_DURATION`; the old expiry is not copied.

The plaintext key is returned only by create or rotate. The registry, VerificationToken, audit rows, logs, and cache use
hashes or non-secret identifiers.

## Stock OSS fallback

The custom migration only adds `CorporatePersonalKeyRegistry`. It has no foreign keys, triggers, or changes to LiteLLM core
tables. A stock LiteLLM OSS image can ignore the table and continue authenticating existing VerificationToken rows.

Use `prisma migrate deploy` for both custom and stock images. Do not use `prisma db push`,
`--use_prisma_db_push`, `--accept-data-loss`, or schema-reset commands against a shared production database. Stock OSS
fallback restores serving compatibility, but the custom personal-key management and SSO policy endpoints are unavailable
until the custom image returns.

Before rollout, validate the exact stock image tag against a production schema clone:

1. Apply all custom migrations to the clone.
2. Start the stock image with migration deploy.
3. Verify health, an existing personal-key LLM request, a service-key request, Team model denial, and MCP denial.
4. Confirm the extra custom table remains present after shutdown.
