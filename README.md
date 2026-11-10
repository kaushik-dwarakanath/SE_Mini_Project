# SE Mini Project — SimpleChat

A private, one-to-one chat application using React/Vite, Express, Socket.IO and MongoDB. Register, log in, search for another registered username and start a conversation. Both people can sign in from different devices. Messages are encrypted in the browser and saved in MongoDB before delivery notifications are sent.

Chat controls, the user directory, history and messaging require login. Refreshing or closing a tab locks the app; log in again to recover your message keys and history. Sessions last one hour. The original login and chat styling is retained, with a responsive people list.

## Run locally

Requirements: **Node.js 24+**, npm, and MongoDB (local or Atlas).

Backend, from the repository root:

```bash
cd code/backend
npm ci
npm run setup
# Edit .env to set MONGODB_URI for your MongoDB installation.
npm start
```

`npm run setup` creates an ignored `.env` if needed and generates missing placeholder secrets. It preserves existing database settings and configured secrets. Back up `DATA_ENCRYPTION_KEY` securely: changing it without a migration breaks email lookup and access to encrypted email records.

Frontend, in another terminal:

```bash
cd code/frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite forwards both `/api` and `/socket.io` to port 5000. Set `API_PROXY_TARGET` when starting Vite if the backend runs on a different port. Registration and login requests use `/api/auth/*`, so refreshing `/login` or `/register` correctly serves the app.

Create two accounts in separate browsers or browser profiles. In each, log in, search for the other username and select it. Click Send or press Enter. Messages also arrive on other signed-in devices for the same account. The people list includes only accounts that have initialized encryption.

## Connect different devices

Every device must open the **same HTTPS origin** connected to the same backend and database. Plain HTTP on a LAN IP does not support the browser encryption APIs; localhost is a development exception. Do not disable browser security to work around this.

For a single-server installation:

1. Build the frontend with `cd code/frontend && npm run build`.
2. Configure the backend's `MONGODB_URI`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `NODE_ENV=production` and `PUBLIC_ORIGIN=https://your-chat-domain`.
3. Run `npm start` in `code/backend`. Express serves the built frontend, API and Socket.IO on `127.0.0.1:5000`. Keep this port private; `HOST` can change the binding when your hosting platform requires it.
4. Put that port behind an HTTPS reverse proxy that forwards both HTTP requests and WebSocket upgrades. Set `TRUST_PROXY=1` only when exactly one trusted proxy is in front of the app.
5. Open the HTTPS address on both devices and register/log in separately.

An example [Caddy reverse-proxy configuration](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) (replace the domain with yours):

```caddyfile
chat.example.com {
    reverse_proxy 127.0.0.1:5000
}
```

The domain must resolve to the server, HTTPS must be reachable from both devices, and the database must permit the backend's connection. For private LAN use, a trusted HTTPS certificate on each device is still required. This repository does not provision hosting, DNS or certificates.

## Security and storage

| Data | Protection |
| --- | --- |
| Message contents | Browser ECDH P-256 + HKDF-SHA-256 + AES-256-GCM; MongoDB stores ciphertext |
| Account private message key | Encrypted in the browser using a password-derived key; only ciphertext is uploaded |
| Login credential | Separate browser-derived secret, salted bcrypt hash with cost 12 on the server |
| Email | AES-256-GCM encryption at rest, with a keyed lookup digest |
| Sessions | Signed, one-hour tokens; only token hashes stored in MongoDB; logout revokes the session |
| Usernames, public keys, participant IDs, timestamps | Visible metadata needed for discovery and delivery |

Passwords and emails are **not described as end-to-end encrypted**. The server must verify a login credential and look up accounts. New-account passwords do not leave the browser; the separate derived login credential cannot directly decrypt the message-key vault. Email encryption is server-side. See [SECURITY.md](SECURITY.md) for the protocol, migration behavior and limits.

Keep the password: there is no password-reset or key-recovery bypass. Compare the conversation's safety number through a trusted channel to authenticate the other person's key. The browser remembers public keys and blocks sending if a known key changes.

## Existing project databases

Before first starting this version against an existing database, back it up and retain the old server configuration.

- Startup creates the required unique/history/TTL indexes and encrypts existing email records in place. The email migration is idempotent and preserves usernames and account IDs.
- Existing bcrypt-password accounts can log in with their original password. That first login sends the password over HTTPS once for legacy verification, then creates an encrypted key vault, replaces the password hash with the derived-credential hash, and revokes old sessions.
- New messages use the `encrypted_messages` collection. The original `messages` collection is left untouched and is never served by this version. Existing plaintext records cannot be retroactively made end-to-end encrypted by the server.
- Never remove or regenerate `DATA_ENCRYPTION_KEY` after migration. Database backups may still contain historical plaintext; retention and disposal are an operator decision.

## Verification

Backend integration and cryptography tests:

```bash
cd code/backend
npm ci
npm test
```

Frontend build and real browser tests:

```bash
cd code/frontend
npm ci
npm run build
npx playwright install chromium
npm run test:e2e
```

The tests start an **isolated temporary MongoDB** and do not read your `.env` or modify your configured database. The first run may download a MongoDB binary. Browser tests reserve ports **5001** and **5174**, use separate real browser contexts, and run at desktop and 320px mobile widths. To use an existing Chromium installation, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`.

Coverage includes login/registration, forged and expired sessions, logout revocation, encryption and tampering, private delivery, separate devices, reconnects, safe retries, pagination, server restarts, legacy account upgrades, Unicode/HTML text, scrolling and mobile layout. Browser checks also build the frontend and exercise its production content policy. The tests use the real API and database; the lost-response test deliberately interrupts one successful send response.

## Code organization

- `code/backend/app.js`: application factory, HTTP security and authenticated socket lifecycle.
- `code/backend/server.js`: environment, database startup, migration and shutdown.
- `code/backend/routes/`, `services/`, `lib/`, `models/`: request validation, session logic, privacy and persistence.
- `code/frontend/src/lib/`: API access, authentication and browser cryptography.
- `code/frontend/src/components/`: account forms, people list and encrypted conversation UI.
- `code/backend/tests/`, `code/frontend/tests/`: isolated integration and browser tests.

## API

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/health` | Database readiness |
| POST | `/api/auth/register` | Register with a derived credential and encrypted key vault |
| POST | `/api/auth/parameters` | Get password-derivation salt / legacy status |
| POST | `/api/auth/login` | Verify credentials and issue a session |
| POST | `/api/auth/encryption` | One-time legacy account upgrade, authenticated |
| DELETE | `/api/auth/session` | Revoke current session |
| GET | `/api/users?q=...` | Search public profiles, authenticated; up to 50 results |
| GET | `/api/messages/:peerId?before=...` | Participant-only history, 50 messages per page |
| POST | `/api/messages` | Validate and persist an encrypted message, authenticated |

Socket.IO authenticates the session before joining server-selected user rooms. `new_message` notifications go only to the sender's and recipient's sessions. Sending uses the HTTP API so database acknowledgment and retry errors are explicit.

## Troubleshooting

- **Secure chat needs HTTPS:** use localhost for local development, or an HTTPS address on other devices.
- **Database connection fails:** check MongoDB availability, credentials and Atlas network access rules.
- **Missing/invalid secrets:** run `npm run setup` for missing placeholders; existing invalid values require correction.
- **No people found:** register another account, log it in once if it is a legacy account, and refresh/search.
- **Session ended after refresh:** intentional; logging in unlocks the same saved history.
- **Message send fails:** the draft remains. Retry with Send; a lost acknowledgment will not duplicate a stored message.
