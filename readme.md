# Dynamicboard

Dynamicboard is a lightweight web app that lets you compose messages for a Vestaboard and send them on a timer or on demand. It supports both free‑text messages and a 22×6 grid editor, plus scheduled “event” messages that only display during a date range.

## Features

- 22×6 grid editor with quick navigation
- Auto‑format text submissions
- Scheduled messages with date ranges and yearly repeats
- Timer‑based rotation of saved messages
- One‑click “Send to Board” for any saved message

## Quick Start

1. Install dependencies:
   - `npm install`
2. Start the server:
   - `npm run dev` (auto‑reload) or `npm start`
3. Open the UI:
   - `http://localhost:4000`

On first run, a `config.json` file is created in the project root.

## Project Structure

- `backend/routes/` - Express route handlers and API endpoints
- `backend/services/` - Shared backend services (for example config storage)
- `backend/utils/` - Backend utilities (logging)
- `public/` - Frontend app, static assets, manifest, and service worker
- `public/js/app.js` - Main client-side application script

## Configuration (`config.json`)

Add your Vestaboard **Read/Write API key** to `apiWriteKey`.  
You can find it in the Vestaboard app under **Settings → Advanced Settings → Read/Write API**.

Key fields:

- `apiWriteKey`: Vestaboard read/write key (required)
- `isEnabled`: Enable/disable the send loop
- `timer`: Interval in milliseconds between sends (UI is in minutes)
- `messages`: Saved messages and event data

## Message Functions

Functions must be wrapped with `{}`. Example:

`Christmas is in {tillDate(12,25,2025)} days!`

Available:

- `tillDate(mm,dd,yyyy)`  
  Returns the number of days until (or since) the date.
- `todayDate()`  
  Returns today’s date in `mm,dd,yyyy` format.
- `todayIso()`  
  Returns today’s date in `yyyy-mm-dd` format.
- `nowTime()`  
  Returns current local time in `HH:mm` (24-hour) format.

## How Scheduling Works

- Every `timer` interval, the app sends the next message in `messages`.
- If a message is marked as an **event**, it only sends when the current time is within its date range.
- Non‑recurring events are removed after their end date passes.

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
