// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — <AuthProvider /> + useAuth()
//
// React context that tracks Firebase Auth state. Components call
// `useAuth()` to get the current account + tenants + sign-in actions.
//
// Dormant: not yet mounted in App.tsx. When Phase 2 flips the switch,
// App.tsx wraps its tree in <AuthProvider /> and the existing views
// start seeing real sign-in state.
//
// Until then, consumers of `useTenant()` get the legacy SC Deburring
// fallback (see useTenant.ts), and this provider does nothing.
// ═════════════════════════════════════════════════════════════════════

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Account, Tenant } from './types';
import {
  logIn,
  logInWithGoogle,
  logOut,
  signUp,
  subscribeAuthState,
  type LoginInput,
  type SignupInput,
  type SignupResult,
} from './authService';

export interface AuthContextValue {
  /** Current signed-in account, or null when signed out. */
  account: Account | null;
  /** Tenants this account has access to. */
  tenants: Tenant[];
  /** The tenant id currently selected (user can switch). */
  currentTenantId: string | null;
  /** True while the initial auth state is resolving. */
  isLoading: boolean;

  // Actions — thin wrappers around authService so UI doesn't import it directly.
  signUp: (input: SignupInput) => Promise<SignupResult>;
  logIn: (input: LoginInput) => Promise<void>;
  logInWithGoogle: () => Promise<void>;
  logOut: () => Promise<void>;

  /** Switch to a different tenant the user belongs to. */
  switchTenant: (tenantId: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [account, setAccount] = useState<Account | null>(null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsub = subscribeAuthState((ctx) => {
      if (ctx) {
        setAccount(ctx.account);
        setTenants(ctx.tenants);
        setCurrentTenantId(ctx.defaultTenantId);
      } else {
        setAccount(null);
        setTenants([]);
        setCurrentTenantId(null);
      }
      setIsLoading(false);
    });
    return unsub;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    account,
    tenants,
    currentTenantId,
    isLoading,
    signUp: async (input) => {
      const r = await signUp(input);
      setAccount(r.account);
      setTenants([r.tenant]);
      setCurrentTenantId(r.tenant.id);
      return r;
    },
    logIn: async (input) => {
      await logIn(input);
      // Auth state observer will fire, but update synchronously for snappy UI.
    },
    logInWithGoogle: async () => {
      await logInWithGoogle();
    },
    logOut: async () => {
      await logOut();
      setAccount(null);
      setTenants([]);
      setCurrentTenantId(null);
    },
    switchTenant: (tid) => setCurrentTenantId(tid),
  }), [account, tenants, currentTenantId, isLoading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    // Soft-fail: during Phase 0-1 (before AuthProvider is mounted), return a
    // legacy-safe shape so any accidental consumer doesn't crash.
    return {
      account: null,
      tenants: [],
      currentTenantId: null,
      isLoading: false,
      signUp: () => { throw new Error('AuthProvider not mounted'); },
      logIn: () => { throw new Error('AuthProvider not mounted'); },
      logInWithGoogle: () => { throw new Error('AuthProvider not mounted'); },
      logOut: () => { throw new Error('AuthProvider not mounted'); },
      switchTenant: () => {},
    };
  }
  return ctx;
}
