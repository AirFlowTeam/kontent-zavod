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

Creators use `/social` for instructions, `/channels` → own channel → Connect API.
The form is one-use, expires in 10 minutes, verifies Origin, Telegram ownership,
provider account and channel. Credentials are encrypted with owner/channel/account
AAD, excluded from all user-facing DTOs, and available only to a current leased job.
Deleting/replacing a channel deletes its stored credentials and outstanding tickets.
Disconnect removes local credentials, not the platform's OAuth grant; users may
also revoke permission in that platform. Backups retain encrypted data and need
the original vault key for recovery. Do not rotate the key without migration.

## External prerequisites (not fabricated or provisioned by deployment)

- Instagram: Professional account; Meta Instagram Login application. User can
  import a Dashboard long-lived token. Advanced Access/App Review for third-party
  creators. Automatic refresh of valid long-lived tokens; no app secret needed.
  Imported token expiry is unknown until confirmed by refresh. Ordinary short-lived
  OAuth tokens are not suitable. Counts cover top-level VIDEO, not photos/carousels/stories;
  missing or historic insights stay unknown, not zero.
- TikTok: Approved Login Kit/Display API application. Set `TIKTOK_CLIENT_KEY` and
  `TIKTOK_CLIENT_SECRET` for the matching app in `/etc/kontent-zavod/sync.env` and restart
  app+collector. Users import access/refresh tokens already issued by that app.
  This release does not register or approve apps and does not implement interactive OAuth.
  Without app configuration the form refuses an unusable one-day-only connection.
- VK: VK ID application with approved `video` right (special approval from VK).
  User access + refresh + client_id + device_id required; community/service tokens
  do not support video.get. Profile ownership or community management is verified.
  Metrics cover accessible own videos in Added, not guaranteed complete Clips.
- YouTube: Prefer one admin `YOUTUBE_API_KEY` restricted to API and VPS IP. A user
  may also attach a key to one owned Content Factory channel. Key is a project
  credential, not proof of YouTube ownership. All public uploads queried for likes.
- RuTube: No key required for public uploads/views. Public likes unavailable.

No platform login password/cookies are requested. No paid services provisioned.
The guides in bot/site share `lib/social-instructions.mjs` and link official docs.
All adapters are regression-tested with provider fixtures; production validation
of authenticated APIs still requires genuine authorized platform tokens.
