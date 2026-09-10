"""Apply only migration 0006 to a stopped VPS database, with a verified backup.

Stop the application, collector and bot before running. Never replay the baseline
migrations on this installation: its original schema predates migration tracking.
"""
import argparse
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument("database", type=Path)
parser.add_argument("migration", type=Path)
parser.add_argument("backup", type=Path)
args = parser.parse_args()
if not args.database.is_file() or not args.migration.is_file():
    raise SystemExit("Database or migration not found")
if args.migration.name != "0006_square_leopardon.sql":
    raise SystemExit("Only the reviewed basic metrics migration is supported")
if args.backup.exists():
    raise SystemExit("Refusing to overwrite an existing backup")
expected = {"channel_sync_history": {"total_likes"}, "creator_channels": {"total_likes", "total_likes_override"}}
connection = sqlite3.connect(args.database)
connection.execute("PRAGMA foreign_keys = ON")
if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
    raise SystemExit("Database integrity check failed")
for table, added in expected.items():
    columns = {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}
    if not columns or columns & added:
        raise SystemExit("Schema is absent, already migrated or partial; inspect before proceeding")
os.umask(0o077)
with sqlite3.connect(args.backup) as backup:
    connection.backup(backup)
    if backup.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
        raise SystemExit("Backup integrity check failed")
try:
    connection.executescript("BEGIN IMMEDIATE;\n" + args.migration.read_text())
    for table, added in expected.items():
        if not added <= {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}:
            raise RuntimeError("Post-migration schema check failed")
    if connection.execute("PRAGMA foreign_key_check").fetchall():
        raise RuntimeError("Foreign key check failed")
    connection.commit()
except Exception:
    connection.rollback()
    raise
finally:
    connection.close()
print("Verified backup created; basic metrics migration applied; foreign keys verified")
