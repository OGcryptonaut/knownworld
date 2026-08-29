'use client';

// Broadcasts the privacy display mode (render-time masking) to every table.
// Defaults ON (SSR-safe); persisted via lib/privacy localStorage helpers.
// Implemented as a tiny external store so toggling re-renders every consumer
// without setState-in-effect churn.

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { privacyModeEnabled, setPrivacyMode } from '@/lib/privacy';

const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit(): void {
  for (const cb of listeners) cb();
}

interface PrivacyContextValue {
  /** true → names/handles are masked at render time */
  masked: boolean;
  setMasked: (on: boolean) => void;
}

const PrivacyContext = createContext<PrivacyContextValue>({
  masked: true,
  setMasked: () => {},
});

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const masked = useSyncExternalStore(
    subscribe,
    privacyModeEnabled,
    () => true, // server snapshot: default ON
  );

  const setMasked = useCallback((on: boolean) => {
    setPrivacyMode(on);
    emit();
  }, []);

  return (
    <PrivacyContext.Provider value={{ masked, setMasked }}>
      {children}
    </PrivacyContext.Provider>
  );
}

export function usePrivacy(): PrivacyContextValue {
  return useContext(PrivacyContext);
}
