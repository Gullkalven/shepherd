import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

/**
 * In-memory only: cleared on full page refresh. Lets localhost demos show the
 * sign-in screen first even when `localStorage.user` still holds the last role.
 */
type DevPresentationSessionContextValue = {
  sessionActive: boolean;
  activateSession: () => void;
  endSession: () => void;
};

const DevPresentationSessionContext = createContext<DevPresentationSessionContextValue | null>(
  null
);

export function DevPresentationSessionProvider({ children }: { children: ReactNode }) {
  const [sessionActive, setSessionActive] = useState(false);

  const activateSession = useCallback(() => setSessionActive(true), []);
  const endSession = useCallback(() => setSessionActive(false), []);

  const value = useMemo(
    () => ({ sessionActive, activateSession, endSession }),
    [sessionActive, activateSession, endSession]
  );

  return (
    <DevPresentationSessionContext.Provider value={value}>
      {children}
    </DevPresentationSessionContext.Provider>
  );
}

export function useDevPresentationSession() {
  const ctx = useContext(DevPresentationSessionContext);
  if (!ctx) {
    throw new Error('useDevPresentationSession must be used within DevPresentationSessionProvider');
  }
  return ctx;
}
