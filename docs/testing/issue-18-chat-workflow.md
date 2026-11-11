# Test report: basic chat application workflow (issue #18)

| Item | Detail |
| --- | --- |
| Sprint | Sprint 2 |
| Story | As a developer, I want to test the complete chat workflow so that registration, login and messaging work together. |
| Test cases (STP) | TC-AUTH-01 (registration), TC-AUTH-03 (login), TC-ROOM-01 (join shared room), TC-MSG-02 (message broadcast), TC-HIST-01 (message persistence), TC-UX-01 (registration to first message) |
| Requirements | FR-001, FR-002, FR-004, FR-006, FR-010, FR-011, SEC-001, SEC-002 |
| Test levels | System test (automated) and a manual walkthrough in the browser |
| Automated test | `code/backend/tests/chatWorkflow.system.test.js` |
| Regression test | `code/frontend/tests/page-loads.spec.js` |
| Defects | [`defect-log.md`](defect-log.md) |

## 1. Automated system test

The test runs the whole backend with nothing mocked: the Express app
(`createApp` in `code/backend/app.js`) and the Socket.IO server
(`createSocketServer`) share one HTTP server, with a real MongoDB server from
`mongodb-memory-server`. Requests go over HTTP with `fetch`, and chat traffic
goes over WebSockets with `socket.io-client`, as in the browser.

The steps run in order like one user session:

| Step | Action | Expected result |
| --- | --- | --- |
| 1 | `GET /api/health` | 200 OK |
| 2 | Register alice and bob | 201; email stored in lowercase; password stored as a bcrypt hash (cost 12), not plaintext |
| 3 | Register alice again | 409; still two users |
| 4 | Log in with a wrong password | 401, generic message, no token |
| 5 | Log in: alice by username, bob by email in mixed case | 200 with a JWT for each |
| 6 | Join the chat without a token | Rejected: "Authentication required" |
| 7 | Both users join the chat with their tokens | Both are in the `general` room and receive an empty history |
| 8 | alice sends a message | bob receives it with alice's username |
| 9 | bob replies | alice receives it |
| 10 | alice sends spaces only | Rejected; still two messages stored |
| 11 | Check MongoDB | Both messages stored in order, with sender, room and time |
| 12 | `GET /api/messages/general` | 401 without a token; with bob's token, the conversation in order |
| 13 | alice disconnects, logs in again by email and rejoins | Her initial history contains the earlier conversation |
| 14 | Exchange two more messages | Both users receive both, in order; four messages stored |

To make this possible, the Express setup was moved from `server.js` into
`app.js` (`createApp`). `server.js` builds the same app, so routes and
behaviour are unchanged.

### Running it

```bash
cd code/backend
npm install
npx jest tests/chatWorkflow.system.test.js
```

The first run downloads a MongoDB server binary for `mongodb-memory-server`
(about 140 MB on macOS arm64), cached in `node_modules/.cache`. No local MongoDB or `.env` file is needed.

The test passes `runtimeAdapters: { os }` to `mongoose.connect`. MongoDB
driver 7 loads the `os` module with a dynamic `import()`, which Jest's module
sandbox does not allow. Without this option the handshake fails with
"Missing required sub-document 'driver' in the client metadata document".
Only the test needs the option; `server.js` connects normally.

## 2. Manual walkthrough

Environment: backend `server.js` with an in-memory MongoDB, the Vite dev
server and Chromium, 11 November 2026. Two test accounts were used: user A in
the browser, and user B as a Socket.IO client logged in through the API.

| # | Step | Result |
| --- | --- | --- |
| 1 | Open `/register` directly | **Failed:** backend 404 page → D-02 (fixed below) |
| 2 | Open `/` and follow the Register link | Registration form shown |
| 3 | Register user A | "Account created successfully. You can now log in." |
| 4 | Log in as user A | Redirected to `/chat`; navbar shows Chat and Logout; status "Connected to server." |
| 5 | User B sends "Hello from Bob" | Appears in user A's chat at once, with user B's username |
| 6 | User A sends a message from the browser | Shown in user A's tab only; **user B never received it** → D-01 |
| 7 | Refresh `/chat` | Still connected, but the message list is empty although the messages are stored → D-03 |
| 8 | Log out | Redirected to Login; token removed |

After the D-02 fix, step 1 was repeated: `/login` and `/register` load
directly and after a refresh, and login and registration requests still reach
the backend.

## 3. Results

| Check | Result |
| --- | --- |
| `chatWorkflow.system.test.js` | 14 passed (three runs) |
| Backend suite (`npm test`) | 13 suites, 131 tests passed |
| `page-loads.spec.js` | 8 passed (desktop and mobile); 8 failed with the old `vite.config.js`, confirming it catches D-02 |
| Frontend suite (`npm run test:e2e`) | 50 passed, 2 failed. Both failures are D-06, which already failed on `main` on macOS. |
| `npm run lint`, `npm run build` | Passed |

## 4. Conclusion against the acceptance criteria

- **"The basic workflow works from login to message exchange."** The backend
  works end to end: registration, login, joining the room, two-way
  messaging, persistence and history all pass with a real database. In the
  web client, users can register, log in, join and receive messages, but
  cannot send them (D-01).
- **"Critical bugs are fixed or documented."** D-01 is Critical and is
  documented in the defect log, with steps, cause and a recommended fix. It
  needs a separate story because sending messages from the client was planned
  as separate work. D-02 (Serious) was fixed and has regression tests. D-03 to
  D-06 are documented.
