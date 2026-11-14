# Assigned-story review and completion

Reviewed on 13 November 2026. Base: `main` at
`d197f1aaa5237f11bb1cceffe3d8b25632f66a6f`.

## Review scope

Reviewed the repository's runtime frontend/backend modules, models, REST/socket
contracts, configuration, dependency manifests, existing test coverage, README
instructions, SRS/SAD/STP documents, branch history and open PR metadata.
Authenticated GitHub account: `Darshil085`; repository push permission confirmed.

## Existing work preserved

| Assignment | State at review | Existing implementation |
| --- | --- | --- |
| #8, #9, #10 | Closed | MongoDB startup validation, user schema, password hashing/login |
| #19, #20 | Closed | Message schema, persistence service and socket persistence |
| #51 | Closed | Authenticated room-scoped typing relay with multi-tab cleanup; PR #55 merged |
| #53 | Closed | Authenticated current-user profile endpoint; PR #56 merged |
| #47, #52 | Open | Typing UI existed but empty input did not stop immediately; real browser delivery was missing |
| #48, #54 | Open | Profile UI/navigation from merged PR #64 existed; response validation and acceptance evidence incomplete |

## Findings resolved

| Finding | Change and evidence |
| --- | --- |
| Empty or whitespace-only input kept typing active until idle | Immediate stop; two-client acceptance asserts clearing within 750 ms |
| A second tab could show its own account as typing | Filter by the JWT account ID for display; same-account multi-tab acceptance journey |
| Send only appended a local preview, so two signed-in browsers could not exchange messages | Emit the existing backend event; render the authoritative broadcast once; test bidirectional delivery and own-message styling |
| Offline submit could appear successful locally | Keep the draft, display an error and add no message; acceptance verifies delivery after reconnect |
| `/login` POST did not have a Vite proxy; `/register` page loads were sent to Express | Proxy POST/API requests and serve SPA documents on direct GET; real login and direct page loading exercised in acceptance |
| Profile accepted malformed account objects | Validate nonblank string username/email; browser tests cover missing/wrong-typed fields |
| Frontend lint failed because App exported a non-component hook | Keep the app-local hook private |
| Backend integration tests expected a missing `SOCKET_DISCONNECTED` log | Restore the disconnect log while keeping `disconnecting` typing cleanup |
| Shared account/navigation classes and CSS variables had no active definitions | Add base account styles and keep the composer visible on desktop/mobile |

## Acceptance coverage

`code/frontend/acceptance/assigned-stories.spec.js` covers #47/#52 and #48/#54:
typing start/stop, inactivity, draft privacy, emission throttling, same-account
tabs, navigation/logout, transport loss/recovery, two-user message delivery,
offline draft preservation, profile refresh/read-only/loading/errors and 401.

`code/backend/tests/profile.test.js` covers the already-implemented #53 endpoint:
identity comes from the verified JWT, explicit response fields exclude password
and token data, missing/invalid/expired/wrong-secret tokens fail, deleted users
fail, and database failure returns a controlled error.

## Validation

| Check | Result |
| --- | --- |
| Backend `npm test -- --runInBand` | 13 suites, 127 tests passed |
| Frontend `npm run lint` | Passed |
| Frontend `npm run build` | Passed |
| Frontend `npm run test:e2e -- --workers=2` | 50 tests passed (desktop/mobile) |
| Frontend `npm run test:acceptance` | 16 tests passed (desktop/mobile) |
| `git diff --check` | Passed |

Baseline: lint had one Fast Refresh export error; backend had 116 passing tests
and four failing disconnect-log assertions. All now pass. Chromium was installed
in the test environment before browser validation.

Browser fixtures
replace database access; production routes, JWT verification and chat handlers
run unchanged in the new acceptance suite. No live MongoDB credentials were
provided or used, so this review does not claim a live database smoke test.

## Remaining project work outside these assignments

- `chat_history` and `missed_messages` have backend support but are not consumed
  by the browser. Refreshing chat therefore clears its displayed messages.
- Online presence/active-user UI from the wider SRS is not implemented.
- Teammate PRs #60–#62 have their own session provider. They were not merged or
  rewritten here. Reconcile that provider with the current `AuthProvider` before
  merging, and apply the same guard to both Chat and Profile.
- Production deployment needs SPA routing, API/socket forwarding and TLS; the
  development proxy is not a production deployment configuration.
- Sending clears the draft once emitted; a later database/server rejection is
  displayed, but automatic retry/failed-draft recovery is not implemented.

The new PR should close the four open assignments on merge. Existing completed
issues and teammates' branches remain unchanged.
