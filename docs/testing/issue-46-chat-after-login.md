# Acceptance record: Show Chat only after login (issue #46)

| Item | Detail |
| --- | --- |
| Sprint | Sprint 3 |
| Story | As a SimpleChat user, I want the Chat option to appear after I sign in so that the navigation reflects whether I can access the chat room. |
| Sub-stories | #49 Sync Chat navigation with the login session (2 points); #50 Use the login session to guard the Chat route (1 point) |
| Story points | 3 |
| Acceptance test | `code/frontend/tests/chat-access.acceptance.spec.js` |
| Supporting tests | `code/frontend/tests/session-navigation.spec.js` (#49), `code/frontend/tests/chat-route-guard.spec.js` (#50) |

## How the story was delivered

- **#49** added one session state for the whole app
  (`src/session/SessionProvider.jsx`, read with `useSession()`). It is
  initialised from the saved token when the app loads. The navbar, Login and
  Logout use it, so the navbar updates without reloading the page.
- **#50** made the `/chat` route guard use the same session. The guard and the
  navbar can no longer disagree, and the guard reacts as soon as the session
  ends.
- **#46** adds an acceptance test that walks through every criterion below in
  one user journey.

## Acceptance criteria

| # | Criterion | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Signed-out visitors see Login and Register | Acceptance step 1; #49 "signed-out visitors see Login and Register but not Chat" | Pass |
| 2 | Opening `/chat` directly redirects to Login | Acceptance step 2; #50 "opening /chat directly redirects to Login without connecting" | Pass |
| 3 | Successful login shows Chat and Logout immediately | Acceptance step 4, which also checks the page is not reloaded; #49 "a successful login shows Chat and Logout immediately, without reloading" | Pass |
| 4 | A failed login leaves the user signed out | Acceptance step 3; #49 failed-login, token-less response and unreachable-server tests | Pass |
| 5 | Refreshing with a valid session preserves access | Acceptance step 5; #49 refresh test; #50 "refreshing /chat stays in the room" | Pass |
| 6 | Signing out removes Chat | Acceptance step 6; #49 logout and other-tab tests | Pass |
| 7 | Signing out prevents returning to the chat through browser history | Acceptance step 7, which steps Back over an earlier `/chat` entry; #50 Back and Forward tests check that the chat never renders and its connection closes | Pass |

## Results

Run on 11 November 2026 in Chromium, desktop (1280 × 800) and mobile
(320 × 640):

| Suite | Result |
| --- | --- |
| `chat-access.acceptance.spec.js` | 2 passed (desktop and mobile) |
| `session-navigation.spec.js` | 26 passed |
| `chat-route-guard.spec.js` | 18 passed |
| Full frontend suite | All passed except the two `chat.spec.js` layout tests that also fail on `main` on macOS (defect D-06 in the Sprint 2 testing branch) |
| `npm run lint`, `npm run build` | Passed |

On the code in `main`, the acceptance test fails at criterion 3: the old
login handler reloaded the whole page to update the navbar.

A manual check against the real backend (MongoDB, real JWT) confirmed that
logging in switches the navbar to Chat and Logout without a reload, and that
the chat connects.

## Notes

- The session state only decides what the client shows. The backend still
  validates the JWT on every Socket.IO connection and REST request.
- Opening or refreshing `/login` or `/register` directly in the Vite dev server
  returns the backend's 404. That is a separate dev-proxy defect (D-02), fixed
  on the Sprint 2 branch for issue #18. The tests here start from `/` or
  `/chat`, so they do not depend on that fix.
