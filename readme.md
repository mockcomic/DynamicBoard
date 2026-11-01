# Dynamicboard

Dynamicboard is a lightweight web app that lets you compose messages for a Vestaboard and send them on a timer or on demand. It supports both free‑text messages and a 22×6 grid editor, plus scheduled “event” messages that only display during a date range. Messages go to the board either through the Vestaboard cloud API or **directly to the board on your LAN** (Local API, no internet required).

## Features

- 22×6 grid editor with quick navigation
- Auto‑format text submissions
- Scheduled messages with date ranges and yearly repeats
- Timer‑based rotation of saved messages
- One‑click “Send to Board” for any saved message
- Cloud or local‑LAN transport, switchable in the UI
- LAN board discovery (parallel :7000 probe, `Server:` header classified — AirTunes noise filtered)
- Configurable time zone for dates, times, birthdays, and event windows
- Keys stay server-side: the browser never sees the cloud key or the board key

## Quick Start

1. Install dependencies:
   - `npm install`
2. Start the server:
   - `npm run dev` (auto‑reload) or `npm start`
3. Open the UI:
   - `http://localhost:4000`

On first run, a `config.json` file is created in the project root.

### Environment variables

- `PORT` – HTTP port (default `4000`)
- `DYNAMICBOARD_CONFIG_PATH` – alternate location for `config.json` (default: project root; beside the executable in packaged builds)
- `DYNAMICBOARD_ALLOWED_HOSTS` – comma-separated Host names/IPs accepted on `/api` in addition to `localhost` and the detected LAN IP (DNS-rebinding protection)

### Docker

`config.json` is excluded from the build context (it holds your API key). Mount it instead, e.g.:

```
docker run -p 4000:4000 -v $PWD/config:/data -e DYNAMICBOARD_CONFIG_PATH=/data/config.json dynamicboard
```

## Project Structure

- `backend/routes/` - Express route handlers and API endpoints
- `backend/services/` - Shared backend services (config storage and validation)
- `backend/utils/` - Backend utilities (logging)
- `public/` - Frontend app, static assets, manifest, and service worker
- `public/js/app.js` - Client entry module
- `public/js/ui.js`, `grid.js`, `schedule.js` - Client ES modules (toasts/logging, grid editor, scheduling)

## Configuration (`config.json`)

Key fields:

- `transport`: `"cloud"` (default) posts via `rw.vestaboard.com`; `"local"` talks to the board's Local API on port 7000 with no internet round-trip. Switch it in the UI (Settings → Board connection) or by editing the file.
- `apiWriteKey`: Vestaboard read/write key — required for cloud transport, unused in local mode. Find it in the Vestaboard app under **Settings → Advanced Settings → Read/Write API**. Never exposed by `GET /api`; the UI sees only `hasApiKey`.
- `localBoard`: `{ address, apiKey }` — the board IP/mDNS name and its permanent Local API key, for local transport. The key is a secret like the cloud one: `GET /api` shows only `hasApiKey`. You never edit it by hand: enable it from the UI (see below) and the app captures the key the board returns.
- `isEnabled`: Enable/disable the send loop
- `timer`: Interval in milliseconds between sends (UI is in minutes)
- `timezone`: IANA time zone (e.g. `America/New_York`) used for birthdays, countdowns, `{nowTime}`/`{todayDate}`, and event windows. Empty/null falls back to the server's system zone.
- `messages`: Saved messages and event data
- `schemaVersion`: Managed by the server; used for future config migrations

### Using the board directly (Local API)

1. In the Vestaboard app/site: **board settings → Local API → Enable**. Vestaboard emails a one-time **enablement token** to your account email (this proves board ownership).
2. In DynamicBoard (transport = Local): **Scan for boards** finds the board on your LAN (`POST /api/discover` probes :7000 across your /24 and keeps responders whose `Server:` header says Vestaboard), select it, paste the token, **Enable**.
3. The app exchanges the token at the board's `/local-api/enablement` endpoint; the board replies with its **permanent local key exactly once** and the app stores it in `config.json`. Re-scans and the token expiry after enable are both non-events: the key is kept forever.

Local-mode text messages are converted to the board's character codex server-side (same 22×6 grid the UI editor enforces), so unsupported characters are reported at send time rather than silently blanked.

Config writes are atomic (temp file + rename) and validated on `PUT /api` — malformed payloads are rejected with a 400 instead of corrupting the file.

## Message Functions

Functions must be wrapped with `{}`. Example:

`Christmas is in {tillDate(12,25,2025)} days!`

Multiple placeholders in a single message are all replaced.

Available:

- `tillDate(mm,dd,yyyy[,repeat])`  
  Returns the number of days until (or since) the date.
  For yearly repeating events, it automatically counts to the next yearly occurrence.
  You can also force yearly mode with `tillDate(mm,dd,yyyy,true)`.
- `birthday(name,mm,dd,yyyy,daysAhead,daysToText,dayOfText)`  
  Returns `Happy Birthday <name>!` on the birthday, otherwise a countdown while
  the birthday is within `daysAhead` days. Outside that window it returns an empty
  string. `daysToText` and `dayOfText` are optional custom templates that support
  tokens: `{name}`, `{days}`, `{dayLabel}`.
- `todayDate()`  
  Returns today’s date in `dd/mm/yyyy` format (configured time zone).
- `todayIso()`  
  Returns today’s date in `yyyy-mm-dd` format (configured time zone).
- `nowTime()`  
  Returns the current time in `HH:mm` (24-hour) format (configured time zone).

## How Scheduling Works

- Every `timer` interval, the app sends the next message in `messages`.
- If a message is marked as an **event**, it only sends when the current time (in the configured time zone) is within its date range.
- Non‑recurring events are removed after their end date passes.
- If a send fails (board offline, Vestaboard outage, or a hung request — sends time out after 10 s cloud / 5 s local), the same message is retried on the next tick instead of being skipped. A permanent rejection (4xx other than 429) skips the message so one bad payload can't stall the rotation.

## Tests

- `npm test` runs the Node built-in test runner (backend controller, config store, and HTTP API suites).

## Docker

Build and run:

- `docker build -t dynamicboard .`
- `docker run -p 4000:4000 dynamicboard`

## Build a Standalone Binary (optional)

This uses `pkg` to generate platform builds:

- `npm run build:pkg`

Outputs go to `release/`.

## Notes

- Keep your `config.json` secret; it contains your cloud API key and, in local mode, the board's local key.
- The UI shows a warning banner when the *selected transport* is not ready: cloud warns about a missing/invalid API key; local points you at scanning/selecting the board or enabling its Local API.
- The app has no authentication: anyone on the network who can reach the port can edit messages and settings. Run it on a trusted LAN.
