# Dynamicboard

Dynamicboard is a lightweight web app that lets you compose messages for a Vestaboard and send them on a timer or on demand. It supports both free‑text messages and a 22×6 grid editor, plus scheduled “event” messages that only display during a date range.

## Features

- 22×6 grid editor with quick navigation
- Auto‑format text submissions
- Scheduled messages with date ranges and yearly repeats
- Timer‑based rotation of saved messages
- One‑click “Send to Board” for any saved message
- Configurable time zone for dates, times, birthdays, and event windows
- API key stays server-side: the browser never sees it

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
- `DYNAMICBOARD_CONFIG_PATH` – alternate location for `config.json` (default: project root)

## Project Structure

- `backend/routes/` - Express route handlers and API endpoints
- `backend/services/` - Shared backend services (config storage and validation)
- `backend/utils/` - Backend utilities (logging)
- `public/` - Frontend app, static assets, manifest, and service worker
- `public/js/app.js` - Client entry module
- `public/js/ui.js`, `grid.js`, `schedule.js` - Client ES modules (toasts/logging, grid editor, scheduling)

## Configuration (`config.json`)

Add your Vestaboard **Read/Write API key** to `apiWriteKey` (the UI prompts for it, or edit the file directly).  
You can find it in the Vestaboard app under **Settings → Advanced Settings → Read/Write API**.

Key fields:

- `apiWriteKey`: Vestaboard read/write key (required). Never exposed by `GET /api`; the UI sees only `hasApiKey`.
- `isEnabled`: Enable/disable the send loop
- `timer`: Interval in milliseconds between sends (UI is in minutes)
- `timezone`: IANA time zone (e.g. `America/New_York`) used for birthdays, countdowns, `{nowTime}`/`{todayDate}`, and event windows. Empty/null falls back to the server's system zone.
- `messages`: Saved messages and event data
- `schemaVersion`: Managed by the server; used for future config migrations

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
- If a send fails (board offline, Vestaboard outage, or a hung request — sends time out after 10 s), the same message is retried on the next tick instead of being skipped.

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

- Keep your `config.json` secret; it contains your API key.
- The UI shows a warning banner if the key is missing or invalid.
- The app has no authentication: anyone on the network who can reach the port can edit messages and settings. Run it on a trusted LAN.
