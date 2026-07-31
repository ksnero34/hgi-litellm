from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[3]
MIGRATION = (
    REPOSITORY_ROOT
    / "litellm-proxy-extras"
    / "litellm_proxy_extras"
    / "migrations"
    / "20260725010000_corporate_personal_key_registry"
    / "migration.sql"
)


def test_personal_key_migration_is_additive_for_stock_oss_fallback():
    sql = MIGRATION.read_text().upper()

    assert 'CREATE TABLE IF NOT EXISTS "CORPORATEPERSONALKEYREGISTRY"' in sql
    assert "ALTER TABLE" not in sql
    assert "DROP TABLE" not in sql
    assert "REFERENCES" not in sql
    assert "CREATE TRIGGER" not in sql
