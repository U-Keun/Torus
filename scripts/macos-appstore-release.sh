#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="${MAS_APP_NAME:-Torus}"
CONFIG_PATH="$ROOT_DIR/src-tauri/tauri.appstore.conf.json"
PROFILE_PATH="$ROOT_DIR/src-tauri/embedded.provisionprofile"
APP_PATH="${MAS_APP_PATH:-$ROOT_DIR/src-tauri/target/universal-apple-darwin/release/bundle/macos/${APP_NAME}.app}"
PKG_PATH="${MAS_PKG_PATH:-$ROOT_DIR/dist/${APP_NAME}-macappstore.pkg}"

function print_usage() {
  cat <<EOF
Usage: $(basename "$0") [build|package|upload|all]

Environment variables:
  MAS_APP_IDENTITY       macOS app signing identity (optional auto-detect)
  MAS_INSTALLER_IDENTITY installer signing identity (optional auto-detect)
  MAS_APP_PATH           built .app path override
  MAS_PKG_PATH           output .pkg path override
  APPLE_API_KEY_ID       App Store Connect API key ID (for upload)
  APPLE_API_ISSUER       App Store Connect API issuer ID (for upload)
EOF
}

function ensure_tools() {
  command -v npm >/dev/null || { echo "Missing npm"; exit 1; }
  command -v xcrun >/dev/null || { echo "Missing xcrun"; exit 1; }
  command -v security >/dev/null || { echo "Missing security"; exit 1; }
}

function identities() {
  security find-identity -v -p codesigning 2>/dev/null || true
}

function detect_app_identity() {
  local ids
  ids="$(identities)"
  echo "$ids" | sed -n 's/.*"\(Mac App Distribution:[^"]*\)"/\1/p' | head -n1
}

function detect_installer_identity() {
  local ids
  ids="$(identities)"
  echo "$ids" | sed -n 's/.*"\(Mac Installer Distribution:[^"]*\)"/\1/p' | head -n1
}

function resolve_identities() {
  APP_IDENTITY="${MAS_APP_IDENTITY:-$(detect_app_identity)}"
  INSTALLER_IDENTITY="${MAS_INSTALLER_IDENTITY:-$(detect_installer_identity)}"
}

function precheck_build() {
  ensure_tools
  if [[ ! -f "$CONFIG_PATH" ]]; then
    echo "Missing App Store config: $CONFIG_PATH"
    exit 1
  fi
  if [[ ! -f "$PROFILE_PATH" ]]; then
    cat <<EOF
Missing provisioning profile:
  $PROFILE_PATH

Download a macOS App Store provisioning profile from Apple Developer portal
and place it at the path above.
EOF
    exit 1
  fi
  resolve_identities
  if [[ -z "${APP_IDENTITY:-}" ]]; then
    cat <<EOF
No "Mac App Distribution" identity found.
Install a Mac App Distribution certificate in Keychain, or set MAS_APP_IDENTITY.
EOF
    exit 1
  fi
}

function precheck_package() {
  ensure_tools
  resolve_identities
  if [[ -z "${INSTALLER_IDENTITY:-}" ]]; then
    cat <<EOF
No "Mac Installer Distribution" identity found.
Install a Mac Installer Distribution certificate in Keychain, or set MAS_INSTALLER_IDENTITY.
EOF
    exit 1
  fi
  if [[ ! -d "$APP_PATH" ]]; then
    cat <<EOF
Built app not found:
  $APP_PATH

Run build first:
  npm run mas:build
EOF
    exit 1
  fi
}

function build_app() {
  precheck_build
  echo "Building App Store .app bundle..."
  npm run tauri build -- --bundles app --target universal-apple-darwin --config "$CONFIG_PATH" --verbose
}

function package_app() {
  precheck_package
  echo "Packaging .pkg for App Store Connect..."
  mkdir -p "$(dirname "$PKG_PATH")"
  rm -f "$PKG_PATH"
  xcrun productbuild \
    --sign "$INSTALLER_IDENTITY" \
    --component "$APP_PATH" /Applications \
    "$PKG_PATH"
  echo "Created: $PKG_PATH"
}

function upload_pkg() {
  ensure_tools
  command -v xcrun >/dev/null || { echo "Missing xcrun"; exit 1; }
  if [[ ! -f "$PKG_PATH" ]]; then
    cat <<EOF
PKG not found:
  $PKG_PATH

Run package first:
  npm run mas:package
EOF
    exit 1
  fi
  if [[ -z "${APPLE_API_KEY_ID:-}" || -z "${APPLE_API_ISSUER:-}" ]]; then
    cat <<EOF
Missing upload credentials.
Set these env vars:
  APPLE_API_KEY_ID
  APPLE_API_ISSUER

Also place AuthKey_<APPLE_API_KEY_ID>.p8 in:
  ~/.appstoreconnect/private_keys/
EOF
    exit 1
  fi

  echo "Uploading package to App Store Connect..."
  xcrun altool \
    --upload-app \
    --type macos \
    --file "$PKG_PATH" \
    --apiKey "$APPLE_API_KEY_ID" \
    --apiIssuer "$APPLE_API_ISSUER"
}

MODE="${1:-all}"
case "$MODE" in
  build)
    build_app
    ;;
  package)
    package_app
    ;;
  upload)
    upload_pkg
    ;;
  all)
    build_app
    package_app
    upload_pkg
    ;;
  -h|--help|help)
    print_usage
    ;;
  *)
    echo "Unknown mode: $MODE"
    print_usage
    exit 1
    ;;
esac
