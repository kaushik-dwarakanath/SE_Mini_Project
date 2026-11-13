# SimpleChat frontend

React + Vite client for registration, login, the shared chat room and a read-only
account profile. See the [root README](../../README.md) for MongoDB/backend setup.

## Run locally

Use Node.js 24 and npm:

```bash
npm ci
npm run dev
```

Start the backend on port 5000 and open the Vite URL (normally port 5173).
The development proxy forwards authentication/API requests and Socket.IO
polling/WebSocket upgrades to the backend. Direct GET loads of `/login` and
`/register` serve the client app; POST requests go to Express.

For a separate socket origin, set `VITE_SOCKET_URL` in `.env.local` and allow the
frontend origin in the backend's Socket.IO CORS settings. Rebuild after changing
this public URL. Production hosting must route SPA page loads to `index.html`
and forward REST and Socket.IO traffic to the backend, including WS upgrades.

## Login and profile (#48, #54)

The navbar and protected routes share the existing `AuthProvider` session.
Successful login immediately shows Chat, Profile and Logout without a reload.
Opening `/profile` fetches `GET /api/auth/me` with the saved bearer token and
shows only the signed-in user's username and email. The page is read-only and
works after refresh. It has a loading state and reports server/network/malformed
response errors. A 401 clears the saved session and redirects to Login. Logout
also removes protected navigation and prevents reopening Profile through Back.

## Typing and messages (#47, #52)

`Chat.jsx` owns the message list, draft, typing status and inactivity timer.
`useChatConnection.js` owns the socket lifecycle, listeners and outbound events.

- Nonblank input emits `typing` once per active composing burst. Typing events
  contain only the room ID; the server supplies the authenticated sender identity.
- Clearing the input, entering only whitespace, sending or 1.5 seconds of
  inactivity emits `stop_typing`. Leaving chat closes the socket and clears the
  timer; connect/disconnect/error resets local typing state.
- Other users' statuses appear in an accessible live region. The client filters
  the current account's ID, including statuses from another tab of that account.
- Send and Enter emit the existing backend `message` event. The UI displays the
  server's `new_message` broadcast once, including its own echo, and identifies
  own messages by sender ID. JWT decoding here is for display only; the backend
  verifies tokens and sanitizes/persists messages.
- Offline submission shows an error and preserves the draft. Backend message
  errors are displayed; failed sends do not create a successful local preview.
- Incoming messages preserve the draft/focus, render as text and scroll the log.
  Connection retries preserve drafts and remove listeners/timers on departure.

## Automated checks

Install backend dependencies as well as frontend dependencies before testing.
Keep ports 5000 and 5174 free. Install Chromium once:

```bash
npx playwright install chromium
npm run lint
npm run build
npm run test:e2e -- --workers=2
npm run test:acceptance
```

Both browser suites run desktop (1280 × 800) and mobile (320 × 640) viewports.

The existing `tests/` suite uses a small isolated Socket.IO fixture to test
connection lifecycle, incoming message validation, message UI and navigation.
Its outgoing echo is an isolated UI fixture, not proof of production delivery.

The `acceptance/` suite signs in through the real REST login route, uses real JWT
validation and the production Socket.IO handlers, and drives two independent
browser sessions. Only database access is replaced by deterministic in-memory
records in `tests/fixtures/app-server.cjs`; no MongoDB is required. The shared
room journeys run sequentially to prevent cross-test message contamination.

The acceptance suite covers typing privacy/throttling, empty/idle/send cleanup,
logout/navigation/disconnect/reconnect, same-account tabs, bidirectional delivery,
offline draft retention, and profile loading/refresh/read-only/errors/401/logout.
These checks do not prove live MongoDB persistence or production hosting/TLS.

## Remaining integration work outside these assignments

The browser does not yet consume `chat_history` or `missed_messages`; message
history and reconnect catch-up remain backend-only. Presence UI is also absent.
Teammate PRs #60–#62 introduce a different shared session provider and need to
be reconciled with the existing `AuthProvider` when merged. Keep one provider
for Chat, Profile and navigation; do not layer a second session state over it.
