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
Usage: $(basename "$0") [check|build|package|upload|all]

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

function identities_basic() {
  security find-identity -v -p basic 2>/dev/null || true
}

function detect_app_identity() {
  local ids
  local identity
  ids="$(identities_basic)"
  identity="$(echo "$ids" | sed -n 's/.*"\(Mac App Distribution:[^"]*\)"/\1/p' | head -n1)"
  if [[ -z "$identity" ]]; then
    identity="$(echo "$ids" | sed -n 's/.*"\(3rd Party Mac Developer Application:[^"]*\)"/\1/p' | head -n1)"
  fi
  if [[ -z "$identity" ]]; then
    identity="$(echo "$ids" | sed -n 's/.*"\(Apple Distribution:[^"]*\)"/\1/p' | head -n1)"
  fi
  echo "$identity"
}

function detect_installer_identity() {
  local ids
  local identity
  ids="$(identities_basic)"
  identity="$(echo "$ids" | sed -n 's/.*"\(Mac Installer Distribution:[^"]*\)"/\1/p' | head -n1)"
  if [[ -z "$identity" ]]; then
    identity="$(echo "$ids" | sed -n 's/.*"\(3rd Party Mac Developer Installer:[^"]*\)"/\1/p' | head -n1)"
  fi
  echo "$identity"
}

function resolve_identities() {
  APP_IDENTITY="${MAS_APP_IDENTITY:-$(detect_app_identity)}"
  INSTALLER_IDENTITY="${MAS_INSTALLER_IDENTITY:-$(detect_installer_identity)}"
}

function status_line() {
  local status="$1"
  local label="$2"
  local detail="${3:-}"
  if [[ -n "$detail" ]]; then
    printf "%-10s %s - %s\n" "$status" "$label" "$detail"
  else
    printf "%-10s %s\n" "$status" "$label"
  fi
}

function get_bundle_identifier() {
  node -e 'const fs=require("fs");const p=process.argv[1];const c=JSON.parse(fs.readFileSync(p,"utf8"));process.stdout.write(c.identifier||"");' \
    "$ROOT_DIR/src-tauri/tauri.conf.json" 2>/dev/null || true
}

function get_profile_field() {
  local field="$1"
  local tmp
  tmp="$(mktemp)"
  if security cms -D -i "$PROFILE_PATH" >"$tmp" 2>/dev/null; then
    /usr/libexec/PlistBuddy -c "Print :Entitlements:${field}" "$tmp" 2>/dev/null || true
  fi
  rm -f "$tmp"
}

function get_main_executable() {
  local info_plist="$APP_PATH/Contents/Info.plist"
  if [[ ! -f "$info_plist" ]]; then
    return 1
  fi
  /usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "$info_plist" 2>/dev/null || true
}

function set_plist_string() {
  local plist_path="$1"
  local key="$2"
  local value="$3"
  if /usr/libexec/PlistBuddy -c "Print :${key}" "$plist_path" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :${key} ${value}" "$plist_path"
  else
    /usr/libexec/PlistBuddy -c "Add :${key} string ${value}" "$plist_path"
  fi
}

function resign_app_with_profile_entitlements() {
  local base_entitlements="$ROOT_DIR/src-tauri/Entitlements.plist"
  local effective_entitlements="$ROOT_DIR/dist/.mas-entitlements.plist"
  local profile_app_id profile_team_id main_exec

  if [[ ! -f "$base_entitlements" ]]; then
    echo "Missing entitlements plist: $base_entitlements"
    exit 1
  fi
  if [[ ! -d "$APP_PATH" ]]; then
    echo "Built app not found: $APP_PATH"
    exit 1
  fi

  mkdir -p "$ROOT_DIR/dist"
  cp "$base_entitlements" "$effective_entitlements"

  profile_app_id="$(get_profile_field "com.apple.application-identifier")"
  profile_team_id="$(get_profile_field "com.apple.developer.team-identifier")"

  if [[ -n "$profile_app_id" ]]; then
    set_plist_string "$effective_entitlements" "com.apple.application-identifier" "$profile_app_id"
  fi
  if [[ -n "$profile_team_id" ]]; then
    set_plist_string "$effective_entitlements" "com.apple.developer.team-identifier" "$profile_team_id"
  fi

  main_exec="$(get_main_executable)"
  if [[ -z "$main_exec" ]]; then
    echo "Failed to read main executable name from $APP_PATH/Contents/Info.plist"
    exit 1
  fi

  echo "Re-signing app with effective entitlements..."
  codesign --force --sign "$APP_IDENTITY" --options runtime --entitlements "$effective_entitlements" "$APP_PATH/Contents/MacOS/$main_exec"
  codesign --force --sign "$APP_IDENTITY" --options runtime --entitlements "$effective_entitlements" "$APP_PATH"
}

function check_prerequisites() {
  local failed=0
  local bundle_id profile_app_id profile_team_id api_key_path

  echo "=== Mac App Store preflight ==="

  for tool in npm xcrun security node cargo; do
    if command -v "$tool" >/dev/null 2>&1; then
      status_line "[OK]" "tool:$tool"
    else
      status_line "[MISSING]" "tool:$tool" "install required"
      failed=1
    fi
  done

  if [[ -f "$CONFIG_PATH" ]]; then
    status_line "[OK]" "config" "$CONFIG_PATH"
  else
    status_line "[MISSING]" "config" "$CONFIG_PATH"
    failed=1
  fi

  if [[ -f "$PROFILE_PATH" ]]; then
    status_line "[OK]" "provisioning-profile" "$PROFILE_PATH"
  else
    status_line "[MISSING]" "provisioning-profile" "$PROFILE_PATH"
    failed=1
  fi

  resolve_identities
  if [[ -n "${APP_IDENTITY:-}" ]]; then
    status_line "[OK]" "mac-app-distribution-cert" "$APP_IDENTITY"
  else
    status_line "[MISSING]" "mac-app-distribution-cert" "Mac App Distribution certificate"
    failed=1
  fi

  if [[ -n "${INSTALLER_IDENTITY:-}" ]]; then
    status_line "[OK]" "mac-installer-distribution-cert" "$INSTALLER_IDENTITY"
  else
    status_line "[MISSING]" "mac-installer-distribution-cert" "Mac Installer Distribution certificate"
    failed=1
  fi

  bundle_id="$(get_bundle_identifier)"
  if [[ -n "$bundle_id" ]]; then
    status_line "[OK]" "bundle-id" "$bundle_id"
  else
    status_line "[MISSING]" "bundle-id" "src-tauri/tauri.conf.json identifier"
    failed=1
  fi

  if [[ -f "$PROFILE_PATH" ]]; then
    profile_app_id="$(get_profile_field "com.apple.application-identifier")"
    profile_team_id="$(get_profile_field "com.apple.developer.team-identifier")"
    if [[ -n "$profile_app_id" ]]; then
      status_line "[OK]" "profile-app-id" "$profile_app_id"
    else
      status_line "[WARN]" "profile-app-id" "failed to parse profile entitlements"
    fi
    if [[ -n "$profile_team_id" ]]; then
      status_line "[OK]" "profile-team-id" "$profile_team_id"
    else
      status_line "[WARN]" "profile-team-id" "failed to parse profile entitlements"
    fi

    if [[ -n "$profile_team_id" && -n "$bundle_id" && -n "$profile_app_id" ]]; then
      if [[ "$profile_app_id" == "${profile_team_id}.${bundle_id}" || "$profile_app_id" == "${profile_team_id}.*" ]]; then
        status_line "[OK]" "profile-vs-bundle-id" "matches expected identifier"
      else
        status_line "[MISMATCH]" "profile-vs-bundle-id" "expected ${profile_team_id}.${bundle_id}"
        failed=1
      fi
    fi
  fi

  if [[ -n "${APPLE_API_KEY_ID:-}" ]]; then
    api_key_path="$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY_ID}.p8"
    if [[ -f "$api_key_path" ]]; then
      status_line "[OK]" "asc-api-key-file" "$api_key_path"
    else
      status_line "[MISSING]" "asc-api-key-file" "$api_key_path"
      failed=1
    fi
  else
    status_line "[WARN]" "asc-api-key-id" "APPLE_API_KEY_ID not set (needed for upload)"
  fi

  if [[ -n "${APPLE_API_ISSUER:-}" ]]; then
    status_line "[OK]" "asc-api-issuer" "provided"
  else
    status_line "[WARN]" "asc-api-issuer" "APPLE_API_ISSUER not set (needed for upload)"
  fi

  if [[ "$failed" -eq 0 ]]; then
    echo
    echo "Preflight passed. Next:"
    echo "  npm run mas:build"
    echo "  npm run mas:package"
    echo "  APPLE_API_KEY_ID=... APPLE_API_ISSUER=... npm run mas:upload"
  else
    echo
    echo "Preflight failed. Resolve missing/mismatch items above, then run:"
    echo "  npm run mas:check"
    return 1
  fi
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
  APPLE_SIGNING_IDENTITY="$APP_IDENTITY" \
    npm run tauri build -- --bundles app --target universal-apple-darwin --config "$CONFIG_PATH" --verbose
}

function package_app() {
  precheck_package
  resign_app_with_profile_entitlements
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
  local api_key_path="$HOME/.appstoreconnect/private_keys/AuthKey_${APPLE_API_KEY_ID}.p8"
  if [[ ! -f "$api_key_path" ]]; then
    cat <<EOF
Missing App Store Connect API key file:
  $api_key_path
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
  check)
    check_prerequisites
    ;;
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
