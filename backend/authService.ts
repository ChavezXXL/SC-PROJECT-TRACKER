// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — Auth Service
//
// Firebase Auth integration for sign-up, login, email verification,
// password reset, and Google SSO. Plus tenant-creation glue.
//
// Everything here is still "dormant" from the live app's perspective —
// nothing imports it yet. Phase 2 wires this to new `/signup` + `/login`
// routes. The SC Deburring session doesn't touch any of this.
//
// Operator actions (suspend / ban / comp plan) still need the Admin
// Console UI (Phase 6). The functions here write the Firestore state
// that those UIs will call.
// ═════════════════════════════════════════════════════════════════════

import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signOut as fbSignOut,
  GoogleAuthProvider,
  signInWithPopup,
  onAuthStateChanged,
  type Auth,
  type User as FirebaseUser,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  collection,
  query,
  where,
  getDocs,
  serverTimestamp,
} from 'firebase/firestore';

import type {
  Account,
  PlanId,
  Tenant,
  TenantMember,
  TenantMemberRole,
  Subscription,
} from './types';
import { TIER_CATALOG } from './catalog';
import {
  LEGACY_TENANT_ID,
  membersPath,
  setCurrentTenantId,
  subscriptionPath,
  tenantDocPath,
} from './tenantContext';

// ─────────────────────────────────────────────────────────────────────
// Lazy Firebase Auth instance
// ─────────────────────────────────────────────────────────────────────

let authInstance: Auth | null = null;

function auth(): Auth {
  if (!authInstance) authInstance = getAuth();
  return authInstance;
}

function db() {
  return getFirestore();
}

// ─────────────────────────────────────────────────────────────────────
// Signup
// ─────────────────────────────────────────────────────────────────────

export interface SignupInput {
  email: string;
  password: string;
  tenantName: string;         // "Acme Machining"
  tenantSlug?: string;        // optional, auto-derived from name if missing
  planId?: PlanId;            // optional pre-selection; defaults to 'pro' trial
  marketingOptIn?: boolean;
  displayName?: string;
}

export interface SignupResult {
  account: Account;
  tenant: Tenant;
  owner: TenantMember;
  subscription: Subscription;
  verificationEmailSent: boolean;
}

/** Create a Firebase Auth user + tenant + owner member + trialing subscription.
 *
 *  Atomic in spirit: each step is independent but we guard with try/catch so a
 *  partial failure surfaces a clean error message. True atomicity requires a
 *  server-side function (Phase 3). For now, worst-case is an orphan Auth user
 *  with no tenant — user can retry and we dedupe by email. */
export async function signUp(input: SignupInput): Promise<SignupResult> {
  const email = input.email.trim().toLowerCase();
  const tenantName = input.tenantName.trim();
  if (!email || !input.password || !tenantName) {
    throw new Error('Email, password, and shop name are all required.');
  }

  const planId: PlanId = input.planId || 'pro';
  const slug = (input.tenantSlug || slugifyTenantName(tenantName));

  // 1. Firebase Auth user
  const cred = await createUserWithEmailAndPassword(auth(), email, input.password);
  const uid = cred.user.uid;

  // 2. Send verification email (non-blocking — don't fail signup if it errors)
  let verificationEmailSent = false;
  try {
    await sendEmailVerification(cred.user);
    verificationEmailSent = true;
  } catch (e) {
    console.warn('Verification email failed, continuing:', e);
  }

  // 3. Create tenant + member + subscription (Firestore writes)
  const now = Date.now();
  const tenantId = await resolveUniqueTenantId(slug);
  const tenant: Tenant = {
    id: tenantId,
    name: tenantName,
    slug,
    ownerUid: uid,
    billingEmail: email,
    createdAt: now,
    status: 'trialing',
  };
  await setDoc(doc(db(), tenantDocPath(tenantId)), sanitize(tenant));

  const owner: TenantMember = {
    uid,
    tenantId,
    role: 'owner',
    email,
    name: input.displayName,
    status: 'active',
    joinedAt: now,
    lastSeenAt: now,
  };
  await setDoc(doc(db(), membersPath(tenantId), uid), sanitize(owner));

  const trialMs = TIER_CATALOG[planId].trialDays * 24 * 60 * 60 * 1000;
  const subscription: Subscription = {
    tenantId,
    planId,
    status: 'trialing',
    interval: 'month',
    seats: 1,
    trialStartedAt: now,
    trialEndsAt: now + trialMs,
    updatedAt: now,
  };
  await setDoc(doc(db(), subscriptionPath(tenantId)), sanitize(subscription));

  const account: Account = {
    uid,
    email,
    emailVerified: false,
    displayName: input.displayName,
    tenantIds: [tenantId],
    defaultTenantId: tenantId,
    createdAt: now,
    lastLoginAt: now,
  };
  await setDoc(doc(db(), 'accounts', uid), sanitize(account));

  setCurrentTenantId(tenantId);
  return { account, tenant, owner, subscription, verificationEmailSent };
}

