Extension requirements for SCTR / Starhoppers extension

Overview
- Purpose: allow a user's browser (logged-in to Citizen Hangar) to securely sync pledge/hangar data to the server, enable pairing (issuing/consuming 6-digit pair codes), and surface upload/sync status.
- Two builds supported: Chrome (CRX) and Firefox (zip). Development build should point at `http://localhost:3000`.

High-level responsibilities
 - Pairing flow (conceptual, for an AI reader)

  Concept summary
  - Actors: (1) the user's browser where the extension runs, (2) the Citizen Hangar website the user is logged into, and (3) the backend server that brokers pairing and issues a short-lived credential called an Extension Auth Token (EAT).
  - Visible artifact: the Hangar website displays a six-digit pairing code intended to prove the user controls the logged-in Hangar session.
  - Goal: transform that one-time, short-lived six-digit code into a persistent credential that the extension can use to authenticate future uploads on behalf of the user without capturing their Hangar credentials.

  High-level dataflow (conceptual)
  1. The website places a 6-digit code on a page the user can see while logged into Hangar. This code is bound server-side to a temporary PendingPair record that represents an authorization intent for a short window.
  2. The extension obtains that 6-digit code (either by explicit user copy/paste or by the user permitting the extension to read the displayed code). The code itself is only proof of access to the currently logged-in Hangar session — it is not a long-term credential.
  3. The extension sends the code to the server's pairing exchange endpoint. The server verifies the submitted code against the PendingPair record; when the code is valid and still within its lifetime, the server issues an EAT and records the binding between the EAT and the user's account.
  4. The server returns (or otherwise signals) the EAT issuance to the extension. From that point the extension holds the EAT, which represents delegated, limited authority to upload Hangar/pledge data to the server on behalf of the user.

  Why this design
  - Separation of credentials: the Hangar session (user's primary login) stays with the browser; the extension never needs the user's password. The six-digit code proves ephemeral access and converts into a scoped token (EAT) that is safer to store and revoke.
  - Minimal exposure: the code is single-use and short-lived, so interception has limited risk; the EAT can be scoped and short-lived and revoked server-side if compromise is suspected.

  Important conceptual properties
  - Source-of-truth: the server controls issuance and revocation of EATs. Any local UI state in the extension is only a representation of server-issued state. If the extension and server disagree, server state is authoritative.
  - Observable states (for UI & logic): unpaired (no code/EAT), code-obtained (extension has a code but not yet exchanged), pairing-pending (server acknowledges a PendingPair but has not yet issued an EAT), paired (EAT issued and held by the extension), and revoked/expired (EAT no longer valid).
  - Token lifecycle: EATs should be treated as revocable, limited credentials. The server can set expirations and revocation; the extension should show expiry status and allow the user to re-pair.

  Error conditions and UX implications (conceptual)
  - Expired or incorrect code: the server will reject the exchange; the extension should surface a clear message and let the user request a new code from the site.
  - Replay attempts: the PendingPair should be single-use so a code cannot be exchanged multiple times; if multiple exchanges are attempted, the server must either fail subsequent attempts or rotate/issue independent EATs depending on policy.
  - Partial flow: if the extension claims the code but cannot complete token retrieval (network/server error), the UI should indicate an intermediate pending state and allow retry.
  - Revocation/compromise: the extension must provide a user-visible revoke/forget action that both clears the local EAT and invokes any server revoke endpoint if available.

  Observability and synchronization
  - Because the server is authoritative, the extension can either receive immediate synchronous token responses from the exchange call or observe issuance via a server push mechanism (server-sent events). Either mechanism is conceptually equivalent: the extension learns when the EAT exists and updates its local state accordingly.
  - The extension's local state should be durable but not treated as the canonical record — periodically reconciling with the server (or subscribing to status updates) keeps the two sides consistent.

  Privacy and security notes (conceptual)
  - Principle of least privilege: the EAT should grant only the minimal actions needed (e.g., upload pledges, check status) and be revocable.
  - Local storage: tokens are sensitive. Conceptually they are secrets and must be kept in a storage area the extension controls and does not leak to web pages.
  - User transparency: the pairing UX must make it clear to the user that the displayed Hangar code is being converted into a stored token that permits uploads to the server and that they can revoke that access.

  Summary
  - The visible six-digit Hangar code is an ephemeral assertion of session control. The extension's role is to take that ephemeral assertion and exchange it (via the server) for a scoped, revocable credential (EAT) the extension can use to operate on behalf of the user. The server remains the authority for issuance, revocation, and the definitive state of pairing.

- Authentication & tokens
  - Do not store user account passwords. Store only the EAT and its metadata if provided by the server during pairing.
  - Treat EATs as sensitive: keep them in `storage.local` (or equivalent) and never expose them to web pages. Use extension background script to add EAT to outbound requests to the server.

- Background scraping and sync
  - Periodically (throttled) fetch the user's Hangar/pledge pages using the browser's cookie context so requests are authenticated by the user's existing Hangar session.
  - Cooldown: default minimum interval = 5 minutes between automatic syncs per-account. Implement an exponential backoff for repeated failures (e.g., 1m, 2m, 4m, up to a max like 1h), but never exceed server-side rate limits.
  - When a new sync is triggered (auto or manual), fetch the relevant Hangar pages' HTML and POST the raw HTML or structured payload to the server `POST /api/extension/pledge-upload` (or current `POST /api/extension/*` endpoints used by the server). Include the paired extension identifier / EAT in the request headers for authentication.
  - Use small batch uploads when Hangar pages are large. Retry transient failures with backoff and record failure reasons locally for debugging.

- Content script responsibilities (`content.js`)
  - Inject a small in-page messenger that only trusts configured Citizen Hangar origins.
  - Forward `window.postMessage` payloads with the agreed message types (`CITIZEN_HANGAR_EXTENSION`, `SCTR_EXTENSION`) into extension runtime messages (via `chrome.runtime.sendMessage` / `browser.runtime.sendMessage`).
  - Validate origin and expected message shape before forwarding. Never forward arbitrary messages.
  - Provide helpers for in-page pairing UX: copy pair code into a hidden input and auto-submit if the Hangar page supports it and user has explicitly permitted automation.

- Popup UI responsibilities
  - Show pairing status (paired/unpaired), the current pair code when issuing a new one, last sync time, and last sync status (success/failure + brief reason).
  - Buttons: `Create Pair Code`, `Trigger Sync Now`, `Open Logs`, `Toggle Dev Mode`.
  - Show clear instructions for manual pairing (how to paste code into the Hangar site) and an option for automated in-page pairing if the Hangar page exposes a pairing webhook or messenger.

- Messaging & events
  - Background ↔ Popup: use `chrome.runtime` messaging for commands and responses.
  - Content script ↔ Background: use `chrome.runtime` messaging to forward in-page events (pairing confirmation, user actions) to the background script.
  - Server SSE: subscribe to `GET /extension/status-stream` (EventSource) when connected to the server to receive live updates about pending pair status and pledge processing results. Reconnect with backoff on disconnect.

Security and privacy
- Only request host permissions necessary for the Hangar domain(s) and the server base URL(s). Avoid wildcards when possible (list explicit origins).
- Use `storage.local` for sensitive tokens (EAT). Do not expose them to content scripts or web pages. If content script must request an action that requires the EAT, forward the request to the background script which signs the request.
- Validate all inbound messages (origin, structure) before acting on them.
- Provide a user-visible option to clear stored tokens and logs (Revoke pairing from the popup should call server revoke endpoint if available and clear local storage).

Dev mode and configuration
- Default production server base URL: https://citizenhangar.space. Dev mode: `http://localhost:3000`.
- Add a `dev` toggle in the popup; persist the toggle in `storage.local` and make the background/requests use the selected base URL.
- Logging: store recent logs in `storage.local` with a bounded size (e.g., 1MB total, rotate older entries). The popup should display these logs for debugging.
- Build scripts: `sctr-extension/build.bat` used to package Chrome (requires `chrome.pem` and a Chrome binary). Firefox build is produced as a zipped folder.

Permissions (minimum recommended)
- `storage` — persist pairing state, tokens, logs, and dev flags.
- `cookies` — read cookies if needed to validate session; prefer performing requests in the background using the browser's fetch with credentials instead of reading cookies directly.
- Host permissions for Citizen Hangar origin(s) — allow fetching Hangar pages.
- Host permissions for server base URL(s) — allow contacting API endpoints.
- `activeTab` (optional) — for user-initiated actions that require temporary page access.

Operational notes
- Throttle and coordinate syncs per-account to avoid causing high load on Hangar or the server.
- Keep server interactions idempotent: include a client-generated sync id/timestamp so the server can deduplicate.
- On upload success, consume SSE messages to show parsed results and any server-side warnings.

Edge cases and error handling
- If the Hangar session is expired, surface a clear message instructing the user to re-login to Hangar in their browser.
- If pairing exchange fails (invalid/expired code), allow re-issuing a pair code and show clear guidance to the user.
- If EAT expires, attempt automated refresh only if the server supports it; otherwise prompt the user to re-pair.

Developer checklist for recoding
- Implement secure messaging boundaries between page and extension.
- Implement background periodic fetch with cooldown and backoff.
- Implement pairing UI + server exchange flow exactly as described.
- Implement SSE subscription to `/extension/status-stream` and surface statuses in the popup.
- Add dev toggle for `http://localhost:3000` and test end-to-end with local server.

Useful server endpoints (implementations expected server-side)
- `POST /extension/api/create-pair` — create a 6-digit pairing code (PendingPair record).
- `POST /api/extension/pair` — exchange code for EAT (server-side token issuance).
- `POST /api/extension/pledge-upload` (or existing `POST /api/extension/*`) — upload Hangar HTML / pledge payloads.
- `GET /extension/status-stream` — SSE stream for status updates about pairing and pledge processing.

If anything in this document needs to be clarified or expanded (message schemas, exact request/response shapes, or sample payloads), tell me which area and I'll add machine-readable examples and sample code snippets.
