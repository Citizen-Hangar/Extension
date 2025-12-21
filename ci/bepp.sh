#!/usr/bin/env bash
set -euo pipefail

# ci/bepp.sh — helper to build extension artifacts for local dev and CI
# - Packages chrome/ as zip
# - Builds firefox XPI via web-ext (if available)
# - Optionally decodes CHROME_PEM_BASE64 to chrome.pem for legacy CRX packing
# - Optionally invokes `bepp` CLI when BEPP_API_KEY is present


ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

DIST_DIR="$ROOT_DIR/dist"
mkdir -p "$DIST_DIR"

SRC_DIR="$ROOT_DIR/extension"
TMP_DIR="$ROOT_DIR/.tmp_build"
sanitize_manifest() {
  local manifest_path="$1/manifest.json"
  if [ ! -f "$manifest_path" ]; then
  echo "[bepp.sh] manifest.json not found in $1; skipping sanitize"
  return 0
  fi
  echo "[bepp.sh] Sanitizing manifest for production (removing localhost/127.0.0.1 entries)"
    # call python and pass the directory as argument to avoid argv indexing errors
    python3 - "$1" <<'PY'
  import json,sys,os
  dirpath = sys.argv[1]
  p = os.path.join(dirpath,'manifest.json')
  with open(p,'r',encoding='utf-8') as f:
    m = json.load(f)

  def keep_host(h):
    if not isinstance(h,str):
      return False
    return ('localhost' not in h) and ('127.0.0.1' not in h)

  # sanitize host_permissions
  if isinstance(m.get('host_permissions'), list):
    new_hosts = [h for h in m['host_permissions'] if keep_host(h)]
    if new_hosts:
      m['host_permissions'] = new_hosts
    else:
      m.pop('host_permissions', None)

  # sanitize content_scripts matches
  if isinstance(m.get('content_scripts'), list):
    new_cs = []
    for cs in m['content_scripts']:
      matches = cs.get('matches', [])
      if not isinstance(matches, list):
        continue
      filtered = [m0 for m0 in matches if keep_host(m0) and m0 not in ('*://localhost/*','*://127.0.0.1/*')]
      if filtered:
        cs['matches'] = filtered
        new_cs.append(cs)
    if new_cs:
      m['content_scripts'] = new_cs
    else:
      m.pop('content_scripts', None)

  with open(p,'w',encoding='utf-8') as f:
    json.dump(m,f,indent=2,ensure_ascii=False)
PY
}
if [ ! -d "$SRC_DIR" ]; then
  echo "[bepp.sh] error: extension/ directory not found"
  exit 1
fi

echo "[bepp.sh] Packaging webextension from extension/ (canonical source)..."
# prepare temp build dir and sanitize manifest for CI/production
rm -rf "$TMP_DIR" || true
mkdir -p "$TMP_DIR"
cp -R "$SRC_DIR/"* "$TMP_DIR/"
sanitize_manifest "$TMP_DIR"
if command -v zip >/dev/null 2>&1; then
  (cd "$TMP_DIR" && zip -r "$DIST_DIR/citizen-hangar-webextension.zip" .) >/dev/null
  echo "[bepp.sh] webextension zip -> $DIST_DIR/citizen-hangar-webextension.zip"
else
  echo "[bepp.sh] zip not available; skipping webextension zip (install zip to enable)"
fi

echo "[bepp.sh] Creating per-browser zips (Chromium-family, Brave, Edge, Opera, Yandex)..."
if command -v zip >/dev/null 2>&1; then
  (cd "$TMP_DIR" && zip -r "$DIST_DIR/citizen-hangar-chromium.zip" .) >/dev/null
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-chrome.zip" 2>/dev/null || true
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-brave.zip" 2>/dev/null || true
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-edge.zip" 2>/dev/null || true
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-opera.zip" 2>/dev/null || true
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-opera-gx.zip" 2>/dev/null || true
  cp "$DIST_DIR/citizen-hangar-chromium.zip" "$DIST_DIR/citizen-hangar-yandex.zip" 2>/dev/null || true
fi

echo "[bepp.sh] Building Firefox XPI with web-ext (if available)..."
if command -v web-ext >/dev/null 2>&1; then
  web-ext build --source-dir "$TMP_DIR" --overwrite-dest --artifacts-dir "$DIST_DIR"
  echo "[bepp.sh] web-ext build finished; artifacts in $DIST_DIR"
else
  echo "[bepp.sh] web-ext not installed; skipping XPI build. Install with: npm install --global web-ext"
fi

echo "[bepp.sh] Preparing Safari / Apple notes"
echo "[bepp.sh] Safari requires conversion to a Safari App Extension (Xcode). We produce a webextension zip but Safari packaging must be done on macOS with Xcode and Apple Developer account."

if [ -n "${CHROME_PEM_BASE64-}" ]; then
  echo "[bepp.sh] Decoding CHROME_PEM_BASE64 to chrome.pem"
  echo "$CHROME_PEM_BASE64" | base64 -d > "$ROOT_DIR/chrome.pem"
  echo "[bepp.sh] chrome.pem written (keep it secure)."

  echo "[bepp.sh] (Optional) If you need a CRX, install a CRX packer and run it against the webextension zip."
fi

if [ -n "${BEPP_API_KEY-}" ]; then
  if command -v bepp >/dev/null 2>&1; then
    echo "[bepp.sh] BEPP_API_KEY present and bepp CLI found — running BEPP publish (dry-run)"
    bepp publish --api-key "$BEPP_API_KEY" --artifacts "$DIST_DIR" || true
  else
    echo "[bepp.sh] BEPP_API_KEY present but bepp CLI not found. Install BEPP CLI or run locally."
  fi
fi

echo "[bepp.sh] Done. Artifacts:"
ls -la "$DIST_DIR" || true
rm -rf "$TMP_DIR" || true
