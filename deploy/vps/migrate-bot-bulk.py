"""Apply reviewed Telegram composite receipt migration with verified backup.
Stop app, sync and bot services before running. Never edits user records.
"""
import argparse
import hashlib
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('database', type=Path)
parser.add_argument('migration', type=Path)
parser.add_argument('backup', type=Path)
args = parser.parse_args()
if not args.database.is_file() or not args.migration.is_file() or args.backup.exists():
    raise SystemExit('Missing input or backup already exists')
raw = args.migration.read_bytes()
if hashlib.sha256(raw).hexdigest() != 'a98fc7b53aa1076f0f3d9adcfec5cc6954005a2a380bc4a0864f0329bf6b06d2':
    raise SystemExit('Not the reviewed bulk receipt migration')
os.umask(0o077)
with sqlite3.connect(args.database) as db:
    db.execute('PRAGMA foreign_keys=ON')
    columns = [r[1] for r in db.execute('PRAGMA table_info(telegram_submissions)')]
    if 'update_id' not in columns or 'item_index' in columns:
        raise SystemExit('Prerequisite missing or already migrated')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed')
    before = db.execute('SELECT count(*) FROM telegram_submissions').fetchone()[0]
    with sqlite3.connect(args.backup) as backup:
        db.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity check failed')
    db.execute('BEGIN IMMEDIATE')
    for statement in raw.decode().split('--> statement-breakpoint'):
        db.execute(statement.strip())
    if db.execute('SELECT count(*) FROM telegram_submissions WHERE item_index=0').fetchone()[0] != before:
        raise RuntimeError('Legacy receipt count changed')
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Verified backup created; per-link receipts enabled; legacy receipts preserved')
