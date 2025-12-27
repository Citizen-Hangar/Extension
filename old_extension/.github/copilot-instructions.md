<!-- Project Copilot instructions (updated for BEPP) -->

# Quick orientation — BEPP prep
- This repo uses a single canonical `extension/` webextension folder (cross-browser) used as the source-of-truth for packaging to multiple browsers. When adding features, edit `extension/` and keep any per-platform overrides minimal.
- Packaging: local packaging is still handled by `build.bat` (Windows) for legacy workflows. CI packaging should use the workflow template at `.github/workflows/bepp.yml` which now calls `ci/bepp.sh` to produce zips for Chromium-family browsers and a Firefox XPI via `web-ext`.

BEPP / CI notes (what an agent should know)
- Secrets expected in CI: `BEPP_API_KEY` (BEPP service), `CHROME_PEM_BASE64` (base64-encoded `chrome.pem` if you need legacy CRX signing), `FIREFOX_API_TOKEN` (if uploading to addons.mozilla.org).
- Artifacts: CI produces `dist/*.xpi` and `dist/*.zip`. BEPP or the release step should pick those up for signing/upload.
- Chrome packaging: `chrome/` is MV3 and should be packaged for Chromium. The repo's `build.bat` historically used `chrome.exe --pack-extension` locally; CI cannot use `chrome.exe`. Recommended options:
  - Use BEPP CLI to sign and publish artifacts in CI (preferred if using BEPP service).
  - Decode `CHROME_PEM_BASE64` into `chrome.pem` and use a Node CRX packer (CRX3) if you need a `.crx` artifact.
  - Alternatively publish to Chrome Web Store via upload API (requires separate secrets).

Practical rules for edits
- Base edits on the canonical webextension in `extension/`: `extension/manifest.json`, `extension/background.js`, `extension/content.js`, `extension/popup.js` are authoritative. Platform folders (`chrome/`, `firefox/`) may continue to exist for historical reasons but should be synchronized from `extension/` when needed.
- Keep these storage keys and message action names intact: `eat`, `lastSync`, `devMode`, `debugEnabled`, `__sctr_logs`; actions: `pair`, `manual-sync`, `initial-sync`, `get-status`, `set-settings`, `revoke`, `clear-logs`.
- When modifying network behavior, preserve the `postToServer` error shapes (`network_error`, `http_error`, `parse_error`, `internal_error`) because the popup expects them.

How to use the CI workflow template
- The workflow `.github/workflows/bepp.yml` does three things: checkout, builds a Firefox XPI using `web-ext`, zips `chrome/`, and uploads `dist` as artifacts. The final BEPP/release step is a placeholder — replace it with your BEPP CLI invocation or another uploader.
- To wire BEPP in CI:
  - Add `BEPP_API_KEY` to GitHub Secrets.
  - Add `CHROME_PEM_BASE64` as a secret (store the PEM file base64-encoded) if you need CRX signing. The workflow decodes it to `chrome.pem` before packaging.
  - Add `FIREFOX_API_TOKEN` if you plan to sign/upload to addons.mozilla.org (or use `web-ext sign`).

If you want, I can:
- Scaffold the concrete BEPP invocation in the workflow (need confirmation how you plan to sign/publish Chrome: CRX signed with `chrome.pem`/CRX3 or Web Store upload).
- Add a small `ci/` helper script to decode secrets and run signing commands (decode `CHROME_PEM_BASE64`, pack CRX, and/or upload via provided CLI).

Browser support notes
- Supported by current packaging: Chromium-family (Chrome, Chromium, Brave, Edge, Opera, Opera GX, Yandex) via zips; Firefox via `web-ext` XPI.
- Safari: Safari requires Xcode/macOS and Apple Developer program membership to convert the webextension into a Safari App Extension and notarize it. The CI produces a webextension zip for reference but cannot produce a signed Safari extension without macOS/Xcode and Apple credentials.

Ask me to implement one of the above and I'll make the change.
