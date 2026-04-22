// ═════════════════════════════════════════════════════════════════════
// Onboarding Wizard — first-run experience that tailors the app per shop.
//
// 5 questions, progressive disclosure:
//   1. What does your shop do? (multi-select: deburring, plating, machining...)
//   2. How big is the shop? (solo / small / medium / large)
//   3. Any certifications? (ISO, AS9100, Nadcap, ITAR, FDA)
//   4. Do you quote customers? (Yes = show Quotes section)
//   5. Workflow questions (batches? tanks? NCR tracking?) — conditional on type
//
// Output: settings.shopProfile + settings.enabledFeatures derived.
// Can be re-run from Settings → Shop Profile later.
// ═════════════════════════════════════════════════════════════════════

import React, { useState } from 'react';
import { ArrowRight, ArrowLeft, Check, Sparkles } from 'lucide-react';
import type { ShopProfile, ShopType, ShopSize, Certification, ChargeBasis, SystemSettings } from '../types';
import { deriveFeatures, SHOP_TYPE_META, SHOP_SIZE_META, CERT_META } from '../utils/shopProfile';

interface OnboardingWizardProps {
  currentSettings: SystemSettings;
  onComplete: (updated: SystemSettings) => void;
  onSkip?: () => void;
  canSkip?: boolean;
}

