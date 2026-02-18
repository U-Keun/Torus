# Torus (Tauri Desktop)

<p align="center">
  <img width="900" alt="Torus v1.5 Daily Challenge and badge UI" src="./docs/images/torus-v1.5-daily-badges.png" />
</p>

Torus is a Tauri + TypeScript desktop reimplementation of the Emacs Lisp `torus` game from the [newbiemacs project](https://github.com/jangsookim/newbiemacs).

## Download (macOS)

- Mac App Store: [T@rus](https://apps.apple.com/kr/app/t-rus/id6759029986?mt=12)

## Download (Windows)

- Latest release page: [Torus Releases](https://github.com/U-Keun/Torus/releases/latest)
- Direct installers are attached in each release asset list.

## Features

- Emacs-style ASCII torus gameplay with animated falling tori.
- Pole movement under the box, with pick/drop mechanics.
- Three difficulties:
  - `1`: Normal
  - `2`: Half-glazed + Rotate
  - `3`: Half-glazed + Flip
- Theme switching and compact single-screen desktop layout.
- Custom theme editor (click theme chip): adjust torus/text/glaze/glow colors, sample, and save locally.
- Custom one-shot `Skills` (create/run/edit/delete directional sequences, including edge-aware dynamic pair `(`/`)`).
- `GLOBAL TOP 10`, `DAILY CHALLENGE TOP 10`, and `PERSONAL TOP 10` scoreboard views.
- Own records are marked with `Me` tag in `GLOBAL` and `DAILY`.
- Daily streak badge system (`2^0` to `2^9`) based on successful consecutive Daily submissions (UTC, strict reset).
- Badge tooltip on hover (current streak, best streak, next badge progress).
- `GLOBAL` Top 3 trophy badges (`#1`, `#2`, `#3`) with animated highlight.
- Click a score row to slide open used skill details (skill name + command).
- Import skills from expanded `GLOBAL`/`DAILY` records directly into personal skill set.
- `Keys` card supports two pages: basic controls and current personal skill hotkeys/sequences.
- Optional online score submission (Supabase).
- Per-install UUID in Tauri backend: one online record per device, updated only when score is better.
- Local fallback cache if network/Supabase is unavailable.

## Controls

- Move: `Arrow keys` or `j/l/i/k`
- New game: `1`
- Resume: `2`
- Pause: `3`
- Reset: `4`
- Theme: `5`
- Theme custom editor: click the `Theme: ...` chip at top-right (`Apply` for preview, `Save` for persistence)
- Hover badge icon: show streak/rank details
- Skills: `6`
- Toggle scoreboard: `7`
- Key card cycle: `8` (`Page 1 -> Page 2 -> Hide -> Page 1`)
- Difficulty cycle: `9` (`1 -> 2 -> 3 -> 1`)
- Skill hotkeys: set per skill in `Skills` modal by pressing a key (duplicate registrations are blocked)

Keyboard input uses both `event.key` and `event.code`, so game controls still work in non-English IME layouts (for example Korean input mode).

## Tech Stack

- Frontend: Vite + TypeScript
- Desktop runtime: Tauri v2
- Backend commands: Rust (Tauri `invoke`)
- Online ranking: Supabase REST API (`scores` table)
- Local persistence: browser localStorage + Tauri app data cache

## Quick Start

### Requirements

- Node.js 20+
- Rust toolchain (stable)
- Tauri system prerequisites for macOS

### Install and run

```bash
npm install
cp .env.example .env
# Fill .env values
npm run tauri dev
```

### Environment variables

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY
```

If these are not set, online sync is disabled and scoreboard works in local-only mode.

## Supabase Setup

1. Create a Supabase project.
2. Open SQL Editor and run `/supabase/schema.sql`.
3. Copy project URL and anon key into `.env`.
4. Deploy Edge Function `/supabase/functions/verify-score`.
5. Set function secret `SUPABASE_SERVICE_ROLE_KEY`.
6. Start the app and submit a score.

Example:

```bash
supabase functions deploy verify-score --no-verify-jwt
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVICE_ROLE_KEY
```

### Edge Function migration note

- Edge Function names are immutable in practice. To "rename", deploy a new function name.
- Recommended rollout:
  1. Deploy `verify-score`
  2. Release client versions that call `verify-score`
  3. Keep `verify-daily-score` temporarily for older clients
  4. Remove `verify-daily-score` after old versions are no longer active

The schema includes:

- `scores.player_name` (`text`)
- `scores.client_uuid` (`text`)
- `scores.score` (`integer`)
- `scores.level` (`integer`)
- `scores.skill_usage` (`jsonb`, default `[]`)
- `scores.mode` (`text`: `classic` | `daily`)
- `scores.challenge_key` (`text`: `classic` or `YYYY-MM-DD`)
- `scores.attempts_used` (`integer`: daily only, `1..3`)
- `scores.daily_has_submission` (`boolean`: daily ranking visibility)
- `scores.active_attempt_token` (`text`: active daily attempt token)
- `scores.created_at` (`timestamptz`)
- `submit_daily_score(...)` RPC function (server-enforced daily attempts)
- `verify-score` Edge Function (server replay verification for Global and Daily)

RLS behavior:

- Direct `insert/update` on `scores` from anon/authenticated clients is blocked.
- Global/Daily writes are accepted only after Edge Function replay verification.
- `submit_global_score(...)` and `submit_daily_score(...)` RPC execute permissions are restricted to `service_role`.

### Secrets policy

- It is safe and recommended to commit `/supabase/schema.sql` and `/supabase/functions/**`.
- Never commit secrets (`SUPABASE_SERVICE_ROLE_KEY`, DB password, JWT secrets, private keys, `.env*` values).
- Keep runtime secrets only in Supabase secrets / CI secrets / local untracked env files.

Ranking query order is:

1. `score DESC`
2. `level DESC`
3. `created_at DESC`

Default fetch size is top 10.

## Score Submission Model

- Personal records are always stored locally.
- Online submission is optional.
- Submitted scores include used skill metadata (`skill_usage`).
- Tauri backend generates and stores a UUID at first run (`device-uuid-v1.txt` in app data dir).
- Classic mode online submission:
  - Uses a single row per install via `(mode='classic', challenge_key='classic', client_uuid)`.
  - If row does not exist: insert.
  - If row exists: update only if new score is better (or same score with higher level).
- Daily Challenge mode online submission:
  - Uses `(mode='daily', challenge_key=UTC date, client_uuid)`.
  - Daily runs are auto-submitted (no opt-out).
  - Server RPC enforces maximum 3 attempts per UTC day.
  - Client submits replay proof (seed + timed move log + final state).
  - Supabase Edge Function re-simulates the run and rejects mismatched score/level/time.
  - `attempts_used` increments even when score does not improve.
  - When daily best improves, that run is also auto-submitted to classic Global (same best-upsert rule).
  - Daily streak badges are computed from successful Daily submissions (strict consecutive UTC days).

This prevents duplicate classic entries and makes daily attempt limits tamper-resistant.

## Build

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Project Structure

- `src/main.ts`: app bootstrap and UI/event wiring
- `src/game.ts`: game loop and mechanics
- `src/scoreboard.ts`: local/global scoreboard store abstraction
- `src/ui/layout.ts`: DOM template and bindings
- `src/ui/renderer.ts`: rendering logic (playfield, HUD, cards)
- `src/ui/theme.ts`: theme handling
- `src-tauri/src/scoreboard.rs`: backend fetch/submit/cache/UUID logic
- `supabase/schema.sql`: DB schema and RLS policies