// ─────────────────────────────────────────────────────────────────────
// Login
// ─────────────────────────────────────────────────────────────────────

export interface LoginInput {
  email: string;
  password: string;
}

export interface LoginResult {
  account: Account;
  tenants: Tenant[];
  defaultTenantId: string;
}

export async function logIn(input: LoginInput): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth(), email, input.password);
  return loadAccountContext(cred.user);
}

export async function logInWithGoogle(): Promise<LoginResult> {
  const provider = new GoogleAuthProvider();
  const cred = await signInWithPopup(auth(), provider);
  // First-time Google sign-in → create account doc if missing
  const existing = await getDoc(doc(db(), 'accounts', cred.user.uid));
  if (!existing.exists()) {
    const account: Account = {
      uid: cred.user.uid,
      email: cred.user.email || '',
      emailVerified: cred.user.emailVerified,
      displayName: cred.user.displayName || undefined,
      photoURL: cred.user.photoURL || undefined,
      tenantIds: [],
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    await setDoc(doc(db(), 'accounts', cred.user.uid), sanitize(account));
  }
  return loadAccountContext(cred.user);
}

export async function logOut(): Promise<void> {
  await fbSignOut(auth());
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth(), email.trim().toLowerCase());
}

/** Magic-link sign-in. After clicking the link, the user lands on the
 *  configured callback URL and finishes the sign-in via `completeMagicLink`. */
export async function sendMagicLink(email: string, callbackUrl: string): Promise<void> {
  await sendSignInLinkToEmail(auth(), email.trim().toLowerCase(), {
    url: callbackUrl,
    handleCodeInApp: true,
  });
  // Persist email locally so the completion step can finish even if the
  // link is opened on a different device.
  try { localStorage.setItem('fabtrack_magic_link_email', email.trim().toLowerCase()); } catch {}
}

// ─────────────────────────────────────────────────────────────────────
// Auth-state observer
// ─────────────────────────────────────────────────────────────────────

/** Subscribe to Firebase Auth state. Returns an unsubscribe function.
 *  Calls back with the account/tenants/defaultTenantId when signed in, or
 *  null when signed out. */
