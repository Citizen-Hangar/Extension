ci/ — BEPP dev helpers

Files
- `bepp.sh` — Linux/CI helper to package `chrome/` (zip), build Firefox XPI via `web-ext`, decode `CHROME_PEM_BASE64` to `chrome.pem`, and optionally invoke `bepp` CLI when `BEPP_API_KEY` is present.
- `bepp.ps1` — Windows PowerShell equivalent for local dev.

Usage (CI)
 - Ensure `web-ext` is available in CI (`npm install --global web-ext`) or allow the script to skip XPI build.
 - Provide secrets in CI as necessary: `CHROME_PEM_BASE64`, `BEPP_API_KEY`, `FIREFOX_API_TOKEN`.
 - The GitHub Actions workflow calls `ci/bepp.sh` and uploads `dist/` artifacts.

Usage (local dev)
 - On Linux/macOS: `./ci/bepp.sh` (requires `zip` and optionally `web-ext`).
 - On Windows PowerShell: `.\ci\bepp.ps1`.

Notes
 - The scripts are intentionally conservative: they do not automatically publish unless `bepp` CLI is present and `BEPP_API_KEY` is set. Adapt the `bepp publish` command to your BEPP usage.
 - Keep `chrome.pem` and any private secrets out of the repository. Use CI secrets (e.g., `CHROME_PEM_BASE64`).
