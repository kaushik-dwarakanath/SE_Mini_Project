// Reads and writes the login token in localStorage. The backend validates the
// token on every request and socket connection; these helpers only decide
// whether the app should treat the visitor as signed in.
export const TOKEN_KEY = "token";

// True only for a JWT whose payload has an "exp" time in the past. Anything
// that cannot be decoded is left for the backend to accept or reject.
function isExpiredJwt(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")));
    return typeof payload.exp === "number" && payload.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export function readStoredToken() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) return null;

    if (isExpiredJwt(token)) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }

    return token;
  } catch {
    return null;
  }
}

export function storeToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Storage is unavailable; the in-memory session is still cleared.
  }
}
