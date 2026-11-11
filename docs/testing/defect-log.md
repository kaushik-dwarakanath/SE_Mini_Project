# Defect log

Defects found during testing, classified using the severity scale in the
Software Test Plan (Critical, Serious, Medium, Low). A **Critical** defect
blocks a core feature (login, room join, messaging) or exposes a security
vulnerability, with no workaround.

| ID | Found in | Severity | Status | Summary |
| --- | --- | --- | --- | --- |
| D-01 | #18 | Critical | Open | The chat page does not send messages to the server |
| D-02 | #18 | Serious | Fixed in #18 | Opening or refreshing `/login` or `/register` in development returns a 404 |
| D-03 | #18 | Medium | Open | Chat history is not shown after joining or refreshing |
| D-04 | #18 | Low | Open, planned in #49 | Login reloads the whole page to update the navigation bar |
| D-05 | #18 | Low | Open (environment) | Port 5000 clashes with macOS AirPlay Receiver |
| D-06 | #18 | Low | Open (test) | One chat layout test fails on macOS because of a Windows/Linux-only shortcut |

## D-01 — The chat page does not send messages to the server (Critical)

- **Steps:** Log in as user A in the browser and open Chat. Connect user B
  (a second browser or a Socket.IO client) to the same backend. User A types
  a message and presses Enter.
- **Expected:** The message reaches user B and is saved in MongoDB (FR-006,
  TC-MSG-02).
- **Actual:** The message appears only in user A's tab, labelled "You".
  User B receives nothing and nothing is saved. Messages from user B do
  appear for user A.
- **Cause:** `Chat.jsx` `handleSubmit` adds the message to local React state
  only (marked "Messages stay local until message delivery is integrated
  separately"). The client never emits the `message` event.
- **Impact:** Users cannot send messages from the web client, which blocks
  the acceptance workflow from login to message exchange. The backend side
  works: `code/backend/tests/chatWorkflow.system.test.js` shows two clients
  exchanging messages through the real server and database.
- **Recommendation:** Create an issue for the real-time messaging owner. Emit
  `message` with `{ text }` from the chat form, show sent messages from the
  `new_message` broadcast instead of the local preview, and show
  `message_error` to the user. Then update the local-preview tests in
  `chat.spec.js`.

## D-02 — `/login` and `/register` 404 on direct load or refresh (Serious, fixed)

- **Steps:** Start the backend and `npm run dev`. Open
  `http://localhost:5173/login` directly, or refresh the page while on Login
  or Register.
- **Expected:** The Login or Register page.
- **Actual:** The backend's 404 page ("Cannot GET /login").
- **Cause:** `vite.config.js` proxies every request for `/login` and
  `/register` to the backend, including browser page loads. The backend only
  defines `POST` routes for these paths.
- **Fix (#18):** Page loads (`GET` requests that accept HTML) are now served
  the app's `index.html`. API calls are still proxied. Regression tests:
  `code/frontend/tests/page-loads.spec.js`, which fail without the fix and
  pass with it.
- **Note:** A production deployment that serves the frontend and backend on
  one origin needs the same rule: send HTML page loads to the frontend and
  `POST` requests to the backend.

## D-03 — Chat history is not shown (Medium)

- **Steps:** Exchange messages, then refresh `/chat` or log in again.
- **Expected:** The last messages of the shared room are shown (FR-013,
  TC-HIST-02).
- **Actual:** The message list is empty. The server sends `chat_history`
  on connect, but the client does not listen for it.
- **Note:** The issue #13 notes already list loading `chat_history` as
  separate work. The backend part is covered by step 13 of the workflow test.

## D-04 — Login reloads the page to update the navigation bar (Low)

- **Actual:** After a successful login, `Login` calls
  `window.location.reload()`, because the navbar keeps its own copy of the
  login state.
- **Impact:** A full page reload after every login. It works, but it is
  slower and hides the state-sharing problem.
- **Plan:** Issue #49 replaces this with one shared session state.

## D-05 — Port 5000 clashes with macOS AirPlay Receiver (Low, environment)

- **Actual:** On macOS 12 and later, AirPlay Receiver listens on port 5000.
  `npm start` fails with `EADDRINUSE`, and Playwright stops with
  "http://127.0.0.1:5000/api/health is already used". The Vite proxy target
  `localhost:5000` can also resolve to `::1`, where AirPlay answers with 403.
- **Workaround:** Turn off AirPlay Receiver (System Settings → General →
  AirDrop & Handoff), or run the backend on another port and update the Vite
  proxy to match, as the root README describes.

## D-06 — Chat layout test fails on macOS (Low, test)

- **Test:** `chat.spec.js` › "wraps long words without horizontal overflow
  and scrolls to new messages" (desktop and mobile).
- **Actual:** On macOS the test presses `Control+Home` to scroll the message
  log to the top. That shortcut does not scroll on macOS, so the
  `scrollTop` assertion fails. The test passes on Windows and Linux.
- **Note:** This failure was present on `main` before any Sprint 2 testing
  changes. To work on every platform, the test could set `scrollTop`
  directly, or choose the shortcut based on the operating system.