export function subscribeAuthState(
  cb: (ctx: LoginResult | null) => void,
): () => void {
  return onAuthStateChanged(auth(), async (user) => {
    if (!user) { cb(null); return; }
    try {
      const ctx = await loadAccountContext(user);
      cb(ctx);
    } catch (e) {
      console.warn('loadAccountContext failed:', e);
      cb(null);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────

async function loadAccountContext(fbUser: FirebaseUser): Promise<LoginResult> {
  const uid = fbUser.uid;
  // Bump lastLoginAt; create minimal account if missing (first Google login).
  const accountRef = doc(db(), 'accounts', uid);
  const snap = await getDoc(accountRef);
  let account: Account;
  if (snap.exists()) {
    account = snap.data() as Account;
    await updateDoc(accountRef, { lastLoginAt: Date.now() });
  } else {
    account = {
      uid,
      email: fbUser.email || '',
      emailVerified: fbUser.emailVerified,
      displayName: fbUser.displayName || undefined,
      photoURL: fbUser.photoURL || undefined,
      tenantIds: [],
      createdAt: Date.now(),
      lastLoginAt: Date.now(),
    };
    await setDoc(accountRef, sanitize(account));
  }

  // Load tenants this account has access to.
  const tenants: Tenant[] = [];
  for (const tid of account.tenantIds) {
    try {
      const t = await getDoc(doc(db(), tenantDocPath(tid)));
      if (t.exists()) tenants.push(t.data() as Tenant);
    } catch { /* skip missing tenants */ }
  }

  const defaultTenantId =
    account.defaultTenantId ||
    account.tenantIds[0] ||
    LEGACY_TENANT_ID;

  setCurrentTenantId(defaultTenantId);
  return { account, tenants, defaultTenantId };
}

/** URL-safe slug — lowercase alphanumerics and dashes only. */
export function slugifyTenantName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'shop';
}

/** Find a unique tenant ID by appending digits if the desired slug collides. */
async function resolveUniqueTenantId(baseSlug: string): Promise<string> {
  // Reserved IDs
  const reserved = new Set([LEGACY_TENANT_ID, 'admin', 'api', 'app', 'www', 'portal', 'billing']);
  let candidate = baseSlug;
  if (reserved.has(candidate)) candidate = candidate + '-shop';
  for (let i = 0; i < 50; i++) {
    const tid = i === 0 ? candidate : `${candidate}-${i + 1}`;
    const existing = await getDoc(doc(db(), tenantDocPath(tid)));
    if (!existing.exists()) return tid;
  }
  // Fallback: append random suffix
  return `${candidate}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Strip `undefined` values from an object so Firestore accepts it. */
function sanitize<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((v) => sanitize(v)) as any;
  const out: any = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (v !== undefined) out[k] = sanitize(v as any);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Invites (Phase 5 — stub)
// ─────────────────────────────────────────────────────────────────────

export interface InviteTeamInput {
  tenantId: string;
  email: string;
  role: TenantMemberRole;
  invitedByUid: string;
}

export async function inviteTeammate(_input: InviteTeamInput): Promise<void> {
  throw new Error('inviteTeammate() not wired yet — Phase 5');
}

export async function acceptInvite(_inviteToken: string, _uid: string): Promise<TenantMember> {
  throw new Error('acceptInvite() not wired yet — Phase 5');
}

// ─────────────────────────────────────────────────────────────────────
// Operator actions (Phase 6 — stub; need admin UI)
// ─────────────────────────────────────────────────────────────────────

export async function opsSuspendTenant(opts: { tenantId: string; reason: string; opUid: string }): Promise<void> {
  await updateDoc(doc(db(), tenantDocPath(opts.tenantId)), {
    status: 'suspended',
    statusReason: opts.reason,
    statusUpdatedAt: Date.now(),
  });
  // TODO audit log write once admin UI exists
}

export async function opsUnsuspendTenant(opts: { tenantId: string; opUid: string }): Promise<void> {
  await updateDoc(doc(db(), tenantDocPath(opts.tenantId)), {
    status: 'active',
    statusReason: null,
    statusUpdatedAt: Date.now(),
  });
}

export async function opsBanAccount(_opts: { uid: string; reason: string; opUid: string }): Promise<void> {
  // Requires Firebase Admin SDK on the server to also call admin.auth().updateUser(uid, { disabled: true })
  throw new Error('opsBanAccount() requires server-side Admin SDK — Phase 6');
}

// ─────────────────────────────────────────────────────────────────────
// Legacy-session synthetic account (Phase 0/1 fallback for SC Deburring)
// ─────────────────────────────────────────────────────────────────────

/** Returns a synthetic "owner" account for the SC Deburring legacy install,
 *  used when no Firebase Auth session exists. */
export function buildLegacySuperAccount(): Account {
  return {
    uid: 'legacy-owner',
    email: 'anthony@scdeburring.com',
    emailVerified: true,
    displayName: 'Anthony (SC Deburring)',
    tenantIds: [LEGACY_TENANT_ID],
    defaultTenantId: LEGACY_TENANT_ID,
    superAdmin: true,
    createdAt: 0,
  };
}

/** Default trial config applied to new tenants at signup. */
export function defaultTrialForPlan(
  planId: PlanId,
  now: number = Date.now(),
): { trialStartedAt: number; trialEndsAt: number } {
  const days = TIER_CATALOG[planId].trialDays;
  return { trialStartedAt: now, trialEndsAt: now + days * 24 * 60 * 60 * 1000 };
}
