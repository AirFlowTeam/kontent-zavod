"""Add only deleted_at, preserving data and a verified backup. Stop services first."""
import argparse
import os
import sqlite3
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('database', type=Path)
parser.add_argument('migration', type=Path)
parser.add_argument('backup', type=Path)
args = parser.parse_args()
if not args.database.is_file() or not args.migration.is_file() or args.backup.exists():
    raise SystemExit('Missing input or backup already exists; inspect before proceeding')
sql = args.migration.read_text().strip()
if sql != 'ALTER TABLE `creator_channels` ADD `deleted_at` text;':
    raise SystemExit('Not the reviewed channel-management migration')
os.umask(0o077)
with sqlite3.connect(args.database) as connection:
    connection.execute('PRAGMA foreign_keys=ON')
    columns = {r[1] for r in connection.execute('PRAGMA table_info(creator_channels)')}
    if not columns or 'deleted_at' in columns:
        raise SystemExit('Missing table or migration already applied')
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed')
    with sqlite3.connect(args.backup) as backup:
        connection.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity check failed')
    connection.execute('BEGIN IMMEDIATE')
    connection.execute(sql)
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Backup verified; channel-management migration applied')
