# SimpleChat frontend

React and Vite frontend for registration, login and the chat room. See the
[root README](../../README.md) for backend and MongoDB setup.

## Run locally

Use Node.js 24 and npm. From this directory:

```bash
npm ci
npm run dev
```

Open the URL printed by Vite, normally `http://localhost:5173`. Start the backend
on port 5000 before registering or logging in.

## Chat interface (issue #11)

After login, `/chat` displays a scrollable message area, a labelled text input
and a Send button. Click Send or press Enter to add a message. Empty and
whitespace-only messages are rejected, surrounding whitespace is trimmed, and
the input clears and regains focus after submitting. Messages show “You” and a
local time; long words wrap within the message area.

Messages currently live in React state in this tab. Navigating away or
refreshing clears them. This interface does not send messages to the server or
other users. Incoming-message display is tracked in issue #13.

`src/components/Chat.jsx` owns the chat UI and local state. `src/App.jsx` keeps
the existing protected route. The client-side token-presence check is only a
navigation guard; the backend validates JWTs during the Socket.IO handshake.

## Socket.IO connection (issue #12)

Opening `/chat` connects using the installed `socket.io-client` dependency and
sends the saved login token in `auth.token`. The page announces connecting,
connected, disconnected and connection-failure states. Temporary transport
failures retry automatically without clearing the current draft. An
authentication rejection asks the user to log in again; an explicit server
disconnect asks them to refresh. Leaving chat or logging out removes the
listeners, closes the socket and cancels retries, including in React StrictMode.

Development uses Vite's `/socket.io` proxy to `http://localhost:5000` for both
HTTP polling and WebSocket upgrades. If the backend uses a different port,
update this proxy alongside the existing API proxies.

For a separate backend origin, copy `.env.example` to `.env.local` and set
`VITE_SOCKET_URL` to its URL, for example `http://localhost:5000`. The backend
must allow the frontend origin in its Socket.IO CORS configuration. Restart
Vite after changing the variable. Vite embeds this public URL at build time;
rebuild for a production change. With no override, a production deployment
must forward `/socket.io` on the page origin to the backend, including
WebSocket upgrades.

`src/hooks/useChatConnection.js` owns the connection lifecycle. Message
submission and display still use the existing local preview.

## Automated checks

```bash
cd ../backend
npm install
cd ../frontend
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

On Linux, install any missing browser system libraries with
`npx playwright install --with-deps chromium` if prompted.

Playwright starts Vite on port 5174 and a test Socket.IO server on port 5000;
keep both ports free and stop your development backend first. The tests
run in Chromium at desktop (1280 × 800) and narrow mobile (320 × 640) viewport
sizes. They cover the empty state, Send and Enter submission, blank-message
rejection, trimming, focus, timestamps, literal markup/Unicode, long words,
scrolling, repeated messages, refresh, logout and the unauthenticated route.
Connection tests cover the saved-token handshake, HTTP polling and WebSocket
proxy, pending/failed connections, authentication rejection, automatic recovery,
server disconnects, navigation/logout cleanup and cancelled retries.

The test server uses the backend's installed Socket.IO package with test-only
token checks. Tests do not require MongoDB or a running application backend,
and do not test production JWT validation, registration/login requests,
database persistence or real-time message delivery.

## Manual review

1. Start both services using the root README, register an account and log in.
2. Confirm the chat heading, “Connected to server” status, local-preview notice,
   empty state, input and Send button are visible.
3. Try empty/space-only input; Send should stay disabled.
4. Send text by clicking Send and by pressing Enter. Check ordering, sender,
   time, trimmed text and focus returning to the cleared input.
5. Try a long word, emoji and text containing HTML characters. Confirm they
   display as text and do not widen the page.
6. Send enough messages to scroll. Confirm new messages remain visible and
   the input stays outside the scrolling message area.
7. Check a narrow mobile viewport and keyboard navigation, including focusing
   and scrolling the message log. Check screen-reader announcements manually
   with your preferred screen reader.
8. Refresh to confirm local messages clear; log out and confirm `/chat`
   redirects to login.
9. Stop the backend while chat is open. Confirm a disconnected/retrying status
   appears and the page stays usable. Restart the backend and confirm the status
   returns to connected without a refresh or losing the draft.
10. Test an expired or invalid login token. Confirm the page reports a rejected
    connection and logout still works. Log in again with a valid account and
    confirm the connection succeeds.
