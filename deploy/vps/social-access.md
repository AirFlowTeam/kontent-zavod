# Social access deployment and actual limitations

The shared admin login is unchanged. `/api/data` includes ALL `telegram_accounts`,
including unfinished onboarding. The visible browser checks `/api/revision` every
3 seconds, fetches changed data, retries transient failures and displays stale-data warnings.
Creators without channels are no longer hidden. No user-specific admin row filter exists.

Apply only reviewed `0008_lush_slapstick.sql` using `migrate-social-connections.py`,
with services stopped and a unique verified backup. Never replay earlier migrations.
`configure-social-access.py` preserves existing secrets/config, adds a random
AES-256-GCM `SOCIAL_VAULT_KEY`, and enables only `/connect/[64 lowercase hex chars]`
without Basic Auth. These ticket URLs are bearer secrets: access/error logging is off.
Keep all `/api/telegram` and `/api/sync` external deny rules and general Basic Auth.

Creators use `/guide` for the full invitation → type → links → API walkthrough,
`/social` or the public `/api-guide` for platform steps, `/api` for their own channels.
Up to 10 URLs per message use independent `(update_id,item_index)` receipts; failures
do not undo other links. Only creators can submit their own API access, never producers.
The form is one-use, expires in 10 minutes, verifies Origin, Telegram ownership,
provider account and channel. Credentials are encrypted with owner/channel/account
AAD, excluded from all user-facing DTOs, and available only to a current leased job.
Deleting/replacing a channel deletes its stored credentials and outstanding tickets.
Disconnect removes local credentials, not the platform's OAuth grant; users may
also revoke permission in that platform. Backups retain encrypted data and need
the original vault key for recovery. Do not rotate the key without migration.

## External prerequisites (not fabricated or provisioned by deployment)

- Instagram: Professional account; Meta Instagram Login application. OAuth exchanges
  the code and short token for a long-lived token. Manual import requires a valid
  long-lived token eligible for refresh (at least 24h old). Advanced Access/App Review for third-party
  creators. Automatic refresh of valid long-lived tokens; no app secret needed.
  Expiry comes from the token response. Short-lived tokens are never stored as ready.
  Counts cover top-level VIDEO, not photos/carousels/stories;
  missing or historic insights stay unknown, not zero.
- TikTok: Approved Login Kit/Display API application. Set `TIKTOK_CLIENT_KEY` and
  `TIKTOK_CLIENT_SECRET` for the matching app in `/etc/kontent-zavod/sync.env` and restart
  app+collector. Interactive Web OAuth requests and verifies all four scopes.
  This release does not register or approve apps. Imported tokens must match this app.
  Without app configuration the form refuses an unusable one-day-only connection.
- VK: Confidential VK ID application with approved `video` right (special approval from VK),
  server `VK_CLIENT_ID` and `VK_SERVICE_TOKEN`, and allowlisted server IP. Web OAuth
  uses S256 PKCE; supports flat callback params and VK JSON payload, rejects conflicts.
  User access + refresh + client_id + device_id required; community/service tokens
  do not support video.get. Profile ownership or community management is verified.
  Metrics cover accessible own videos in Added, not guaranteed complete Clips.
- Threads: Separate Threads OAuth app with `THREADS_CLIENT_ID`, `THREADS_CLIENT_SECRET`,
  `threads_basic` and `threads_manage_insights`. Both .com and .net profile links,
  and /@username/post/code links, normalize to one profile. Long-lived tokens refresh
  after 24h. Count own root posts and per-post lifetime views/likes, never profile views.
  Reposts, replies and ghost posts excluded. App approval remains an operator prerequisite.
- YouTube: Each creator attaches a personal Data API key restricted to API and VPS IP
  to their own Content Factory channel. Collection requires that connected personal
  credential; the server key and anonymous fallbacks are not used. Key is a project
  credential, not proof of YouTube ownership. All public uploads queried for likes.
- RuTube: No key required for public uploads/views. Public likes unavailable.

No platform login password/cookies are requested. No paid services provisioned.
The guides in bot/site share `lib/social-instructions.mjs` and link official docs.
Apply only the reviewed additive 0009 migration via `migrate-social-oauth.py` with
all three services stopped and a verified unique backup. Install the updated narrow
Nginx fragment: callbacks/result pages are public with logs disabled; API routes
and dashboard stay protected. OAuth uses per-attempt Secure HttpOnly Lax cookies,
hashed state/browser secret, encrypted verifier, 10-minute TTL, single-use CAS and
provider/owner checks. New tickets/disconnect/deletion revoke sessions via FK cascade.
Tokens and completion status commit atomically; callbacks redirect off code query URLs.

See `API-ADMIN-GUIDE.md` and `configure-api.py` for operator setup. All OAuth gates
are off until their app settings AND explicit `*_OAUTH_ENABLED=true` are configured.
Do not enable them based solely on code deployment. Existing admin/bot/root passwords
are unchanged. Disclosure pages require operator/legal review before app submission.

All adapters are regression-tested with provider fixtures; production validation
of authenticated APIs still requires genuine authorized platform tokens.

Bulk release: apply only `0010_common_agent_brand.sql` with `migrate-bot-bulk.py`
while all services are stopped, after verifying the backup. Older releases expect
the former update-only unique index: do not roll back to them after receiving bulk
messages without a reviewed receipt migration. Never restore an old database over
new creator submissions. Nginx must also allow the narrow `/connect/oauth/threads/callback`.
