# Torus (Tauri Desktop)

<p align="center">
  <img width="600" height="400" alt="스크린샷 2026-02-12 오전 12 28 26" src="https://github.com/user-attachments/assets/8b801e3b-4cb0-4f2b-b332-a995ba880b54" />
</p>

Torus is a Tauri + TypeScript desktop reimplementation of the Emacs Lisp `torus` game from the [newbiemacs project](https://github.com/jangsookim/newbiemacs).

## Download (Windows)

- Latest release page: [Torus Releases](https://github.com/U-Keun/Torus/releases/latest)
- Direct installer (`v1.0.1`):
  - [Torus_1.0.1_x64-setup.exe](https://github.com/U-Keun/Torus/releases/download/v1.0.1/Torus_1.0.1_x64-setup.exe)
  - [Torus_1.0.1_x64_en-US.msi](https://github.com/U-Keun/Torus/releases/download/v1.0.1/Torus_1.0.1_x64_en-US.msi)

## Features

- Emacs-style ASCII torus gameplay with animated falling tori.
- Pole movement under the box, with pick/drop mechanics.
- Three difficulties:
  - `1`: Normal
  - `2`: Half-glazed + Rotate
  - `3`: Half-glazed + Flip
- Theme switching and compact single-screen desktop layout.
- Custom one-shot `Skills` (create/run/edit/delete directional sequences, including edge-aware dynamic pair `(`/`)`).
- `GLOBAL TOP 10` and `PERSONAL TOP 10` scoreboard views.
- Click a score row (`GLOBAL`/`PERSONAL`) to slide open used skill details (skill name + command).
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
- Skills: `6`
- Toggle scoreboard: `7`
- Toggle key card: `8`
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
4. Start the app and submit a score.

The schema includes:

- `scores.player_name` (`text`)
- `scores.client_uuid` (`text`, unique)
- `scores.score` (`integer`)
- `scores.level` (`integer`)
- `scores.skill_usage` (`jsonb`, default `[]`)
- `scores.created_at` (`timestamptz`)

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
- When submitting online:
  - If UUID does not exist in DB: insert.
  - If UUID exists: update only if new score is better (or same score with higher level).

This prevents duplicate online entries from the same installation.

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
