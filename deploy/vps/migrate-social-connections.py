"""Apply only the reviewed additive 0008 migration, with verified SQLite backup."""
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
    raise SystemExit('Missing input or backup already exists; inspect before proceeding')
raw = args.migration.read_bytes()
if hashlib.sha256(raw).hexdigest() != 'f10059e634e70c831f9a13f20aecea2f69d9f38463ba80b43c5348dc2974c64d':
    raise SystemExit('Not the reviewed social-connections migration')
os.umask(0o077)
with sqlite3.connect(args.database) as connection:
    connection.execute('PRAGMA foreign_keys=ON')
    if connection.execute("SELECT name FROM sqlite_schema WHERE name IN ('social_connections','social_connect_tickets')").fetchall():
        raise SystemExit('Migration already applied or partially present; inspect first')
    if 'deleted_at' not in {row[1] for row in connection.execute('PRAGMA table_info(creator_channels)')}:
        raise SystemExit('Prerequisite 0007 missing')
    if connection.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
        raise SystemExit('Database integrity check failed')
    with sqlite3.connect(args.backup) as backup:
        connection.backup(backup)
        if backup.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Backup integrity check failed')
    connection.execute('BEGIN IMMEDIATE')
    for statement in raw.decode().split('--> statement-breakpoint'):
        connection.execute(statement.strip())
    if connection.execute('PRAGMA foreign_key_check').fetchall():
        raise RuntimeError('Foreign key check failed')
print('Backup verified; social-connections migration applied')
