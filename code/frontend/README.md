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
other users. Socket.IO connection and incoming-message handling are tracked in
issues #12 and #13.

`src/components/Chat.jsx` owns the chat UI and local state. `src/App.jsx` keeps
the existing protected route. The client-side token-presence check is only a
navigation guard; server authentication must still validate JWTs when the
Socket.IO integration is added.

## Automated checks

```bash
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

On Linux, install any missing browser system libraries with
`npx playwright install --with-deps chromium` if prompted.

Playwright starts Vite on port 5174 automatically; keep that port free. The tests
run in Chromium at desktop (1280 × 800) and narrow mobile (320 × 640) viewport
sizes. They cover the empty state, Send and Enter submission, blank-message
rejection, trimming, focus, timestamps, literal markup/Unicode, long words,
scrolling, repeated messages, refresh, logout and the unauthenticated route.

Tests set a dummy token to exercise the existing client-side route guard.
They do not require MongoDB or a running backend, and do not test JWT validity,
registration/login requests, database persistence or real-time delivery.

## Manual review

1. Start both services using the root README, register an account and log in.
2. Confirm the chat heading, local-preview notice, empty state, input and Send
   button are visible.
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
