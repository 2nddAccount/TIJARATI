# Tijarati

Tijarati is a small bookkeeping app (sales, purchases, debts/credit book, reminders, partners profit split) with a modern Web UI that is packaged inside a React Native (Expo) shell via `WebView`.

## Repo layout

- `index.html` — **source of the in-app Web UI** (state, i18n, UI, logic).
- `bundler.js` — bundles `index.html` into the mobile asset.
- `mobile/` — Expo React Native wrapper app (SQLite persistence, notifications, file/share bridge).
- `public/` — older web assets (not the current in-app UI source).
- `server/` and `backend/` — Node.js server folders (used for non-mobile deployments / experiments).

## Development

### 1) Build the mobile Web UI bundle

The mobile app loads a generated bundle at `mobile/assets/frontend_bundle.js`.

From repo root:

```bash
node bundler.js
```

### 2) Run the mobile app (Expo)

```bash
cd mobile
npm install
npx expo start
```

Notes:
- Debt reminders and “Download/Share” are handled through the native bridge in `mobile/App.js`.
- SQLite database file is stored on-device (`tijarati.db`).

## Scripts

- `start_app.bat` — helper script to start (Windows).

## Languages

UI supports Darija, Arabic, French, and English. Translations live in `index.html` (the `translations` object).

## GitHub hygiene

This repo includes a root `.gitignore` to avoid committing build outputs (`**/build/`), `node_modules/`, and local env files.
