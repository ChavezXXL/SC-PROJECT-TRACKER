// ═════════════════════════════════════════════════════════════════════
// FabTrack IO — Tenant Context & Path Helpers
//
// Central answer to two questions:
//   • "Which tenant is the user currently working inside?"
//   • "What Firestore collection path should I use?"
//
// LEGACY SAFETY: For the SC Deburring tenant (`id === LEGACY_TENANT_ID`
// OR `tenant.isLegacy === true`), path helpers return FLAT paths
// (`jobs`, `logs`, `settings`) — matching today's code. New tenants get
// scoped paths (`tenants/{id}/jobs`, etc.).
//
// This is the hinge that lets us roll out multi-tenancy without any data
// migration on the live install.
// ═════════════════════════════════════════════════════════════════════

import type { Tenant } from './types';

/** Slug used for the SC Deburring tenant. Keeps flat-path mode by default. */
export const LEGACY_TENANT_ID = 'sc_deburring';

/** LocalStorage key where the resolved current-tenant id is cached. */
const LS_CURRENT_TENANT = 'fabtrack_current_tenant';

/** URL query param you can use to force a specific tenant (for testing / impersonation). */
const URL_PARAM_TENANT = 'tenant';

// ─────────────────────────────────────────────────────────────────────
// Path helpers
// ─────────────────────────────────────────────────────────────────────

/**
 * Return the Firestore collection path for a given collection inside a tenant.
 *
 *   colPath('sc_deburring', 'jobs')    → "jobs"               (legacy flat)
 *   colPath('acme-machining', 'jobs')  → "tenants/acme-machining/jobs"
 *   colPath(null, 'jobs')              → "jobs"               (no tenant == flat fallback)
 */
export function colPath(tenantId: string | null | undefined, collection: string): string {
  if (!tenantId || tenantId === LEGACY_TENANT_ID) return collection;
  return `tenants/${tenantId}/${collection}`;
}

/**
 * Return the Firestore path for a single document inside a tenant's collection.
 */
export function docPath(
  tenantId: string | null | undefined,
  collection: string,
  docId: string,
): string {
  return `${colPath(tenantId, collection)}/${docId}`;
}

/** Return the Firestore path for the tenant doc itself (top-level). */
export function tenantDocPath(tenantId: string): string {
  return `tenants/${tenantId}`;
}

/** Return the subscription path for a tenant. */
export function subscriptionPath(tenantId: string): string {
  return `tenants/${tenantId}/subscription/current`;
}

/** Return the settings path for a tenant. */
export function settingsPath(tenantId: string): string {
  if (!tenantId || tenantId === LEGACY_TENANT_ID) {
    // Current live install stores settings at `settings/system`
    return 'settings/system';
  }
  return `tenants/${tenantId}/settings/system`;
}

/** Return the member sub-collection path for a tenant. */
export function membersPath(tenantId: string): string {
  return `tenants/${tenantId}/members`;
}

// ─────────────────────────────────────────────────────────────────────
// Current tenant resolver
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve which tenant the current browser session should use.
 *
 * Resolution order:
 *   1. `?tenant=xxx` URL param (ops impersonation)
 *   2. LocalStorage cache (last tenant they switched to)
 *   3. The account's `defaultTenantId` (set at login)
 *   4. LEGACY fallback — SC Deburring
 *
 * This is intentionally simple and synchronous. The React hook
 * `useTenant()` wraps this to subscribe to the actual tenant doc.
 */
export function resolveCurrentTenantId(opts?: {
  defaultTenantId?: string;
}): string {
  // 1. URL override
  if (typeof window !== 'undefined') {
    try {
      const p = new URLSearchParams(window.location.search);
      const u = p.get(URL_PARAM_TENANT);
      if (u) return u;
    } catch { /* noop */ }

    // 2. LocalStorage cache
    try {
      const ls = window.localStorage.getItem(LS_CURRENT_TENANT);
      if (ls) return ls;
    } catch { /* noop */ }
  }

  // 3. Account default
  if (opts?.defaultTenantId) return opts.defaultTenantId;

  // 4. Legacy fallback
  return LEGACY_TENANT_ID;
}

/** Persist the current tenant selection (e.g. after a tenant switcher click). */
export function setCurrentTenantId(tenantId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(LS_CURRENT_TENANT, tenantId);
  } catch { /* noop */ }
}

/** Clear the persisted tenant selection (e.g. on logout). */
export function clearCurrentTenantId(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LS_CURRENT_TENANT);
  } catch { /* noop */ }
}

// ─────────────────────────────────────────────────────────────────────
// Convenience guards
// ─────────────────────────────────────────────────────────────────────

export function isLegacyTenant(tenant: Tenant | null | undefined): boolean {
  return !!tenant && (tenant.isLegacy === true || tenant.id === LEGACY_TENANT_ID);
}

/** Default Tenant shape for the SC Deburring legacy install. */
export function buildLegacyTenant(ownerUid: string): Tenant {
  return {
    id: LEGACY_TENANT_ID,
    name: 'SC Deburring LLC',
    slug: 'sc-deburring',
    ownerUid,
    createdAt: 0,          // pre-tenant
    status: 'active',
    isLegacy: true,
    billingEmail: 'anthony@scdeburring.com',
    timezone: 'America/Los_Angeles',
  };
}
