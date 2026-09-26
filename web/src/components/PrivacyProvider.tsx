'use client';

// Broadcasts the privacy display mode ("Mask names", render-time masking) to
// every table/map/graph/log. Default OFF; the per-device choice persists via
// lib/privacy (localStorage) and never reaches the server. Implemented as a
// tiny external store so toggling re-renders every consumer without
// setState-in-effect churn. The server snapshot is the default (OFF) — a
// device that stored ON flips right after hydration, which is exactly what
// useSyncExternalStore is for.

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { PRIVACY_MODE_DEFAULT, privacyModeEnabled, setPrivacyMode } from '@/lib/privacy';

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
  masked: PRIVACY_MODE_DEFAULT,
  setMasked: () => {},
});

function readMode(): boolean {
  return privacyModeEnabled();
}

export function PrivacyProvider({ children }: { children: ReactNode }) {
  const masked = useSyncExternalStore(
    subscribe,
    readMode,
    () => PRIVACY_MODE_DEFAULT, // server snapshot: the default, OFF
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
