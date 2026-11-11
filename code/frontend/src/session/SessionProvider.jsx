import { useCallback, useEffect, useMemo, useState } from "react";
import { SessionContext } from "./session";
import { clearStoredToken, readStoredToken, storeToken, TOKEN_KEY } from "./tokenStore";

// One session state for the whole app. It is initialised from localStorage when
// the app loads, so a refresh keeps a signed-in user signed in.
export default function SessionProvider({ children }) {
  const [token, setToken] = useState(readStoredToken);

  const signIn = useCallback((newToken) => {
    storeToken(newToken);
    setToken(newToken);
  }, []);

  const signOut = useCallback(() => {
    clearStoredToken();
    setToken(null);
  }, []);

  // Keep other open tabs in step when this browser signs in or out.
  useEffect(() => {
    function handleStorage(event) {
      if (event.key === TOKEN_KEY || event.key === null) {
        setToken(readStoredToken());
      }
    }

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const value = useMemo(
    () => ({ token, isSignedIn: Boolean(token), signIn, signOut }),
    [token, signIn, signOut]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
