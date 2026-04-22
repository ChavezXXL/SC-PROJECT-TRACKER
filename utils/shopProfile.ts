// ═════════════════════════════════════════════════════════════════════
// Shop Profile → Feature Flag deriver.
//
// After a user completes the onboarding wizard, this function translates
// their answers ("we do deburring + passivation, ISO certified, 8 people")
// into concrete feature flags that gate the UI.
//
// Industry packs:
//   • Finishing Pack (Rack + Tank + Chemistry)  — plating/anodizing/passivation/coating/deburring
//   • ISO Pack (NCR + Audit Trail)             — any certification
//   • Assembly Pack (BOM + Kitting)            — assembly/fabrication
//
// The deriver is idempotent + pure — no side effects. Admins can still
// override any flag manually in Settings.
// ═════════════════════════════════════════════════════════════════════

import type { ShopProfile, EnabledFeatures, ShopType, Certification } from '../types';

/** Types of shops that use tanks + chemistry by default. */
const TANK_USERS: ShopType[] = ['plating', 'anodizing', 'passivation', 'coating'];
/** Types that always batch parts through processes. */
const BATCH_USERS: ShopType[] = ['deburring', 'plating', 'anodizing', 'passivation', 'coating'];
/** Types where assembly/kitting is the primary workflow. */
const ASSEMBLY_USERS: ShopType[] = ['assembly', 'fabrication'];

export function deriveFeatures(profile: ShopProfile): EnabledFeatures {
  const types = profile.types || [];
  const hasAnyTankType = types.some(t => TANK_USERS.includes(t));
  const hasAnyBatchType = types.some(t => BATCH_USERS.includes(t));
  const hasAnyAssemblyType = types.some(t => ASSEMBLY_USERS.includes(t));
  const hasCerts = (profile.certifications || []).length > 0;

  return {
    // Finishing Pack — driven by tank/batch usage OR matching shop types
    rackTracking: profile.usesBatches || hasAnyBatchType,
    tankSessions: profile.usesTanks || hasAnyTankType,
    chemistryLog: profile.usesTanks || hasAnyTankType,
    // ISO Pack — any cert or explicit NCR tracking
    ncrModule: profile.tracksNCR || hasCerts,
    auditTrail: hasCerts,
    // Assembly Pack
    bomTracking: hasAnyAssemblyType,
    kitting: hasAnyAssemblyType,
    // Quoting
    quoteProcessLibrary: profile.makesQuotes,
    quoteMarginCalc: profile.makesQuotes,
    // Core — always on
    samples: true,
    tvSlideshow: true,
    customerPortal: true,
    scheduler: true,
  };
}

/** Human-readable label for shop types — shown in the wizard + settings. */
export const SHOP_TYPE_META: Record<ShopType, { label: string; icon: string; desc: string }> = {
  deburring:     { label: 'Deburring / Finishing', icon: '⚙️',  desc: 'Vibratory, tumbling, hand deburr, brushing' },
  plating:       { label: 'Plating',               icon: '🧪',  desc: 'Nickel, chrome, zinc, gold, etc.' },
  anodizing:     { label: 'Anodizing',             icon: '🧽',  desc: 'Type II/III anodizing, chem-film' },
  passivation:   { label: 'Passivation',           icon: '💧',  desc: 'Stainless steel per ASTM/AMS' },
  coating:       { label: 'Coating / Paint',       icon: '🎨',  desc: 'Powder coat, e-coat, paint, Cerakote' },
  machining:     { label: 'Machining',             icon: '⚙',  desc: 'CNC mill, lathe, manual machining' },
  welding:       { label: 'Welding',               icon: '🔥',  desc: 'TIG, MIG, spot, fabrication' },
  fabrication:   { label: 'Sheet Metal / Fab',     icon: '🛠️',  desc: 'Laser, brake, shear, forming' },
  assembly:      { label: 'Assembly',              icon: '🔧',  desc: 'Final assembly, kitting, pack-out' },
  molding:       { label: 'Molding',               icon: '🏭',  desc: 'Injection, thermo, compression' },
  woodworking:   { label: 'Woodworking',           icon: '🪵',  desc: 'Cabinet, millwork, custom wood' },
  other:         { label: 'Something Else',        icon: '✨',  desc: "We'll tailor the app based on your answers" },
};

export const SHOP_SIZE_META: Record<'solo' | 'small' | 'medium' | 'large', { label: string; desc: string; operators: string }> = {
  solo:   { label: 'Just Me',   operators: '1 person',  desc: "I'm the owner-operator" },
  small:  { label: 'Small',     operators: '2–5 people',  desc: 'A tight crew' },
  medium: { label: 'Growing',   operators: '6–15 people', desc: 'Multiple stations going at once' },
  large:  { label: 'Large',     operators: '15+ people',  desc: 'Full shop, multi-shift' },
};

export const CERT_META: Record<Certification, { label: string; desc: string }> = {
  'iso-9001': { label: 'ISO 9001',  desc: 'General quality management' },
  'as-9100':  { label: 'AS 9100',   desc: 'Aerospace quality' },
  'nadcap':   { label: 'Nadcap',    desc: 'Aerospace special processes' },
  'itar':     { label: 'ITAR',      desc: 'Defense export control' },
  'fda':      { label: 'FDA',       desc: 'Medical devices' },
  'as-9102':  { label: 'AS 9102',   desc: 'First Article Inspection' },
  'other':    { label: 'Other',     desc: 'Something else' },
};
