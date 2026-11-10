# SimpleChat frontend

React/Vite interface for registration, login, people search and encrypted private conversations. Follow the [root README](../../README.md) for MongoDB, backend setup and HTTPS access from different devices.

```bash
npm ci
npm run dev
```

Open http://localhost:5173 with the backend running on port 5000. All API requests use `/api`; Socket.IO uses the same origin through the Vite proxy. Optional `API_PROXY_TARGET` changes the backend target.

After login, choose another registered username. Send with the button or Enter. Empty messages are rejected; failed sends retain the draft. History loads from MongoDB, with older messages available in pages. The same account can unlock its history on another device with its password. Refresh intentionally returns to login because session tokens and decrypted keys remain only in memory.

The UI preserves keyboard labels, literal text rendering, Unicode, long-word wrapping, independent conversation scrolling and a narrow-screen people/conversation switch. Safety numbers and remembered public keys support manual key verification.

## Checks

```bash
npm run build
npx playwright install chromium
npm run test:e2e
```

Install backend development dependencies first. Playwright starts the real backend on port 5001 with an isolated temporary MongoDB and Vite on 5174. No existing database or credentials are used. Tests cover desktop and 320px mobile layouts, independent users and devices, reconnect recovery, persistent encrypted history, access protection, registration, logout and a lost-response retry.

Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to use an installed Chrome/Chromium binary instead of Playwright's downloaded browser. The initial MongoDB binary download also needs network access.

See [SECURITY.md](../../SECURITY.md) for the cryptography design and limits. HTTPS is necessary on other devices; plain LAN HTTP cannot provide the required Web Crypto APIs.