type Step = 'welcome' | 'types' | 'size' | 'certs' | 'workflow' | 'review';

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ currentSettings, onComplete, onSkip, canSkip = false }) => {
  // Seed from existing profile if re-running
  const prior = currentSettings.shopProfile;
  const [step, setStep] = useState<Step>('welcome');
  const [types, setTypes] = useState<ShopType[]>(prior?.types || []);
  const [size, setSize] = useState<ShopSize>(prior?.size || 'small');
  const [certifications, setCertifications] = useState<Certification[]>(prior?.certifications || []);
  const [chargesBy, setChargesBy] = useState<ChargeBasis[]>(prior?.chargesBy || ['hour']);
  const [usesTanks, setUsesTanks] = useState<boolean>(prior?.usesTanks ?? false);
  const [usesBatches, setUsesBatches] = useState<boolean>(prior?.usesBatches ?? true);
  const [tracksNCR, setTracksNCR] = useState<boolean>(prior?.tracksNCR ?? false);
  const [makesQuotes, setMakesQuotes] = useState<boolean>(prior?.makesQuotes ?? true);
  const [sharedFloorTablet, setSharedFloorTablet] = useState<boolean>(prior?.sharedFloorTablet ?? true);
  const [notes, setNotes] = useState<string>(prior?.notes || '');

  const toggleType = (t: ShopType) => setTypes(cur => cur.includes(t) ? cur.filter(x => x !== t) : [...cur, t]);
  const toggleCert = (c: Certification) => setCertifications(cur => cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c]);

  const STEPS: Step[] = ['welcome', 'types', 'size', 'certs', 'workflow', 'review'];
  const stepIdx = STEPS.indexOf(step);
  const next = () => setStep(STEPS[Math.min(stepIdx + 1, STEPS.length - 1)]);
  const back = () => setStep(STEPS[Math.max(stepIdx - 1, 0)]);

  const finish = () => {
    const profile: ShopProfile = {
      types, size, certifications, chargesBy, usesTanks, usesBatches, tracksNCR, makesQuotes, sharedFloorTablet, notes,
      completedAt: Date.now(),
    };
    const enabledFeatures = deriveFeatures(profile);
    onComplete({
      ...currentSettings,
      shopProfile: profile,
      enabledFeatures,
      onboardingComplete: true,
    });
  };

  const canAdvance = (() => {
    if (step === 'types') return types.length > 0;
    return true;
  })();

  return (
    <div className="fixed inset-0 z-[10000] bg-gradient-to-br from-zinc-950 via-black to-zinc-950 overflow-y-auto animate-fade-in">
      {/* Ambient glow */}
      <div aria-hidden="true" className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/10 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-indigo-600/10 blur-[120px]" />
      </div>

      <div className="relative min-h-full flex items-center justify-center p-4 sm:p-8">
        <div className="w-full max-w-3xl bg-zinc-900/80 backdrop-blur-xl border border-white/10 rounded-3xl shadow-2xl overflow-hidden">
          {/* Progress bar */}
          <div className="h-1 bg-zinc-800">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-500"
              style={{ width: `${((stepIdx + 1) / STEPS.length) * 100}%` }}
            />
          </div>

          <div className="p-6 sm:p-10">
            {/* ═══ Step: Welcome ═══ */}
            {step === 'welcome' && (
              <div className="text-center space-y-6 py-8">
                <div className="inline-flex items-center justify-center w-20 h-20 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-xl shadow-blue-900/40">
                  <Sparkles className="w-10 h-10 text-white" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-3xl sm:text-5xl font-black text-white tracking-tight">Welcome aboard 👋</h1>
                  <p className="text-base sm:text-lg text-zinc-400 mt-3 max-w-xl mx-auto leading-relaxed">
                    We tailor the app to your shop. Answer a few quick questions and we'll turn on exactly the features you need — nothing you don't.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-3 pt-4">
                  <button
                    type="button"
                    onClick={next}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white px-8 py-3 rounded-xl font-bold text-base shadow-lg shadow-blue-900/40 flex items-center gap-2 transition-all"
                  >
                    Let's Go <ArrowRight className="w-5 h-5" aria-hidden="true" />
                  </button>
                  {canSkip && (
                    <button type="button" onClick={onSkip} className="text-sm text-zinc-500 hover:text-zinc-300 px-4 py-2">Skip for now</button>
                  )}
                </div>
                <p className="text-xs text-zinc-600">Takes under 60 seconds · you can edit anything later in Settings</p>
              </div>
            )}

            {/* ═══ Step: Types ═══ */}
            {step === 'types' && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Step 1 of 5</p>
                  <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">What does your shop do?</h2>
                  <p className="text-sm text-zinc-500 mt-1">Pick every service you offer. You can select multiple.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[50vh] overflow-y-auto pr-1">
                  {(Object.keys(SHOP_TYPE_META) as ShopType[]).map(t => {
                    const meta = SHOP_TYPE_META[t];
                    const selected = types.includes(t);
                    return (
                      <button
                        key={t}
                        type="button"
                        onClick={() => toggleType(t)}
                        className={`text-left px-4 py-3 rounded-xl border-2 transition-all flex items-start gap-3 ${selected ? 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-500/30' : 'bg-zinc-800/40 border-white/5 hover:border-white/20 hover:bg-zinc-800/70'}`}
                      >
                        <span className="text-2xl shrink-0" aria-hidden="true">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{meta.label}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{meta.desc}</p>
                        </div>
                        {selected && <Check className="w-5 h-5 text-blue-400 shrink-0" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ═══ Step: Size ═══ */}
            {step === 'size' && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Step 2 of 5</p>
                  <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">How big is the shop?</h2>
                  <p className="text-sm text-zinc-500 mt-1">Helps us tune the UI for your team size.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(Object.keys(SHOP_SIZE_META) as ShopSize[]).map(s => {
                    const meta = SHOP_SIZE_META[s];
                    const selected = size === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setSize(s)}
                        className={`text-left px-4 py-4 rounded-xl border-2 transition-all ${selected ? 'bg-blue-500/10 border-blue-500/50 ring-1 ring-blue-500/30' : 'bg-zinc-800/40 border-white/5 hover:border-white/20'}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-lg font-black text-white">{meta.label}</p>
                          {selected && <Check className="w-5 h-5 text-blue-400" aria-hidden="true" />}
                        </div>
                        <p className="text-xs text-blue-400 font-bold mt-0.5">{meta.operators}</p>
                        <p className="text-[11px] text-zinc-500 mt-1">{meta.desc}</p>
                      </button>
                    );
                  })}
                </div>
                <label className="flex items-start gap-2.5 cursor-pointer p-3 rounded-xl bg-zinc-800/30 border border-white/5 hover:border-white/10">
                  <input type="checkbox" checked={sharedFloorTablet} onChange={e => setSharedFloorTablet(e.target.checked)} className="w-4 h-4 mt-0.5 rounded accent-blue-500" />
                  <div>
                    <p className="text-sm font-bold text-white">Workers use a shared tablet on the floor</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">They'll clock in with a 4-digit PIN. Unlimited operators, no per-seat fees.</p>
                  </div>
                </label>
              </div>
            )}

            {/* ═══ Step: Certifications ═══ */}
            {step === 'certs' && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Step 3 of 5</p>
                  <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">Any quality certifications?</h2>
                  <p className="text-sm text-zinc-500 mt-1">We'll unlock NCR tracking + audit trail exports for certified shops.</p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {(Object.keys(CERT_META) as Certification[]).map(c => {
                    const meta = CERT_META[c];
                    const selected = certifications.includes(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => toggleCert(c)}
                        className={`text-left px-4 py-3 rounded-xl border-2 transition-all flex items-start gap-3 ${selected ? 'bg-emerald-500/10 border-emerald-500/50 ring-1 ring-emerald-500/30' : 'bg-zinc-800/40 border-white/5 hover:border-white/20'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{meta.label}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5 leading-snug">{meta.desc}</p>
                        </div>
                        {selected && <Check className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>
                {certifications.length === 0 && (
                  <p className="text-[11px] text-zinc-600 italic">No certifications? That's fine — this step is optional.</p>
                )}
              </div>
            )}

            {/* ═══ Step: Workflow ═══ */}
            {step === 'workflow' && (
              <div className="space-y-5">
                <div>
                  <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Step 4 of 5</p>
                  <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">How do you work?</h2>
                  <p className="text-sm text-zinc-500 mt-1">A few yes/no questions to turn on the right tools.</p>
                </div>
                <div className="space-y-2.5">
                  {[
                    { key: 'quotes', label: 'Do you quote customers before work?', desc: 'We\'ll enable the Quotes section + customer portal', value: makesQuotes, set: setMakesQuotes },
                    { key: 'batches', label: 'Do you batch parts together through processes?', desc: 'Rack/batch tracking (e.g. 500 parts in one tumbler run)', value: usesBatches, set: setUsesBatches },
                    { key: 'tanks', label: 'Do you use chemistry tanks?', desc: 'Plating, anodizing, passivation, cleaning, etc.', value: usesTanks, set: setUsesTanks },
                    { key: 'ncr', label: 'Do you track rework / NCRs formally?', desc: 'Non-conformance reports, corrective actions', value: tracksNCR, set: setTracksNCR },
                  ].map(q => (
                    <div key={q.key} className={`p-4 rounded-xl border-2 transition-all ${q.value ? 'bg-blue-500/5 border-blue-500/30' : 'bg-zinc-800/30 border-white/5'}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-bold text-white">{q.label}</p>
                          <p className="text-[11px] text-zinc-500 mt-0.5">{q.desc}</p>
                        </div>
                        <div role="group" className="flex gap-1 shrink-0">
                          <button type="button" onClick={() => q.set(true)} className={`px-3 py-1 text-xs font-bold rounded ${q.value ? 'bg-emerald-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>Yes</button>
                          <button type="button" onClick={() => q.set(false)} className={`px-3 py-1 text-xs font-bold rounded ${!q.value ? 'bg-zinc-700 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}>No</button>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">How do you charge? <span className="text-zinc-600 font-normal normal-case">(pick any that apply)</span></label>
                    <div className="flex flex-wrap gap-2">
                      {(['hour', 'piece', 'lot', 'mixed'] as ChargeBasis[]).map(c => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setChargesBy(cur => cur.includes(c) ? cur.filter(x => x !== c) : [...cur, c])}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold capitalize transition-colors ${chargesBy.includes(c) ? 'bg-blue-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'}`}
                        >
                          {chargesBy.includes(c) && <Check className="w-3 h-3 inline mr-1" aria-hidden="true" />}
                          {c === 'hour' ? 'Per Hour' : c === 'piece' ? 'Per Piece' : c === 'lot' ? 'Per Lot' : 'Mixed'}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ═══ Step: Review ═══ */}
            {step === 'review' && (() => {
              const preview = deriveFeatures({
                types, size, certifications, chargesBy, usesTanks, usesBatches, tracksNCR, makesQuotes, sharedFloorTablet, notes, completedAt: Date.now(),
              });
              const enabledList = Object.entries(preview).filter(([, v]) => v).map(([k]) => k);
              return (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-black text-blue-400 uppercase tracking-widest">Step 5 of 5</p>
                    <h2 className="text-2xl sm:text-3xl font-black text-white mt-1">Here's your setup</h2>
                    <p className="text-sm text-zinc-500 mt-1">Review — you can change any of this later in Settings → Shop Profile.</p>
                  </div>
                  <div className="bg-zinc-800/40 border border-white/5 rounded-2xl p-4 space-y-3">
                    <div>
                      <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Your Shop</p>
                      <p className="text-sm text-white mt-0.5 font-bold">{types.map(t => SHOP_TYPE_META[t].label).join(' + ') || 'Not set'}</p>
                      <p className="text-xs text-zinc-500">{SHOP_SIZE_META[size].label} · {SHOP_SIZE_META[size].operators}</p>
                    </div>
                    {certifications.length > 0 && (
                      <div>
                        <p className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Certifications</p>
                        <p className="text-sm text-emerald-400 font-bold mt-0.5">{certifications.map(c => CERT_META[c].label).join(' · ')}</p>
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-2">✨ Features we're turning on for you</p>
                    <div className="flex flex-wrap gap-1.5">
                      {enabledList.map(k => (
                        <span key={k} className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-1 rounded-full capitalize">
                          ✓ {k.replace(/([A-Z])/g, ' $1').trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block mb-1.5">Anything else we should know? <span className="text-zinc-600 font-normal normal-case">(optional)</span></label>
                    <textarea
                      value={notes}
                      onChange={e => setNotes(e.target.value)}
                      placeholder="e.g. We run 2 shifts, do a lot of repeat work for Boeing, etc."
                      className="w-full bg-zinc-950 border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-blue-500/50 resize-y"
                      rows={2}
                    />
                  </div>
                </div>
              );
            })()}

            {/* ═══ Footer controls ═══ */}
            {step !== 'welcome' && (
              <div className="mt-8 pt-5 border-t border-white/5 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={back}
                  className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white px-3 py-2 rounded-lg transition-colors"
                >
                  <ArrowLeft className="w-4 h-4" aria-hidden="true" /> Back
                </button>
                {step === 'review' ? (
                  <button
                    type="button"
                    onClick={finish}
                    className="bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-900/40 flex items-center gap-2 transition-all"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" /> Finish Setup
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={next}
                    disabled={!canAdvance}
                    className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white px-6 py-2.5 rounded-xl font-bold text-sm shadow-lg shadow-blue-900/40 flex items-center gap-2 transition-all"
                  >
                    Next <ArrowRight className="w-4 h-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
