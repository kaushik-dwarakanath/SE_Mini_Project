# Test report: sending and receiving messages (issue #17)

| Item | Detail |
| --- | --- |
| Sprint | Sprint 2 |
| Story | As a developer, I want to test message delivery so that users can communicate correctly. |
| Test cases (STP) | TC-MSG-02 (message broadcast), TC-ROOM-01 (join shared room), TC-SEC-03 (message input validation), TC-PERF-01 (1-second delivery, small scale) |
| Requirements | FR-006, FR-007, FR-011, SEC-003 |
| Test level | Integration (real Socket.IO server and real `socket.io-client` clients) |
| Test file | `code/backend/tests/messageDelivery.integration.test.js` |
| Helpers | `code/backend/tests/helpers/socketTestServer.js` (from issue #16) |

## What is under test

Each test connects two or three authenticated clients to the real Socket.IO
server (`createSocketServer`). The real `socketAuth`, chat handlers, message
sanitizer and message service run unchanged. Only the Mongoose models are
mocked: `Message.create` stores documents in memory, so tests can check what
was saved without MongoDB.

## Test cases

### Two clients in the shared room

| # | Scenario | Expected result |
| --- | --- | --- |
| 1 | Connect two clients | Both are in the `general` room |
| 2 | First client sends | Second client receives `new_message` with `id`, `roomId`, `text`, `senderId`, `username`, ISO `timestamp` and `cursor` |
| 3 | Second client sends | First client receives it with the right sender |
| 4 | Sender's own copy | The sender receives exactly one copy, identical to the other client's |
| 5 | Four-message conversation | Both clients see the same messages in the same order |
| 6 | 20 rapid messages from one client | Delivered in sending order |
| 7 | Persistence | Each delivered message was saved once with sender, room and content |
| 8 | Delivery time | Delivered to the other client in under 1 second |

### Delivery to all connected users

| # | Scenario | Expected result |
| --- | --- | --- |
| 9 | Three users, one sends | All three (including the sender) receive it |
| 10 | Three users, each sends | Every user receives all three messages |
| 11 | One user disconnects | The others still receive messages; the disconnected user receives nothing |
| 12 | A client in another room | Does not receive shared-room messages, but does receive messages for its own room |

### Empty-message rejection

Each payload below is sent by one client. The sender must receive
`message_error` "Message text is required", nothing is saved, and neither
client receives a `new_message` for it. To check that nothing was broadcast,
the sender then sends a valid message. Socket.IO keeps events in order, so the
valid message must be the first `new_message` both clients receive.

| # | Payload |
| --- | --- |
| 13 | `""` |
| 14 | Spaces only |
| 15 | Tabs and newlines only |
| 16 | Control characters only |
| 17 | HTML tags only (`<b></b><script></script>`) |
| 18 | No `text` field |
| 19 | `text: null` |
| 20 | `text: 42` |
| 21 | `text` is an object (`{ $ne: "" }`) |
| 22 | `text` is an array |
| 23 | No payload |
| 24 | After a rejection, the same client can still send and stays connected |

### Message content handling

| # | Scenario | Expected result |
| --- | --- | --- |
| 25 | Surrounding whitespace | Trimmed |
| 26 | HTML markup (`<img onerror>`, `<b>`) | Tags removed; text kept (`hi there`) |
| 27 | Unicode and emoji | Delivered unchanged |
| 28 | 1,500 characters | Cut to 1,000 characters |

### Delivery failures

| # | Scenario | Expected result |
| --- | --- | --- |
| 29 | Room the sender has not joined | `message_error` "Join the room before sending messages"; nothing saved |
| 30 | Invalid room id (object) | Same error; nothing saved |
| 31 | Database write fails | Sender gets "Message could not be sent"; no broadcast; the next message is delivered normally |

## How to run

```bash
cd code/backend
npm install
npx jest tests/messageDelivery.integration.test.js
```

## Results

Run on 11 November 2026, Node.js 25.1.0, macOS:

- `tests/messageDelivery.integration.test.js`: 31 passed, 0 failed
  (repeated three times with the same result).
- Full backend suite (`npm test`): all suites passed.
- To confirm the tests detect real faults, two changes were tried and then
  reverted. Broadcasting only to other clients (`socket.to` instead of
  `io.to`) failed 16 tests. Removing the empty-message check failed 12 tests.

## Defects and observations

- **Defects found:** none in server-side delivery. Messages reach every
  connected user in the room, and empty messages are rejected.
- **Observation (Low):** messages over 1,000 characters are cut silently.
  The sender is not told that the message was shortened.
- **Observation (Low, out of scope):** an authenticated user can join any
  valid room id with `join_room`. Only the shared room is in scope (the STP
  excludes multi-room chat), so this is acceptable for now. Room access
  control would be needed if more rooms are added.
- The browser client does not yet send messages to the server. That is
  covered by the end-to-end workflow test in issue #18.
