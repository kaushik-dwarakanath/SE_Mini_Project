# SimpleChat security design

## Scope and trust

This application implements password-unlocked, one-to-one encrypted messaging for a single Express server backed by MongoDB. The server stores and relays ciphertext. Authentication, authorization and persistence are separate from browser cryptography.

It protects message contents against passive inspection of the database, API traffic payloads and server logs, assuming uncompromised clients, strong passwords and trusted delivered application code. HTTPS is required outside localhost. This is a project implementation using Web Crypto primitives, **not an independently audited messaging protocol**.

Usernames, public keys, participant IDs, timestamps, message sizes and communication patterns remain visible to the server. Email is encrypted at rest with a server-held key, not end-to-end encrypted. A running compromised server can decrypt email and impersonate the web application. A compromised browser, malicious extension or XSS can access messages while unlocked.

## Protocol version 1

1. **Account setup.** The browser generates a random 16-byte salt and a P-256 ECDH key pair. PBKDF2-HMAC-SHA-256 with 600,000 iterations turns the password into a 256-bit root. HKDF-SHA-256 with distinct labels derives a 256-bit authentication secret and an AES-256-GCM key for the private-key vault.
2. **Authentication.** Only the derived authentication secret is sent for modern accounts. The server stores its bcrypt hash with an independent random salt and cost 12. The base64 secret is 44 ASCII characters, below bcrypt's 72-byte limit. The password and vault-wrapping key are never uploaded by a modern client.
3. **Key backup.** The browser exports the ECDH private key as PKCS#8 and encrypts it with a random 12-byte GCM nonce. Additional authenticated data binds the vault to its public key and version. MongoDB stores the salt, public key, nonce and encrypted private key. After unlocking, the imported private CryptoKey is non-extractable and retained only in tab memory.
4. **Conversation keys.** Each participant combines their private key and the other's public key using ECDH. HKDF-SHA-256 derives the AES-256-GCM conversation key, binding the version and sorted participant IDs.
5. **Messages.** Every send generates a fresh 12-byte random nonce and UUID. AES-GCM authenticates the contents and additional data containing the version, UUID, sender ID and recipient ID. Tampering fails decryption and produces an explicit failure in the UI. Message timestamps are server metadata, not sender-authenticated contents.
6. **Recovery.** Logging in on another device derives the same wrapping key, downloads the encrypted vault and unlocks the same identity. Messages can then be decrypted from database history. No unencrypted private key, password, conversation key, session token or plaintext message is persisted in browser storage.
7. **Key verification.** Both people see the SHA-256 fingerprint of their sorted public keys. Compare the full number over a trusted channel. Public keys are pinned per account/peer in browser localStorage; a changed key blocks sending until the user explicitly confirms verification. New browsers and cleared storage need fresh verification.

The authentication secret is separate from the vault key: possession of it does not directly derive message keys. However, weak passwords can still be guessed offline against a stolen encrypted vault. There is no password reset, identity-key rotation, forward secrecy or post-compromise recovery. Compromise of an account's private identity key exposes its historical conversations. Those features require a more comprehensive, reviewed protocol rather than an unreviewed extension of this one.

## Server controls

- JWTs use HS256 with fixed issuer/audience, a random session ID and one-hour expiry. A MongoDB session record containing only the token hash must also exist and be unexpired. TTL cleanup is not relied on for authorization.
- Login and account setup are rate limited by source IP; reads and sends are limited by authenticated account. Request bodies, identifiers, nonces, ciphertext sizes and public keys are validated.
- HTTP routes always derive identity from the verified session. The sender cannot claim another account; history queries derive the conversation from the authenticated account and requested peer.
- Socket.IO validates the same session and assigns rooms server-side. Clients cannot choose room membership or broadcast messages. Session expiry disconnects sockets; logout removes the session and disconnects its room.
- Sending writes to MongoDB before emitting. A unique sender/UUID index makes retries idempotent; conflicting reuse is rejected. Acknowledgment means saved by the server, not read by the recipient.
- Reconnect fetches the latest history. Older pages remain available. Socket.IO is a notification channel, not the only copy of messages.
- Production serves the client and API from one origin. CSP restricts scripts and connections to that origin; API responses are not cached. Configured origins are checked. Bearer tokens are explicitly attached from memory rather than automatically sent in cookies.
- Email is encrypted with AES-256-GCM; separate HKDF-derived keys provide encryption and HMAC lookup. The stable 32-byte `DATA_ENCRYPTION_KEY` is supplied outside Git. Keep encrypted backups and protect this key separately.
- No passwords, login secrets, tokens, messages or database URIs are intentionally logged.
- The frontend pins the patched minimatch 11 line through an npm override because the current lint tooling otherwise resolves an affected older version. Revisit this override when its upstream dependency range is updated.

The in-memory rate limits and default Socket.IO adapter support **one application process**. Horizontal scaling needs shared rate limiting and a shared socket adapter. Production also needs monitored database backups, TLS, access restrictions and a process supervisor. Registration is open to anyone who can reach the site; authenticated users can search public usernames.

## Legacy data and recovery limits

Before first production startup, back up the existing database. Startup encrypts old email fields with idempotent atomic updates and builds indexes. Legacy bcrypt accounts use their original password once over HTTPS; the browser then initializes encryption and uploads a new derived credential and encrypted vault. Earlier sessions are revoked.

Old plaintext `messages` records and historical backups remain unchanged. No server-only operation can retroactively turn previously exposed plaintext into end-to-end encryption. The new service uses only `encrypted_messages`; it never returns the old collection.

Preserve `DATA_ENCRYPTION_KEY` across deployments. Rotating it requires a controlled migration of encrypted emails and lookup digests. JWT signing keys may be changed to invalidate all existing sessions. Losing an account password or encrypted vault makes message recovery impossible; the server has no decryption bypass.

## Verification and references

Backend tests inspect raw stored records, exercise access controls and legacy migration, restart the server, test pagination and verify cryptographic tamper rejection. Browser tests use separate accounts and contexts with the real server and temporary MongoDB. These checks reduce defects but do not substitute for independent security review.

- [Web Crypto API and secure contexts](https://developer.mozilla.org/en-US/docs/Web/API/Web_Crypto_API)
- [ECDH / HKDF key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [OWASP password storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
