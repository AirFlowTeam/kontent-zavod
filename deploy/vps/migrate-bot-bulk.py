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
    columns = {r[1]: r for r in db.execute('PRAGMA table_info(telegram_submissions)')}
    indexes = {r[1]: r for r in db.execute('PRAGMA index_list(telegram_submissions)')}
    legacy_index = indexes.get('idx_telegram_submissions_update_id')
    if ('update_id' not in columns or not legacy_index or not legacy_index[2]
            or legacy_index[4] or 'idx_telegram_submissions_update_item' in indexes
            or [r[2] for r in db.execute('PRAGMA index_info(idx_telegram_submissions_update_id)')] != ['update_id']):
        raise SystemExit('Prerequisite missing or already migrated')
    # A safe application rollback retains this additive column and restores the
    # legacy unique index. Resume only that exact state, never an arbitrary schema.
    resume = 'item_index' in columns
    if resume:
        column = columns['item_index']
        if (column[2].upper() != 'INTEGER' or column[3] != 1 or column[4] != '0'
                or db.execute('SELECT 1 FROM telegram_submissions WHERE item_index IS NULL OR item_index != 0 LIMIT 1').fetchone()):
            raise SystemExit('Unexpected partial migration state')
    if db.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed')
    before = db.execute('SELECT count(*) FROM telegram_submissions').fetchone()[0]
    with sqlite3.connect(args.backup) as backup:
        db.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity check failed')
    db.execute('BEGIN IMMEDIATE')
    for statement in raw.decode().split('--> statement-breakpoint'):
        if resume and statement.strip().startswith('ALTER TABLE'):
            continue
        db.execute(statement.strip())
    if db.execute('SELECT count(*) FROM telegram_submissions WHERE item_index=0').fetchone()[0] != before:
        raise RuntimeError('Legacy receipt count changed')
    if db.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Verified backup created; per-link receipts enabled; legacy receipts preserved')
