"""Apply exactly the additive onboarding migration to a stopped VPS database.

The deployment operator must stop app/collector/bot before invoking this script.
Uses SQLite's backup API, preserves ownership of the existing database, and
refuses partial/incompatible schemas. No credentials or user records are logged.
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
if args.migration.name != "0005_lyrical_invaders.sql":
    raise SystemExit("Only the reviewed onboarding migration is supported")
if args.backup.exists():
    raise SystemExit("Refusing to overwrite an existing backup")
connection = sqlite3.connect(args.database)
if connection.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
    raise SystemExit("Database integrity check failed")
tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
new_tables = {"telegram_accounts", "telegram_invites", "telegram_producer_links"}
columns = {row[1] for row in connection.execute("PRAGMA table_info(telegram_creator_links)")}
if new_tables & tables or "type_confirmed_at" in columns:
    raise SystemExit("Onboarding schema already exists or is partial; inspect before proceeding")
if not {"telegram_creator_links", "creators", "producers"} <= tables:
    raise SystemExit("Required baseline schema is absent")
os.umask(0o077)
with sqlite3.connect(args.backup) as backup:
    connection.backup(backup)
try:
    connection.executescript("BEGIN IMMEDIATE;\n" + args.migration.read_text() + "\nCOMMIT;")
except Exception:
    connection.rollback()
    raise
if connection.execute("PRAGMA foreign_key_check").fetchall():
    raise SystemExit("Foreign key check failed; restore verified backup before starting")
print("Backup created; onboarding migration applied; integrity and foreign keys verified")
connection.close()
