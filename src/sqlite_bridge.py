import json
import os
import sqlite3
import sys


COLLECTION_TABLES = {
    "people": "people",
    "milestones": "milestones",
    "workflows": "workflows",
    "group_chats": "group_chats",
    "content_items": "content_items",
}


def initialize(connection):
    connection.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS schema_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          data_json TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS provider_secrets (
          name TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS people (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS milestones (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS group_chats (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS content_items (
          id TEXT PRIMARY KEY,
          position INTEGER NOT NULL,
          data_json TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS audit_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL,
          event TEXT NOT NULL,
          action TEXT NOT NULL,
          timestamp TEXT NOT NULL,
          details_json TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_audit_events_run_id ON audit_events(run_id);
        PRAGMA user_version = 2;
        """
    )


def replace_records(connection, table, rows):
    connection.execute(f"DELETE FROM {table}")
    connection.executemany(
        f"INSERT INTO {table} (id, position, data_json) VALUES (?, ?, ?)",
        [(row["id"], index, json.dumps(row, ensure_ascii=False)) for index, row in enumerate(rows)],
    )


def import_legacy(connection, payload):
    marker = connection.execute(
        "SELECT value FROM schema_meta WHERE key = 'legacy_import_v1'"
    ).fetchone()
    if marker:
        return {"imported": False}
    with connection:
        config = payload.get("config")
        if config is not None:
            connection.execute(
                "INSERT OR REPLACE INTO app_config (id, data_json, updated_at) VALUES (1, ?, datetime('now'))",
                (json.dumps(config, ensure_ascii=False),),
            )
        for domain, table in COLLECTION_TABLES.items():
            replace_records(connection, table, payload.get("collections", {}).get(domain, []))
        for event in payload.get("auditEvents", []):
            connection.execute(
                "INSERT INTO audit_events (run_id, event, action, timestamp, details_json) VALUES (?, ?, ?, ?, ?)",
                (
                    event.get("runId", "unknown"),
                    event.get("event", "failed"),
                    event.get("action", "legacy"),
                    event.get("timestamp", ""),
                    json.dumps(event.get("details", {}), ensure_ascii=False),
                ),
            )
        connection.execute(
            "INSERT INTO schema_meta (key, value) VALUES ('legacy_import_v1', datetime('now'))"
        )
    return {
        "imported": True,
        "config": config is not None,
        "collections": {domain: len(payload.get("collections", {}).get(domain, [])) for domain in COLLECTION_TABLES},
        "auditEvents": len(payload.get("auditEvents", [])),
    }


def handle(connection, payload):
    action = payload.get("action")
    if action == "initialize":
        return {"ok": True}
    if action == "import_legacy":
        return import_legacy(connection, payload)
    if action == "get_config":
        row = connection.execute("SELECT data_json FROM app_config WHERE id = 1").fetchone()
        return json.loads(row[0]) if row else None
    if action == "has_config":
        row = connection.execute("SELECT 1 FROM app_config WHERE id = 1").fetchone()
        return bool(row)
    if action == "set_config":
        with connection:
            connection.execute(
                "INSERT OR REPLACE INTO app_config (id, data_json, updated_at) VALUES (1, ?, datetime('now'))",
                (json.dumps(payload["data"], ensure_ascii=False),),
            )
        return {"ok": True}
    if action == "get_secret":
        row = connection.execute(
            "SELECT value FROM provider_secrets WHERE name = ?", (payload["name"],)
        ).fetchone()
        return row[0] if row else None
    if action == "set_secret":
        with connection:
            connection.execute(
                "INSERT OR REPLACE INTO provider_secrets (name, value, updated_at) VALUES (?, ?, datetime('now'))",
                (payload["name"], payload["value"]),
            )
        return {"ok": True}
    if action == "delete_secret":
        with connection:
            cursor = connection.execute(
                "DELETE FROM provider_secrets WHERE name = ?", (payload["name"],)
            )
        return cursor.rowcount > 0
    if action == "list_secret_names":
        rows = connection.execute("SELECT name FROM provider_secrets ORDER BY name").fetchall()
        return [row[0] for row in rows]
    if action in ("list_records", "replace_records"):
        domain = payload.get("domain")
        if domain not in COLLECTION_TABLES:
            raise ValueError(f"Unsupported SQLite collection: {domain}")
        table = COLLECTION_TABLES[domain]
        if action == "list_records":
            rows = connection.execute(f"SELECT data_json FROM {table} ORDER BY position").fetchall()
            return [json.loads(row[0]) for row in rows]
        with connection:
            replace_records(connection, table, payload.get("records", []))
        return {"ok": True, "count": len(payload.get("records", []))}
    if action == "append_audit":
        event = payload["event"]
        with connection:
            connection.execute(
                "INSERT INTO audit_events (run_id, event, action, timestamp, details_json) VALUES (?, ?, ?, ?, ?)",
                (
                    event["runId"],
                    event["event"],
                    event["action"],
                    event["timestamp"],
                    json.dumps(event.get("details", {}), ensure_ascii=False),
                ),
            )
        return {"ok": True}
    if action == "list_audit":
        limit = max(1, min(int(payload.get("limit", 50)), 200))
        rows = connection.execute(
            "SELECT run_id, event, action, timestamp, details_json FROM audit_events ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [
            {
                "runId": row[0],
                "event": row[1],
                "action": row[2],
                "timestamp": row[3],
                "details": json.loads(row[4]),
            }
            for row in rows
        ]
    if action == "stats":
        counts = {
            domain: connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            for domain, table in COLLECTION_TABLES.items()
        }
        counts["audit_events"] = connection.execute("SELECT COUNT(*) FROM audit_events").fetchone()[0]
        counts["config"] = 1 if connection.execute("SELECT 1 FROM app_config WHERE id = 1").fetchone() else 0
        counts["provider_secrets"] = connection.execute("SELECT COUNT(*) FROM provider_secrets").fetchone()[0]
        return counts
    raise ValueError(f"Unsupported SQLite action: {action}")


def main():
    payload = json.load(sys.stdin)
    database_path = os.path.abspath(payload["databasePath"])
    os.makedirs(os.path.dirname(database_path), exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    try:
        initialize(connection)
        result = handle(connection, payload)
        print(json.dumps(result, ensure_ascii=False))
    finally:
        connection.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
