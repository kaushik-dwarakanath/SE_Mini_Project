# Test report: Socket.IO connections (issue #16)

| Item | Detail |
| --- | --- |
| Sprint | Sprint 2 |
| Story | As a developer, I want to test socket connections so that users can connect to the chat server reliably. |
| Test cases (STP) | TC-MSG-01 (persistent socket connection), TC-SEC-02 (token required), TC-SEC-04 (invalid/expired tokens rejected), TC-SEC-06 (unauthorized socket attempts logged) |
| Requirements | FR-004, FR-005, NFR-004, SEC-002, SEC-004, SEC-006 |
| Test level | Integration (real Socket.IO server and real `socket.io-client` clients over TCP) |
| Test file | `code/backend/tests/socketConnection.integration.test.js` |
| Helpers | `code/backend/tests/helpers/socketTestServer.js` |

## What is under test

The tests start the same Socket.IO server the application uses
(`createSocketServer` in `code/backend/sockets/index.js`, which wires
`socketAuth` and the chat handlers) on a random local port. Clients connect
through the network with `socket.io-client`, exactly as the browser does.

Only the database layer is replaced: the `User` model and the message service
are Jest mocks, so the suite runs without MongoDB. JWTs are real tokens signed
and verified by `tokenService`.

To make this possible, the Socket.IO setup was moved out of `server.js` into
`createSocketServer(httpServer)`. `server.js` calls it with the same CORS
settings as before, so runtime behaviour is unchanged.

## Test cases

### Successful connection

| # | Scenario | Expected result |
| --- | --- | --- |
| 1 | Connect with a valid token | Client connects, receives `chat_history`, and the server socket carries the user's id and username and is in the `general` room |
| 2 | Connection logging | One `SOCKET_CONNECTED` entry with the username and socket id; no warnings |
| 3 | HTTP long-polling only | Connects over polling |
| 4 | Default transports | Starts on polling and upgrades to WebSocket |
| 5 | Several users at once | Each client gets its own socket; all are in the shared room |
| 6 | History cannot be loaded | Client gets `message_error` "Could not load chat history" and stays connected |

### Connection failures

| # | Scenario | Expected error | Logged reason |
| --- | --- | --- | --- |
| 7 | No token | `Authentication required` | `missing token` |
| 8 | Empty token | `Authentication required` | `missing token` |
| 9 | Malformed token | `Invalid authentication token` | `JsonWebTokenError` |
| 10 | Token signed with another secret | `Invalid authentication token` | `JsonWebTokenError` |
| 11 | Expired token | `Invalid authentication token` | `TokenExpiredError` |
| 12 | Valid token for a deleted user | `User not found` | `user not found` |
| 13 | User lookup fails (database down) | `Invalid authentication token` | `Error` |
| 14 | Rejected token is not written to the log | Token string absent from all log entries | — |
| 15 | Rejected client | Receives no history and is not added to the room | — |
| 16 | Server unreachable | `connect_error` with `websocket error` | — |
| 17 | Retry with a valid token after a rejection | Second attempt connects | — |

For cases 7–13 the tests also check that no server socket remains and that
no `SOCKET_CONNECTED` entry is written. Each `SOCKET_AUTH_FAILED` entry
includes the client IP.

### Disconnection handling

| # | Scenario | Expected result |
| --- | --- | --- |
| 18 | Client disconnects (logout) | Server removes the socket, the room is emptied, `SOCKET_DISCONNECTED` logged with `client namespace disconnect` |
| 19 | Server disconnects the client | Client receives `io server disconnect`; server logs `server namespace disconnect` |
| 20 | One of two clients disconnects | The other client stays connected and in the room |
| 21 | Network drop (connection closed without a disconnect packet) | Client reports `transport close`, reconnects automatically with a new socket id; the server ends up with exactly one socket |
| 22 | Token expires while the socket is idle | Client receives `auth_error` "Session expired. Please log in again." and `io server disconnect`; `SOCKET_TOKEN_EXPIRED` logged |
| 23 | Five connect/disconnect cycles | Five connections and five disconnections logged, no sockets left behind |

## How to run

```bash
cd code/backend
npm install
npx jest tests/socketConnection.integration.test.js
```

`npm test` runs this suite together with the existing unit tests. No MongoDB
server or `.env` file is needed.

## Results

Run on 11 November 2026, Node.js 25.1.0, macOS:

- `tests/socketConnection.integration.test.js`: 23 passed, 0 failed
  (repeated three times with the same result).
- Full backend suite (`npm test`): 11 suites, 86 tests, all passed.

## Errors recorded and reported

- **How failures are recorded:** every rejected handshake writes a
  `SOCKET_AUTH_FAILED` warning with the reason and client IP, and an expired
  session writes `SOCKET_TOKEN_EXPIRED`. Outside tests the logger also appends
  these entries to `code/backend/logs/security.log`. The tests check each
  entry, and check that tokens are never logged.
- **Defects found:** none. Every connection, rejection and disconnection
  scenario behaved as expected.
- **Observation (not a defect):** `SOCKET_DISCONNECTED` records the socket id
  and reason but not the username. Matching a disconnect to a user means
  looking up the earlier `SOCKET_CONNECTED` entry with the same socket id.
  Adding the username would make the log easier to audit.
