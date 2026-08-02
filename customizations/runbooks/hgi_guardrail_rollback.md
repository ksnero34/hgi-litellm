# HGI guardrail metadata rollback

This procedure prepares an HGI 1.94 database for a stock LiteLLM rollback without deleting general key or team metadata. It only removes the key fields `disable_global_guardrails`, `guardrails`, and `policies`; the team fields `disable_global_guardrails`, `guardrails`, `policies`, and `opted_out_global_guardrails`; and resets the team flag `allow_team_guardrail_config` to `false`.

The repository-evidenced HGI image tag is `docker.litellm.ai/berriai/litellm:hgi-v1.94.0.2`. A tag is not immutable. Do not use this runbook on production until both the HGI image and the selected stock rollback image have been pulled, their registry digests recorded, and their provenance verified against the release handoff. Run production containers as `repository@sha256:<verified-digest>`, even if Compose retains the human-readable HGI tag.

## Preconditions

Put the service in a maintenance window and stop all writers. Take and verify a recoverable PostgreSQL backup. Restrict the rollback backup directory to the operator because it contains key database identifiers, team identifiers, and only the allowlisted guardrail metadata values needed for restoration. Never paste `DATABASE_URL`, backup content, full metadata, or image credentials into tickets or logs.

Resolve and record each immutable digest before testing:

```sh
docker pull docker.litellm.ai/berriai/litellm:hgi-v1.94.0.2
docker image inspect --format '{{index .RepoDigests 0}}' docker.litellm.ai/berriai/litellm:hgi-v1.94.0.2
```

Repeat for the selected stock rollback tag. Compare the returned digest with the independently supplied release digest. A successful pull alone is not provenance verification. Stop if a digest is absent, mutable between pulls, or does not match the approved release record.

## Clone-first validation

Never make production the first rollback attempt. Restore the production database backup into an isolated PostgreSQL clone with no production network access and point an isolated proxy at that clone.

Run the schema and blocker inspection against the clone:

```sh
DATABASE_URL='postgresql://clone-connection' python scripts/hgi/rollback_guardrail_metadata.py inspect
```

Resolve every preflight issue. Cleanup is intentionally blocked while an active `microsoft_purview` guardrail exists or a production policy references one. Disable or replace those configurations through the application and repeat inspection. There is no blocker override.

Preview cleanup, then apply it to the clone:

```sh
DATABASE_URL='postgresql://clone-connection' python scripts/hgi/rollback_guardrail_metadata.py   --output-dir /secure/operator/rollback-backups cleanup
DATABASE_URL='postgresql://clone-connection' python scripts/hgi/rollback_guardrail_metadata.py   --output-dir /secure/operator/rollback-backups cleanup --apply
```

Confirm that the backup file exists, is mode `0600`, and is stored outside shared logs and artifacts. The tool writes and fsyncs this narrow backup before beginning database mutation. Re-run cleanup without `--apply`; both target counts must be zero.

Start the stock rollback image by its verified digest against the clone. Validate migration compatibility and startup without `db push`, schema reset, or destructive migration flags. Exercise representative existing keys, team access, model restrictions, organization budgets, MCP permissions, and non-Purview policies. Confirm that unrelated metadata and additive HGI tables remain intact.

Then switch the clone back to the verified HGI digest and preview restoration:

```sh
DATABASE_URL='postgresql://clone-connection' python scripts/hgi/rollback_guardrail_metadata.py restore   --backup-file /secure/operator/rollback-backups/guardrail-metadata-<timestamp>.json
DATABASE_URL='postgresql://clone-connection' python scripts/hgi/rollback_guardrail_metadata.py restore   --backup-file /secure/operator/rollback-backups/guardrail-metadata-<timestamp>.json --apply
```

Re-run restore without `--apply`; both target counts must be zero. Restore stops with a redacted error if any backed-up key or team no longer exists, and that mismatch must be resolved before proceeding. Validate the restored guardrail and policy behavior. Approval to continue requires the complete clone sequence to pass using the exact digests intended for production.

## Production execution

Repeat the same inspect, dry-run cleanup, applied cleanup, and idempotence check during the maintenance window. Retain the database backup, the restricted rollback backup file, command output, and verified image digests according to the incident retention policy. Output contains counts, metadata field names, and redacted identifiers; it does not contain metadata values or raw key identifiers.

Start the stock image only by its verified digest. If validation fails, stop writers, switch back to the verified HGI digest, run restore first as a dry-run and then with `--apply`, and validate again. A database-level restore remains the recovery path if schema or data changed outside this tool's allowlisted scope.
