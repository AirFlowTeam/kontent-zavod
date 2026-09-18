# VPS deployment

The VPS deployment runs the Vinext Worker as a single `systemd` service behind
the host Nginx instance.

- Current VPS: `217.60.183.146`; Worker listener: `127.0.0.1:18084`
- Dashboard: `https://kontent-zavod.217-60-183-146.sslip.io:21443/`
- Public user guide: `https://kontent-zavod.217-60-183-146.sslip.io:21443/guide/`
- Unit templates retain the original server ports; preserve the current host's installed configuration when deploying.
- Application releases: `/opt/kontent-zavod/releases`
- Current release symlink: `/opt/kontent-zavod/current`
- Persistent local D1 state: `/var/lib/kontent-zavod/state`
- Service: `kontent-zavod.service`
- Always-on channel collector: `kontent-zavod-sync.service` (no cron)
- Telegram creator bot: `kontent-zavod-telegram.service` (long polling, no cron)
- Collector credentials: `/etc/kontent-zavod/sync.env` (`0640`, owned by
  `root:kontentzavod`, never committed)
- Telegram token: `/etc/kontent-zavod/telegram.env` (`0640`, owned by
  `root:kontentzavod`, never committed)

The Worker must run as a single process because its D1 binding is backed by
local Miniflare state. Keep the state directory outside release folders and do
not commit Nginx Basic Auth credentials or other secrets.

The public guide is a standalone static file served directly by Nginx from
`/var/www/kontent-zavod-guide/index.html`, outside application releases. Its source
is `guides/kontent-zavod-guide.html`. Copy only this file (directory `0755`, file
`0644`). The exact `/guide` and `/guide/` locations in `nginx.conf` bypass Basic
Auth only for the guide; `/guide` redirects to `/guide/`. Preserve these locations
on future deployments. Do not make a whole application or repository directory
public. For configuration changes, back up the installed config, run `nginx -t`,
and reload Nginx. Verify `/guide/` returns 200 without credentials, `/` and
`/api/data` return 401, and service-only endpoints remain externally forbidden.

The collector claims due channels from the loopback-only `/api/sync` endpoint
and updates successful channels every 24 hours (first collection immediately).
Failed requests use bounded retries; expired leases recover after a restart.
YouTube uses only each channel’s encrypted personal Data API key; the legacy
`YOUTUBE_API_KEY` is ignored and anonymous metric fallbacks are disabled for YouTube.
Missing personal access yields `needs_auth`. Other sources include RuTube's
first-party profile API (including `/u/name` resolution), TikTok and Instagram
public profile JSON, and VK API when `VK_API_TOKEN` is configured. `yt-dlp` is a
best-effort fallback. It never stores individual publications. Optional
`YTDLP_COOKIES_FILE` and `PARSER_PROXY_URL` values can be added to `sync.env`
for authorized sessions. Cookies are copied to a temporary writable file per run.
Missing metrics stay null; sampled video views are never passed off as channel
totals or 30-day unique reach. A provider returning no metrics fails explicitly.

The bot works only in private chats. `/start` offers producer and creator roles.
A producer gets an isolated team and creates one-recipient, seven-day invitations.
Creators open their producer's invite and choose AI or UGC once for all their
channels before submitting channel or video links. Every channel retains both
owners' Telegram IDs (usernames optional), shown in bot, dashboard and export.
`/role` changes only one's own role, never ownership. Video URLs
are used transiently to resolve the channel and are never stored. The bot calls
the loopback-only `/api/telegram` endpoint with the service credential already
used by the collector.

The old arbitrary creator selector and shared invite code are disabled. Existing
server tokens and admin allowlist are preserved but do not bypass ownership.
Legacy creator links must confirm their type and have a linked producer before
submitting. Do not infer Telegram ownership from a display name.

Schema is managed by `drizzle/*.sql`, not DDL on every HTTP request. Back up the
persistent database before applying additive migrations and changing the release
symlink. On the original runtime-created schema, apply only the verified missing
migration; do not replay earlier CREATE TABLE migrations blindly.

Extract release archives with `--no-same-owner`. Before startup, create writable
`.wrangler` and `dist/server/.wrangler/tmp` directories in the new release,
owned by `kontentzavod:kontentzavod` (0750). The remaining source can stay read-only.
Do not regard `systemctl is-active` as readiness: verify `/api/data` and logs too.
On macOS, package with `tar --no-mac-metadata --no-xattrs --no-fflags` so generated
AppleDouble `._*.js` sidecars cannot be mistaken for Worker JavaScript modules.

`memory-resilience.conf` is a drop-in for this app service only. A low soft memory
limit previously left workerd indefinitely throttled instead of restarting.
Keep the 1 GiB hard cap and OOM restart; do not restore the old MemoryHigh=768M.

Validation: `npm test`, `npm run lint`, `npx tsc --noEmit`, then the Sites build
helper. Tests use isolated SQLite databases and fake Telegram delivery; no real
users receive test messages. Live public checks do not prove private access or
future upstream availability.

Period export: select inclusive dates in the filter panel. Dashboard cards remain
current totals. Export uses the change between daily cumulative snapshots (Moscow
UTC+3), not statistics only for videos published in that period. Both boundaries
must have snapshots no more than 36 hours old, with matching source/type/producer.
Unknown counters, missing history and decreases remain blank, not zero. The extra
snapshot sheet gives exact timestamps and completeness notes. Current corrections
do not rewrite history. Existing YouTube history retention remains 30 days.

Basic metrics audit (2026-09-10, read-only live checks from the VPS):
- YouTube public about: total views and public video count; no received-likes total.
- RuTube profile: total views and video count; no received-likes total found.
- TikTok profile: video count and received likes; no channel-wide view count.
- Instagram: VPS public requests require login; media_count includes photos and
  is deliberately not used as a video count.
- VK: current profile API requires a token and exposes followers, not the three
  requested video totals. Anonymous fallback failed on the checked profile.
Full video aggregates on YouTube/VK/Instagram require additional authorized API
integration and complete pagination; a token alone does not implement it. Do not
sum a sample of videos or claim all three metrics work on every platform.

Migration 0006 adds only likes counters and their correction/history fields.
For the original VPS schema use `migrate-basic-metrics.py` after stopping all three
services. It validates the prior schema and creates an exclusive SQLite backup.
Do not rerun 0005 or the baseline migrations. Preserve the existing service env,
TLS, Basic Auth, ports, and passwords.

Guided creator journey (2026-09-16): `/start` and `/guide` resume a saved checklist
of all six platforms. A creator adds every account or explicitly marks a platform
absent; an existing channel always takes precedence over that mark. Metrics,
access, and app readiness are separate states. Per-channel rechecks are ownership
checked, throttled to one request/minute, and preserve active collector leases.
Telegram sends downloadable UTF-8 TXT via `guide:file` / `social:file:<platform>`.
Sources are `lib/social-guide-files.mjs`; run `node scripts/export-social-guides.mjs`
to refresh `docs/creator-guides/`.

Before switching to this release, stop all three services and run
`migrate-journey.py DATABASE drizzle/0011_material_deathbird.sql UNIQUE_BACKUP`.
It adds only journey choices and recheck receipts. Do not replay baseline migrations.
`reset-bot-data.py DATABASE --scope channels|all` is a separate dry-run tool;
execute it with `--apply --backup UNIQUE_BACKUP` only for the owner's chosen scope.
`channels` archives channels and clears saved API access while retaining teams and
history; `all` removes accounts, teams and their content records from the live DB.
Deployment itself does not authorize guessing an unanswered reset scope.
