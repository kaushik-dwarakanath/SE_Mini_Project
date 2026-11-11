import { createContext, useContext } from "react";

export const SessionContext = createContext(null);

// The shared login session: { token, isSignedIn, signIn(token), signOut() }.
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return session;
}
