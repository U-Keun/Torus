# Torus (Tauri Desktop)

Torus is a Tauri + TypeScript desktop reimplementation of the Emacs Lisp `torus` game from the [newbiemacs project](https://github.com/jangsookim/newbiemacs).

## Features

- Emacs-style ASCII torus gameplay with animated falling tori.
- Pole movement under the box, with pick/drop mechanics.
- Three difficulties:
  - `1`: Normal
  - `2`: Half-glazed + Rotate
  - `3`: Half-glazed + Flip
- Theme switching and compact single-screen desktop layout.
- `GLOBAL TOP 10` and `PERSONAL TOP 10` scoreboard views.
- Optional online score submission (Supabase).
- Per-install UUID in Tauri backend: one online record per device, updated only when score is better.
- Local fallback cache if network/Supabase is unavailable.

## Controls

- Move: `Arrow keys` or `j/l/i/k`
- New game: `n`
- Resume: `r`
- Pause: `p`
- Reset: `q`
- Theme: `c`
- Toggle scoreboard: `s`
- Toggle key card: `h`
- Difficulty: `1/2/3`

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
4. Start the app and submit a score.

The schema includes:

- `scores.player_name` (`text`)
- `scores.client_uuid` (`text`, unique)
- `scores.score` (`integer`)
- `scores.level` (`integer`)
- `scores.created_at` (`timestamptz`)

Ranking query order is:

1. `score DESC`
2. `level DESC`
3. `created_at DESC`

Default fetch size is top 10.

## Score Submission Model

- Personal records are always stored locally.
- Online submission is optional.
- Tauri backend generates and stores a UUID at first run (`device-uuid-v1.txt` in app data dir).
- When submitting online:
  - If UUID does not exist in DB: insert.
  - If UUID exists: update only if new score is better (or same score with higher level).

This prevents duplicate online entries from the same installation.

## Build

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Mac App Store Release

### Prerequisites

- Apple Developer account
- App registered in App Store Connect
- Installed certificates:
  - `Mac App Distribution`
  - `Mac Installer Distribution`
- Provisioning profile at:
  - `src-tauri/embedded.provisionprofile`
- App Store Connect API key at:
  - `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8`

### Commands

```bash
# Preflight checks (cert/profile/API key/bundle id)
npm run mas:check

# Build signed .app for Mac App Store
npm run mas:build

# Create uploadable .pkg
npm run mas:package

# Upload to App Store Connect
APPLE_API_KEY_ID=xxxx \
APPLE_API_ISSUER=yyyy \
npm run mas:upload
```

Run all at once:

```bash
APPLE_API_KEY_ID=xxxx \
APPLE_API_ISSUER=yyyy \
npm run mas:release
```

## GitHub Actions (MAS Automation)

Workflow file: `.github/workflows/mas-release.yml`

Triggers:

- Manual: `workflow_dispatch`
- Tag push: `v*`

Required repository secrets:

- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `MAS_CERTIFICATES_P12_BASE64`
- `MAS_CERTIFICATES_P12_PASSWORD`
- `MAS_PROVISION_PROFILE_BASE64`
- `APP_STORE_CONNECT_API_KEY_P8_BASE64`

The workflow uploads `dist/Torus-macappstore.pkg` as an artifact and can upload directly to App Store Connect.

## Project Structure

- `src/main.ts`: app bootstrap and UI/event wiring
- `src/game.ts`: game loop and mechanics
- `src/scoreboard.ts`: local/global scoreboard store abstraction
- `src/ui/layout.ts`: DOM template and bindings
- `src/ui/renderer.ts`: rendering logic (playfield, HUD, cards)
- `src/ui/theme.ts`: theme handling
- `src-tauri/src/scoreboard.rs`: backend fetch/submit/cache/UUID logic
- `supabase/schema.sql`: DB schema and RLS policies

