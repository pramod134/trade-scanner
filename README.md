# Trade Scanner Dashboard (server-side scanner)

This project runs the scanner on the **server** and sends only the computed dashboard payload to the browser.

## Architecture
- `server.js` exposes `GET /api/dashboard?symbol=SPY`
- the server fetches `tick_tf` rows from Supabase
- the server runs `runScanner()` and `getHTFBias()`
- the React frontend polls the API and renders results

## Local development

```bash
npm install
cp .env.example .env
npm run dev
```

- frontend: `http://localhost:5173`
- API health: `http://localhost:3000/api/health`

## Railway deployment

Set these variables in Railway:
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional: `SCANNER_CACHE_MS`

Use:
- Build command: `npm run build`
- Start command: `npm run start`

Railway will serve the built Vite app and the API from the same service.

## Notes
- If Supabase env vars are missing, the server falls back to bundled sample rows for SPY.
- The browser no longer computes signals; it only renders the server response.
