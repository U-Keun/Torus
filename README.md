# Torus (Tauri)

Emacs Lisp 기반 `torus` 게임을 Tauri + TypeScript로 이식한 데스크톱 앱입니다.

## Run

```bash
npm install
cp .env.example .env
# .env에 Supabase URL/anon key 입력
npm run tauri dev
```

## Build

```bash
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

## Xcode Project (Generated)

`Tauri` 데스크톱 앱은 기본적으로 `.xcodeproj`를 저장소에 두지 않으므로, clone 후 아래 명령으로 생성해서 사용합니다.

```bash
# 1) 한 번만 설치
brew install xcodegen

# 2) 프로젝트 생성
npm run xcodeproj:gen

# 3) 생성 + 바로 열기
npm run xcodeproj:open
```

- 생성물: `Torus.xcodeproj` (git ignore 처리됨)
- `Torus` 타깃: `npm run tauri dev`
- `TorusBuild` 타깃: `npm run tauri build`

## Controls

- 이동: `←/→/↑/↓` 또는 `j/l/i/k`
- 새 게임: `n`
- 일시정지: `p`
- 재개: `r`
- 종료(리셋): `q`
- 난이도 변경: `1`, `2`, `3`
- 테마 변경: `c`
- 스코어보드 토글: `s`

## Notes

- 스코어보드는 Supabase(`scores` 테이블) 우선 저장/조회, 실패 시 `localStorage` fallback을 사용합니다.
- Game Over 저장 시 개인 기록은 항상 로컬(`torus-personal-scores-v1`)에 저장되며, 카드의 `Personal` 버튼으로 Personal Top 10을 볼 수 있습니다.
- Emacs 버전의 핵심 규칙(폴 이동/적재, 행 멜트, 레벨업/열 증가, 난이도별 회전/뒤집기)을 반영했습니다.
- 기존 Emacs 버전의 HTTP 점수 서버(`localhost:5001`) 대신 Supabase 동기화 방식을 사용합니다.

## Supabase Setup

1. Supabase에서 새 프로젝트 생성
2. SQL Editor에서 `supabase/schema.sql` 실행
3. 프로젝트 설정에서 URL과 `anon` key 확인
4. 루트 `.env` 파일에 입력

```bash
VITE_SUPABASE_URL=https://YOUR_PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_PUBLIC_KEY
```

5. 앱 실행 후 Game Over에서 이름 저장하면 Top10이 기기 간 동기화됩니다.

## Security Notes

- 앱에는 `anon` key만 넣어야 합니다.
- `service_role` key는 절대 클라이언트에 넣지 마세요.

## Mac App Store Release

### Prerequisites

1. Apple Developer 계정 + App Store Connect 앱 생성 (`Bundle ID: com.u-keunsong.Torus`)
2. Keychain에 아래 인증서 설치
- `Mac App Distribution`
- `Mac Installer Distribution`
3. macOS App Store provisioning profile 다운로드 후 저장
- `/Users/u-keunsong/Desktop/Projects/Torus/src-tauri/embedded.provisionprofile`
4. App Store Connect API key 생성
- `APPLE_API_KEY_ID`
- `APPLE_API_ISSUER`
- `~/.appstoreconnect/private_keys/AuthKey_<KEY_ID>.p8` 배치

### Commands

```bash
# 1) App Store용 .app 빌드
npm run mas:build

# 2) App Store 업로드용 .pkg 생성
npm run mas:package

# 3) App Store Connect 업로드
APPLE_API_KEY_ID=xxxx \
APPLE_API_ISSUER=yyyy \
npm run mas:upload
```

한 번에 실행:

```bash
APPLE_API_KEY_ID=xxxx \
APPLE_API_ISSUER=yyyy \
npm run mas:release
```

## Refactor Structure

- `src/main.ts`: 앱 초기화와 이벤트 wiring
- `src/game.ts`: 게임 규칙 엔진(상태/틱 업데이트)
- `src/ui/layout.ts`: 화면 템플릿과 DOM 바인딩
- `src/ui/renderer.ts`: 게임 상태 렌더링(Box/Pole/HUD/Score list)
- `src/ui/theme.ts`: 테마 팔레트/테마 전환 로직
- `src/scoreboard.ts`: 점수 저장/검증/정렬
