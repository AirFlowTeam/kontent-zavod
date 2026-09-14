"""Install the narrow public connect form and a server-only random encryption key.
Preserves existing credentials, produces recoverable config backups, never prints secrets.
Run as root on the current VPS, after source/migration checks, before service restart.
"""
import grp
import os
import secrets
import shutil
import subprocess
from pathlib import Path

os.umask(0o077)
config = Path('/etc/nginx/conf.d/kontent-zavod.conf')
environment = Path('/etc/kontent-zavod/sync.env')
fragment = Path('/etc/kontent-zavod/social-connect-location.conf')
source = Path(__file__).with_name('social-connect-location.conf')
if not config.is_file() or not environment.is_file() or not source.is_file():
    raise SystemExit('Expected current VPS config missing')
nginx = config.read_text()
if '217-60-183-146' not in nginx or '18084' not in nginx:
    raise SystemExit('Wrong VPS configuration')
marker = '    include /etc/kontent-zavod/social-connect-location.conf;'
if marker not in nginx and nginx.count('    location = /healthz {') != 1:
    raise SystemExit('Cannot identify exact application TLS server')
suffix = '.before-social-' + secrets.token_hex(4)
shutil.copy2(config, str(config) + suffix)
shutil.copy2(environment, str(environment) + suffix)
try:
    shutil.copyfile(source, fragment)
    fragment.chmod(0o640)
    if marker not in nginx:
        config.write_text(nginx.replace('    location = /healthz {', marker + '\n\n    location = /healthz {'))
    subprocess.run(['nginx', '-t'], check=True)
except Exception:
    shutil.copy2(str(config) + suffix, config)
    raise
lines = environment.read_text().splitlines()
keys = {line.split('=', 1)[0] for line in lines if '=' in line and not line.startswith('#')}
if 'SOCIAL_VAULT_KEY' not in keys:
    lines.append('SOCIAL_VAULT_KEY=' + secrets.token_hex(32))
if 'CONTENT_PUBLIC_ORIGIN' not in keys:
    lines.append('CONTENT_PUBLIC_ORIGIN=https://kontent-zavod.217-60-183-146.sslip.io:21443')
environment.write_text('\n'.join(lines) + '\n')
environment.chmod(0o640)
os.chown(environment, 0, grp.getgrnam('kontentzavod').gr_gid)
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('Social vault configured; precise form route enabled; prior credentials preserved')
