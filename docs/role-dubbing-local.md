# Role dubbing: local setup and verification

Role dubbing lives in the **Future Rehearsal Room** (`/learning`). A saved video and a validated Spanish script become an audio guide. The yellow and white dog roles are fixed by the couple's membership; each person records only their own lines.

The theater keeps the video on the left. The right panel separates **Listen**, **Record**, and **My videos**. A recording starts as a private draft. Sharing choices with a partner and authorizing a particular render are separate actions. Solo renders use the requester's recordings and the other role's guide voice; duet renders require both participants' confirmation of the same sound-source manifest.

## What runs without a speech account

The local demo exercises the real media code with a generated test-pattern video and synthetic tones. It does **not** demonstrate spoken Spanish, voice quality, a real user's recording, or a live provider integration.

Requirements: Node.js 22 or newer, pnpm, FFmpeg and ffprobe available on PATH. Run from `puppy-journey`:

```bash
pnpm install
pnpm test
pnpm test:dubbing-media
pnpm dubbing:demo
```

The demo writes `guide.mp4`, `solo.mp4`, audio fixtures, subtitles, and a manifest under `.local/dubbing-demo/`. This directory is ignored by Git. The command refuses to overwrite an existing demo; choose another directory with `pnpm dubbing:demo --output .local/dubbing-demo-2`.

The default unit suite uses mocked providers and an embedded PostgreSQL engine (PGlite) for the dubbing migration and RPCs. The media smoke suite additionally executes FFmpeg, decodes the resulting audio, and checks the video/audio streams. Neither suite requires provider credentials.

## Connect the application and worker

1. Start with a working development Supabase project and the existing couple/profile and rehearsal pipeline schema. Apply `supabase/migrations/20261008170000_role_dubbing.sql` after the earlier migrations. It creates the private `rehearsal-dubbing` bucket, service-only tables and RPCs, job leases, consent checks, and cleanup jobs.
2. Copy `.env.example` to `.env.local` if needed. Set the existing Supabase URL, anonymous key, and server-only service-role key locally.
3. Set `DUBBING_ENABLED=true` and `DUBBING_TTS_MODE=mock`. Set `DUBBING_SOURCE_ALLOWED_HOSTS` to the exact HTTPS hostname(s) serving your saved pipeline videos. The worker rejects private network addresses and revalidates redirects.
4. Run the web app and the media worker in separate terminals:

```bash
pnpm dev
```

```bash
node --env-file=.env.local --import tsx scripts/dubbing-worker.ts
```

For a single queue iteration, append `--once`. Next.js loads `.env.local` itself; the worker command loads it explicitly. The worker needs FFmpeg and a writable temporary directory. Keep it on a private, resource-limited host; it is not a long-running process inside a Next.js route handler.

5. Sign in as each of the two development accounts, bind the dog roles, finish a saved rehearsal video, and open it in the theater. Prepare the guide, record a line, save choices, then separately confirm a solo or duet render. Use headphones to avoid recording the guide through the microphone.

Changing the speech configuration does not alter a completed guide. Already queued work rejects a changed configuration before requesting new speech. Failed operations are retried explicitly; an uncertain billable TTS response is not automatically sent again.

## Enable real speech later

Keep the feature in mock mode until a Doubao speech account and authorized Spanish voice presets are available. Configure `DOUBAO_TTS_API_KEY` and the three explicit voice IDs (`DUBBING_VOICE_YELLOW_DOG`, `DUBBING_VOICE_WHITE_DOG`, `DUBBING_VOICE_NPC`), then use `DUBBING_TTS_MODE=doubao`.

The adapter requests Spanish PCM speech and measures the resulting audio before scheduling lines. It never uploads user recordings to the TTS provider. Real account permissions, voice pronunciation, latency, and billing have **not** been verified. Do not use the synthetic demo to claim these checks passed.

## Recording and privacy rules

- Uploads are limited to 3 MiB and ten seconds per line. The server inspects the container and the worker decodes and checks duration, silence, and stream types.
- A recording that exceeds its assigned window needs an explicit trim or a new take. There is no automatic speed-up or silent truncation.
- If guide speech needs a supported freeze-frame extension, the creator must confirm the resulting timeline first. Guide timelines are capped at 30 seconds.
- Solo and duet render requests bind the exact script, timeline, media hashes, take IDs, and submission revisions. Every required owner confirms that specific manifest.
- Media stays in private storage. Authorized reads issue short-lived signed URLs (60 seconds), and downloads reauthorize. Previously downloaded files cannot be recalled.
- A role or relationship change revokes access to the old session and related renders. Owners can still revoke their takes at `/recordings`, including after leaving the couple.
- Unused private drafts and unconfirmed guide extensions expire after seven days. The worker sweeps once per minute between jobs, preserving referenced audio; unreferenced storage objects older than 24 hours are queued for deletion. Physical deletion requires the worker to stay running.
- Failed deletion jobs retry after five minutes, up to five attempts. The worker logs a count-only warning when retries are exhausted; an operator must investigate those jobs before claiming physical deletion is complete.
- Daily queue limits: ten guides per couple, 100 takes per owner (at most 60 per session), and twenty renders per couple. Retry attempts are bounded.

## Before a production rollout

Run the ordinary lint, TypeScript, test, and production-build checks plus the media smoke suite. Then verify the full flow against a development Supabase project with two real accounts: private take isolation, partner sharing, both consent steps, revocation during rendering, role changes, signed-URL expiry, restart recovery, and cleanup.

Test microphone permission denial, interrupted recordings, and playback on desktop and mobile Safari/Chrome. The local browser check uses a synthetic input stream rather than a person's microphone. PGlite exercises the SQL on one connection; multi-connection lock scheduling still needs a hosted PostgreSQL test. Hosted Supabase policy behavior, real-device microphone behavior, and real Doubao speech remain separate release checks. Keep `DUBBING_ENABLED=false` until the migration and worker are deployed together.
