#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SPEC_PATH="$ROOT_DIR/xcode/project.yml"
PROJECT_PATH="$ROOT_DIR/Torus.xcodeproj"

if ! command -v xcodegen >/dev/null 2>&1; then
  cat <<'EOF'
Missing xcodegen.
Install with:
  brew install xcodegen
EOF
  exit 1
fi

if [[ ! -f "$SPEC_PATH" ]]; then
  echo "Missing XcodeGen spec: $SPEC_PATH"
  exit 1
fi

xcodegen generate \
  --spec "$SPEC_PATH" \
  --project "$ROOT_DIR" \
  --project-root "$ROOT_DIR"

echo "Generated: $PROJECT_PATH"

if [[ "${1:-}" == "--open" ]]; then
  open "$PROJECT_PATH"
fi
