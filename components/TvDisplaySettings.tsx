// ═════════════════════════════════════════════════════════════════════
// Settings → TV Display
//
// Everything about the wall TVs in one place: connect a TV with the code it
// shows, see that each one is on and live, refresh it from here, and choose
// what the board shows and when. Every control on this page is one the TV
// actually reads — the old tab had five switches the TV ignored, and a
// hand-drawn "preview". Preview now opens the real board.
// ═════════════════════════════════════════════════════════════════════

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle, Cake, CheckCircle, ChevronDown, ChevronUp, Cloud, Copy, ExternalLink, Eye, Layers,
  Lightbulb, Lock, MapPin, Monitor, Moon, Pencil, Plus, RefreshCw, Trash2, Tv, Unplug, X,
} from 'lucide-react';
import type { SystemSettings, TvDevice, TvSlide, SlideMessage } from '../types';
import * as DB from '../services/mockDb';
import { useConfirm, type ConfirmOptions } from './useConfirm';
import { Toggle } from './Toggle';
import { TV_SLIDE_CATALOG, DEFAULT_TV_SLIDES, slideMeta, effectiveTvSlides } from '../utils/tvSlides';
import { appBuild, tvHomeUrl, newTvToken, isTvQuiet, tvQuietUntil, resumeLabel } from '../utils/tvRuntime';

type SetSettings = React.Dispatch<React.SetStateAction<SystemSettings>>;
type Patch = (changes: Partial<SystemSettings>) => void;
type Confirm = (o: ConfirmOptions) => Promise<boolean>;
type Toast = (type: 'success' | 'error' | 'info', message: string) => void;
type SaveNow = (changes: Partial<SystemSettings>) => Promise<boolean>;
type CatalogType = keyof typeof TV_SLIDE_CATALOG;

// ── Small building blocks ────────────────────────────────────────────

const Card = ({ anchor, icon, title, desc, right, children }: {
  anchor: string; icon: React.ReactNode; title: string; desc?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode;
}) => (
  <section data-settings-anchor={anchor} className="bg-zinc-900/50 border border-white/5 rounded-2xl p-4 sm:p-5">
    <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
      <div className="flex items-start gap-3 min-w-0">
        <span className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0" aria-hidden="true">{icon}</span>
        <div className="min-w-0">
          <h4 className="text-sm font-black text-white">{title}</h4>
          {desc && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>}
        </div>
      </div>
      {right}
    </div>
    {children}
  </section>
);

const SwitchRow = ({ label, desc, checked, onChange }: { label: string; desc?: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="flex items-center justify-between gap-4 py-2.5">
    <div className="min-w-0">
      <p className="text-sm font-bold text-white">{label}</p>
      {desc && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>}
    </div>
    <Toggle checked={checked} onChange={onChange} label={label} />
  </div>
);

const FieldRow = ({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2.5">
    <div className="min-w-0">
      <p className="text-sm font-bold text-white">{label}</p>
      {desc && <p className="text-xs text-zinc-500 mt-0.5 leading-snug">{desc}</p>}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 p-1 bg-zinc-950 border border-white/10 rounded-xl">
      {options.map(o => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}
          className={`px-3 min-h-[34px] text-xs font-bold rounded-lg transition-colors ${value === o.value ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white hover:bg-white/5'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

const Btn = ({ onClick, children, tone = 'plain', disabled, title }: {
  onClick: () => void; children: React.ReactNode; tone?: 'plain' | 'danger' | 'primary'; disabled?: boolean; title?: string;
}) => (
  <button type="button" onClick={onClick} disabled={disabled} title={title}
    className={`inline-flex items-center gap-1.5 px-3 min-h-[34px] rounded-lg text-xs font-bold transition-colors disabled:opacity-40 ${
      tone === 'danger' ? 'bg-white/5 text-zinc-300 hover:bg-red-500/15 hover:text-red-300'
      : tone === 'primary' ? 'bg-amber-600 text-white hover:bg-amber-500'
      : 'bg-white/5 text-zinc-200 hover:bg-white/10'}`}>
    {children}
  </button>
);

const selectCls = 'bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-2 text-sm text-white';
const inputCls = 'bg-zinc-950 border border-white/10 rounded-xl px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:border-amber-500/60 outline-none';

const hourLabel = (h: number) => new Date(2000, 0, 1, h).toLocaleTimeString('en-US', { hour: 'numeric' });

function copyText(text: string, addToast: Toast, done = 'Copied') {
  if (!navigator.clipboard) { addToast('error', "Couldn't copy — select it and copy it by hand"); return; }
  navigator.clipboard.writeText(text).then(
    () => addToast('success', done),
    () => addToast('error', "Couldn't copy — select it and copy it by hand"),
  );
}

// ── Wall TVs: connect + live status ──────────────────────────────────

const CHECK_IN_GRACE_MS = 7 * 60_000;   // TVs check in every 5 minutes

const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h ago` : `${Math.floor(h / 24)} days ago`;
};

function tvState(d: TvDevice, now: number): { tone: 'live' | 'warn' | 'down' | 'off'; label: string; detail: string } {
  if (d.revoked) return { tone: 'off', label: 'Disconnected', detail: "It's showing a connect code — type it above to bring it back." };
  const age = now - (d.lastSeen || 0);
  if (age > CHECK_IN_GRACE_MS) return { tone: 'down', label: 'Not responding', detail: `Last heard from ${ago(age)}. It may be off, asleep, or offline.` };
  if (!d.online) return { tone: 'warn', label: 'No internet', detail: 'Showing the last data it received.' };
  if (!d.synced) return { tone: 'warn', label: 'Reconnecting', detail: 'Showing the last data it received — catches up by itself.' };
  return { tone: 'live', label: 'Live', detail: `Checked in ${ago(age)}` };
}

function TvRow({ d, now, confirm, addToast }: { d: TvDevice; now: number; confirm: Confirm; addToast: Toast }) {
  const st = tvState(d, now);
  const name = d.name || 'TV';
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const responding = st.tone === 'live' || st.tone === 'warn';
  const build = appBuild();
  // Builds are "YYYY-MM-DD HH:MM", so they compare as text.
  const outdated = responding && !!d.build && d.build !== 'dev' && build !== 'dev' && d.build < build;

  const act = async (fn: () => Promise<void>, done: string) => {
    setBusy(true);
    try { await fn(); addToast('success', done); }
    catch { addToast('error', "Couldn't reach the server — try again"); }
    finally { setBusy(false); }
  };
  const saveName = () => {
    const n = draft.trim();
    setRenaming(false);
    if (n && n !== d.name) act(() => DB.renameTvDevice(d.id, n), 'Renamed');
  };
  const disconnect = async () => {
    const ok = await confirm({
      title: `Disconnect ${name}?`,
      message: 'It stops showing the board and shows a connect code instead. Type that code here to connect it again.',
      tone: 'warning', confirmLabel: 'Disconnect',
    });
    if (ok) act(() => DB.sendTvCommand(d.id, 'disconnect'), `${name} disconnected`);
  };
  const remove = async () => {
    const ok = await confirm({
      title: `Remove ${name} from the list?`,
      message: d.revoked
        ? "It's already disconnected — this just takes it off the list."
        : "It's disconnected and taken off the list. If it's still plugged in somewhere, it shows a connect code the next time it turns on.",
      tone: 'warning', confirmLabel: 'Remove',
    });
    if (ok) act(() => DB.removeTvDevice(d.id), `${name} removed`);
  };

  const dot = st.tone === 'live' ? 'bg-emerald-400' : st.tone === 'warn' ? 'bg-amber-400 animate-pulse' : st.tone === 'down' ? 'bg-red-400' : 'bg-zinc-600';
  const toneText = st.tone === 'live' ? 'text-emerald-400' : st.tone === 'warn' ? 'text-amber-400' : st.tone === 'down' ? 'text-red-400' : 'text-zinc-400';
  const fireTv = d.agent === 'Amazon Fire TV';
  const deviceLabel = d.model ? (d.model.includes(' · ') ? d.model.split(' · ')[0] : `${d.agent || 'Fire TV'} ${d.model}`) : d.agent;
  const facts = [deviceLabel, d.screen, responding && d.slide ? `showing “${d.slide}”` : ''].filter(Boolean).join(' · ');
  // The last time it went away on its own: the kept report (survives the
  // planned reloads after it), else the previous session's ending.
  const keptCrash = !!d.lastCrash && (!d.lastCrashAt || now - d.lastCrashAt < 7 * 86_400_000);
  const crashText = keptCrash ? d.lastCrash! : (d.prevExit && /stopped without closing|screen error/i.test(d.prevExit) ? d.prevExit : '');
  const crashLog = keptCrash ? d.lastCrashLog : d.prevLog;

  return (
    <li className="rounded-xl border border-white/5 bg-zinc-950/40 p-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span className={`mt-1.5 w-2.5 h-2.5 rounded-full shrink-0 ${dot}`} aria-hidden="true" />
        <div className="flex-1 min-w-[12rem]">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <input autoFocus aria-label="TV name" maxLength={40} value={draft} onChange={e => setDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') { setRenaming(false); setDraft(name); } }}
                className="flex-1 min-w-0 bg-zinc-950 border border-white/15 rounded-lg px-2 py-1 text-sm text-white focus:border-amber-500/60 outline-none" />
              <Btn tone="primary" onClick={saveName}>Save</Btn>
              <button type="button" aria-label="Cancel rename" onClick={() => { setRenaming(false); setDraft(name); }} className="p-1.5 text-zinc-500 hover:text-white"><X className="w-4 h-4" aria-hidden="true" /></button>
            </div>
          ) : (
            <p className="text-sm font-black text-white flex items-center gap-1.5 min-w-0">
              <span className="truncate">{name}</span>
              <button type="button" onClick={() => { setDraft(name); setRenaming(true); }} aria-label={`Rename ${name}`} className="p-1 text-zinc-600 hover:text-white shrink-0">
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </p>
          )}
          <p className="text-xs mt-0.5"><span className={`font-bold ${toneText}`}>{st.label}</span> <span className="text-zinc-500">· {st.detail}</span></p>
          {facts && <p className="text-[11px] text-zinc-600 mt-1">{facts}{d.mem ? ` · memory ${d.mem}` : ''}</p>}
          {outdated && <p className="text-[11px] text-amber-400 mt-1 font-bold">Running an older version — press Refresh to update it.</p>}
          {/* Health — so "the TV just went away" can be explained afterwards. */}
          {crashText && (
            <div className="mt-1">
              <p className="text-[11px] text-amber-400/90">Last time it went off the screen: {crashText}</p>
              <p className="text-[11px] text-zinc-300 mt-0.5">{crashAdvice(crashText, fireTv)}</p>
              {crashLog && (
                <details className="mt-1">
                  <summary className="text-[11px] text-zinc-500 cursor-pointer hover:text-zinc-300">What it was doing before that</summary>
                  <p className="text-[10px] text-zinc-500 mt-1 leading-relaxed break-words">{crashLog}</p>
                </details>
              )}
            </div>
          )}
          {(d.startsToday || 0) > 3 && <p className="text-[11px] text-amber-400/90 mt-1">Restarted {d.startsToday} times today.</p>}
          {responding && d.visible === false && <p className="text-[11px] text-amber-400/90 mt-1">The board is covered — the TV is showing its screensaver or home screen.</p>}
          {responding && d.visible !== false && d.focused === false && (
            <p className="text-[11px] text-amber-400/90 mt-1">A pop-up or menu is in front of the board{fireTv ? ' — on a Fire TV that is usually “Still watching?”' : ''}.</p>
          )}
          {responding && fireTv && Number(d.input?.match(/^0 mouse moves.* in (\d+) min/)?.[1] || 0) >= 4 && (
            <p className="text-[11px] text-zinc-500 mt-1">No mouse movement reaches this TV, so a mouse jiggler isn't keeping it awake (see “Keep the TV on, all day” below).</p>
          )}
          {responding && d.wakeLock === false && d.visible !== false && (
            <p className="text-[11px] text-zinc-500 mt-1">This TV's browser won't hold the screen on by itself — set the TV's own sleep and screensaver to Never (tips below).</p>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {responding && (
            <Btn disabled={busy} title="Shows this TV's name on its screen for 10 seconds" onClick={() => act(() => DB.sendTvCommand(d.id, 'identify'), `${name} is showing its name`)}>
              <Eye className="w-3.5 h-3.5" aria-hidden="true" />Show name
            </Btn>
          )}
          {responding && (
            <Btn disabled={busy} onClick={() => act(() => DB.sendTvCommand(d.id, 'reload'), `${name} is refreshing`)}>
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />Refresh
            </Btn>
          )}
          {!d.revoked && (
            <Btn tone="danger" disabled={busy} onClick={disconnect}><Unplug className="w-3.5 h-3.5" aria-hidden="true" />Disconnect</Btn>
          )}
          {(d.revoked || st.tone === 'down') && (
            <Btn tone="danger" disabled={busy} onClick={remove}><Trash2 className="w-3.5 h-3.5" aria-hidden="true" />Remove</Btn>
          )}
        </div>
      </div>
    </li>
  );
}

/** What to do about the last time a TV went off the screen, from the clues it left. */
function crashAdvice(text: string, fireTv: boolean): string {
  if (/^screen error/i.test(text)) return 'The board hit an error and restarted itself.';
  const tookScreen = /pop-up or menu came up|screen hidden since/i.test(text);
  if (fireTv && tookScreen) return 'The Fire TV took the board off the screen itself — most likely its Still Watching timer. On the TV: Settings → Preferences → Data Usage Monitoring → Still Watching: Off.';
  if (fireTv) return 'The browser stopped without warning. Turn off Still Watching first (Fire TV Settings → Preferences → Data Usage Monitoring); if it still happens, a kiosk browser app (Fully Kiosk Browser) reopens the board by itself.';
  if (tookScreen) return "The TV covered the board (screensaver, home screen or sleep). Turn off the TV's own sleep and screensaver timers (tips below).";
  return 'The browser stopped without warning (crash, out of memory, or the TV slept). The tips below keep it on.';
}

function AdvancedLink({ settings, saveNow, confirm, addToast }: { settings: SystemSettings; saveNow: SaveNow; confirm: Confirm; addToast: Toast }) {
  const token = settings.tvToken;
  const link = token ? `${window.location.origin}/tv?tv=${token}` : '';
  const makeNew = async () => {
    if (token && !(await confirm({
      title: 'Make a new TV link?',
      message: 'Every connected TV is disconnected and shows a new code — you will need to connect each one again. Do this if the link got out.',
      tone: 'danger', confirmLabel: 'Make new link',
    }))) return;
    if (!token) {
      try { await DB.ensureTvToken(); addToast('success', 'TV link made'); }
      catch { addToast('error', "Couldn't save — check the internet and try again"); }
      return;
    }
    const ok = await saveNow({ tvToken: newTvToken() });
    if (!ok) addToast('error', "Couldn't save — check the internet and try again");
    else addToast('success', 'New link made — connect each TV again with its code');
  };
  return (
    <details data-settings-anchor="tv-link" className="group mt-4 rounded-xl border border-white/5">
      <summary className="px-3 py-2.5 cursor-pointer flex items-center justify-between gap-2 text-xs font-bold text-zinc-400 hover:text-white">
        <span>Advanced — direct link, start over</span>
        <ChevronDown className="w-4 h-4 group-open:rotate-180 transition-transform" aria-hidden="true" />
      </summary>
      <div className="px-3 pb-3 space-y-3">
        {token ? (
          <div>
            <p className="text-xs text-zinc-400 mb-1.5 leading-snug">Direct link — for a TV that can't show the code screen. Anyone with it can see your board, so don't post it anywhere.</p>
            <div className="flex gap-2">
              <input readOnly value={link} aria-label="Direct TV link" onFocus={e => e.currentTarget.select()}
                className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono" />
              <Btn onClick={() => copyText(link, addToast, 'Link copied')}><Copy className="w-3.5 h-3.5" aria-hidden="true" />Copy</Btn>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-500">No TV link yet — one is made the first time you connect a TV.</p>
        )}
        <Btn tone="danger" onClick={makeNew}>{token ? 'Make a new link (disconnects every TV)' : 'Make the TV link now'}</Btn>
      </div>
    </details>
  );
}

const Step = ({ n }: { n: number }) => (
  <span className="w-6 h-6 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-black flex items-center justify-center shrink-0 mt-0.5" aria-hidden="true">{n}</span>
);

function WallTvs({ settings, devices, now, saveNow, confirm, addToast }: {
  settings: SystemSettings; devices: TvDevice[] | null; now: number; saveNow: SaveNow; confirm: Confirm; addToast: Toast;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const home = tvHomeUrl();
  const connectedCount = (devices || []).filter(d => !d.revoked).length;
  const suggested = connectedCount === 0 ? 'Shop TV' : `TV ${connectedCount + 1}`;
  const shown = code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;

  const connect = async () => {
    if (code.length !== 6 || busy) return;
    setBusy(true);
    setResult(null);
    try {
      // ensureTvToken reads the server first — a fresh browser shows no link
      // until settings arrive, and minting one then dropped every TV.
      const token = settings.tvToken || await DB.ensureTvToken();
      const tvName = name.trim() || suggested;
      const r = await DB.approveTvPairing(code, token, tvName);
      if (r === 'ok') {
        setResult({ ok: true, msg: `${tvName} is connected — it switches to the board in a few seconds.` });
        setCode('');
        setName('');
      } else if (r === 'expired') {
        setResult({ ok: false, msg: 'That code expired. The TV is showing a new one — type that instead.' });
      } else {
        setResult({ ok: false, msg: 'No TV is showing that code. Check the number on the TV screen.' });
      }
    } catch {
      setResult({ ok: false, msg: "Couldn't reach the server — check this device's internet and try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card anchor="tv-connect" icon={<Tv className="w-4 h-4" />} title="Wall TVs"
      desc="Connect each TV once. It remembers the connection, stays on, and reconnects by itself after Wi-Fi drops or power cuts.">
      <ol className="space-y-4">
        <li className="flex gap-3">
          <Step n={1} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-300">On the TV's web browser, go to</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              <code className="px-3 py-1.5 rounded-lg bg-black/40 border border-white/10 text-amber-300 font-mono text-sm font-bold break-all">{home.replace(/^https?:\/\//, '')}</code>
              <Btn onClick={() => copyText(home, addToast, 'Address copied')}><Copy className="w-3.5 h-3.5" aria-hidden="true" />Copy</Btn>
            </div>
          </div>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-300">It shows a 6-digit code. Type it here and name the TV:</p>
            <div className="mt-2 flex flex-wrap items-stretch gap-2">
              <input aria-label="Code shown on the TV" inputMode="numeric" autoComplete="off" placeholder="123 456" value={shown}
                onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setResult(null); }}
                onKeyDown={e => { if (e.key === 'Enter') connect(); }}
                className={`${inputCls} w-36 text-center text-lg font-black tracking-[0.2em]`} />
              <input aria-label="Name for this TV" placeholder={suggested} maxLength={40} value={name}
                onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') connect(); }}
                className={`${inputCls} flex-1 min-w-[9rem]`} />
              <button type="button" onClick={connect} disabled={busy || code.length !== 6}
                className="px-5 min-h-[44px] rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-black transition-colors">
                {busy ? 'Connecting…' : 'Connect'}
              </button>
            </div>
            <div aria-live="polite">
              {result && (
                <p className={`mt-2 text-xs font-bold flex items-start gap-1.5 ${result.ok ? 'text-emerald-400' : 'text-red-400'}`}>
                  {result.ok ? <CheckCircle className="w-4 h-4 shrink-0" aria-hidden="true" /> : <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />}
                  {result.msg}
                </p>
              )}
            </div>
          </div>
        </li>
      </ol>

      <div className="mt-5">
        <p className="text-[11px] font-black uppercase tracking-widest text-zinc-500 mb-2">
          Your TVs{devices && devices.length > 0 ? ` · ${devices.length}` : ''}
        </p>
        {devices === null ? (
          <p className="text-xs text-zinc-500">Loading…</p>
        ) : devices.length === 0 ? (
          <p className="text-xs text-zinc-500 rounded-xl border border-dashed border-white/10 p-4 text-center">No TVs connected yet.</p>
        ) : (
          <ul className="space-y-2">
            {devices.map(d => <TvRow key={d.id} d={d} now={now} confirm={confirm} addToast={addToast} />)}
          </ul>
        )}
      </div>

      <AdvancedLink settings={settings} saveNow={saveNow} confirm={confirm} addToast={addToast} />
    </Card>
  );
}

// ── Keeping the TV on (things only the TV's own menu can change) ─────

const Tip = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <p className="text-sm font-black text-white">{title}</p>
    <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed">{children}</p>
  </div>
);

function SetupTips({ openWhenReady, refreshHour }: { openWhenReady: boolean | null; refreshHour: number }) {
  // Opens by itself for a shop with no TVs yet; never snaps shut on its own.
  const ref = useRef<HTMLDetailsElement>(null);
  const decided = useRef(false);
  useEffect(() => {
    if (decided.current || openWhenReady === null) return;
    decided.current = true;
    if (openWhenReady && ref.current) ref.current.open = true;
  }, [openWhenReady]);
  return (
    <details ref={ref} data-settings-anchor="tv-setup" className="group bg-zinc-900/50 border border-white/5 rounded-2xl overflow-hidden">
      <summary className="p-4 sm:px-5 cursor-pointer flex items-center justify-between gap-3 hover:bg-white/[0.02]">
        <span className="flex items-center gap-3 min-w-0">
          <span className="w-9 h-9 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center shrink-0" aria-hidden="true"><Lightbulb className="w-4 h-4" /></span>
          <span className="min-w-0">
            <span className="block text-sm font-black text-white">Keep the TV on, all day</span>
            <span className="block text-xs text-zinc-500 mt-0.5">A few one-time settings on the TV itself</span>
          </span>
        </span>
        <ChevronDown className="w-4 h-4 text-zinc-500 group-open:rotate-180 transition-transform shrink-0" aria-hidden="true" />
      </summary>
      <div className="px-4 sm:px-5 pb-5 grid gap-4 md:grid-cols-2">
        <Tip title="Turn off the TV's power saving">
          In the TV's own settings menu, turn off <b className="text-zinc-200">Auto Power Off</b>, the <b className="text-zinc-200">Sleep Timer</b>, <b className="text-zinc-200">Eco / Energy Saving</b> and the <b className="text-zinc-200">screen saver</b> (usually under General or Power). The board keeps the picture awake, but it can't overrule the TV's own timers.
        </Tip>
        <Tip title="Stop it switching inputs">
          Turn off HDMI-CEC — Samsung calls it <b className="text-zinc-200">Anynet+</b>, LG <b className="text-zinc-200">SimpLink</b>, Sony <b className="text-zinc-200">BRAVIA Sync</b>. Otherwise another device powering on can take over the screen.
        </Tip>
        <Tip title="Come back after a power cut">
          Set the TV browser's home page to <span className="font-mono text-amber-300">{tvHomeUrl().replace(/^https?:\/\//, '')}</span>. Most reliable: a Fire TV Stick or Android TV box with a kiosk browser app (for example Fully Kiosk Browser) set to open that address when it starts.
        </Tip>
        <Tip title="On a Fire TV — turn off Still Watching">
          Settings → <b className="text-zinc-200">Preferences</b> → <b className="text-zinc-200">Data Usage Monitoring</b> → Still Watching: <b className="text-zinc-200">Off</b>. Otherwise the Fire TV sends the board back to its home screen when nobody touches the remote (if its “Still watching?” pop-up is showing, choose <b className="text-zinc-200">Don't show again</b>). Also Display &amp; Sounds → Screensaver → Start Time: <b className="text-zinc-200">Never</b>, and on models with Ambient Experience its Advanced Settings → Timeout: <b className="text-zinc-200">Never</b>. A kiosk browser app (Fully Kiosk Browser) reopens the board by itself if the Fire TV ever closes it.
        </Tip>
        <Tip title="Mouse jiggler: plug it into the Fire TV">
          A jiggler only keeps awake the device it's plugged into. In a TV's own USB port it can't reach a Fire TV stick plugged into that TV — use a USB OTG adapter to plug it into the stick. The board ignores its small nudges, so the Exit button and cursor stay hidden. A TV that feels no mouse movement says so in the list above.
        </Tip>
        <Tip title="Wired internet if you can">
          On Wi-Fi the board rides out short drops — it says <b className="text-zinc-200">Reconnecting</b> and catches up by itself — but a cable is steadier.
        </Tip>
        <div className="md:col-span-2 rounded-xl bg-emerald-500/5 border border-emerald-500/15 p-3 text-xs text-zinc-400 leading-relaxed">
          <p className="font-black text-emerald-400 mb-1">The board handles the rest by itself</p>
          Keeps the screen awake · ignores the remote's Back button · reconnects after drops, and restarts itself if a connection gets stuck · refreshes once a night at {hourLabel(refreshHour)} to pick up updates.
        </div>
      </div>
    </details>
  );
}

// ── Look ─────────────────────────────────────────────────────────────

function ScreenCard({ settings, set }: { settings: SystemSettings; set: Patch }) {
  return (
    <Card anchor="tv-display" icon={<Monitor className="w-4 h-4" />} title="Screen" desc="How the board looks on the wall.">
      <div className="divide-y divide-white/5">
        <FieldRow label="Text size" desc="Bigger for screens read from across the shop.">
          <Segmented label="Text size" value={settings.tvTextSize || 'normal'} onChange={v => set({ tvTextSize: v })}
            options={[{ value: 'normal', label: 'Normal' }, { value: 'large', label: 'Large' }, { value: 'xl', label: 'Extra large' }]} />
        </FieldRow>
        <FieldRow label="Fit to screen" desc="Adds a margin if the TV cuts off the edges.">
          <Segmented label="Fit to screen" value={settings.tvScreenFit || 'small'} onChange={v => set({ tvScreenFit: v })}
            options={[{ value: 'none', label: 'Off' }, { value: 'small', label: 'Small' }, { value: 'large', label: 'Large' }]} />
        </FieldRow>
        <FieldRow label="Scrolling speed" desc="How fast long lists move.">
          <Segmented label="Scrolling speed" value={settings.tvScrollSpeed || 'normal'} onChange={v => set({ tvScrollSpeed: v })}
            options={[{ value: 'off', label: 'Off' }, { value: 'slow', label: 'Slow' }, { value: 'normal', label: 'Normal' }, { value: 'fast', label: 'Fast' }]} />
        </FieldRow>
        <SwitchRow label="Shop name & logo" checked={settings.tvCompanyHeader !== false} onChange={v => set({ tvCompanyHeader: v })} />
        <SwitchRow label="Clock" checked={settings.tvShowClock !== false} onChange={v => set({ tvShowClock: v })} />
        <SwitchRow label="Live counts" desc="Workers, running, open jobs — plus due today and overdue when there are any."
          checked={settings.tvShowStats !== false} onChange={v => set({ tvShowStats: v })} />
        <SwitchRow label="Outside temperature" checked={settings.tvShowWeather !== false} onChange={v => set({ tvShowWeather: v })} />
        <SwitchRow label="Connection badge" desc="“Live” — or “Reconnecting” with how old the data on screen is."
          checked={settings.tvShowConnection !== false} onChange={v => set({ tvShowConnection: v })} />
        <SwitchRow label="Burn-in guard" desc="Shifts the picture a few pixels every 2 minutes so nothing burns into the screen."
          checked={settings.tvBurnInGuard !== false} onChange={v => set({ tvBurnInGuard: v })} />
      </div>
    </Card>
  );
}

// ── When it's on ─────────────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ScheduleCard({ settings, set, now }: { settings: SystemSettings; set: Patch; now: number }) {
  const tz = settings.recapTimezone || 'America/Los_Angeles';   // the TV runs on shop time
  const q = settings.tvQuietHours;
  const enabled = !!q?.enabled;
  const start = q?.start || '18:00';
  const end = q?.end || '05:00';
  const days = q?.days || [];
  const quiet = { enabled, start, end, days };
  const setQuiet = (patch: Partial<typeof quiet>) => set({ tvQuietHours: { ...quiet, ...patch } });
  const nowDate = new Date(now);
  const quietNow = isTvQuiet(quiet, nowDate, tz);
  const until = quietNow ? tvQuietUntil(quiet, nowDate, tz) : null;

  return (
    <Card anchor="tv-quiet" icon={<Moon className="w-4 h-4" />} title="After hours" desc="Rest the screen when nobody's working.">
      <div className="divide-y divide-white/5">
        <SwitchRow label="Dim the board after hours" desc="Shows only a dim clock, so the screen isn't lit up all night."
          checked={enabled} onChange={v => setQuiet({ enabled: v })} />
        {enabled && (
          <div className="py-3 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-300">
              <span>From</span>
              <input type="time" aria-label="Dim from" value={start} onChange={e => e.target.value && setQuiet({ start: e.target.value })} className={selectCls} />
              <span>to</span>
              <input type="time" aria-label="Dim until" value={end} onChange={e => e.target.value && setQuiet({ end: e.target.value })} className={selectCls} />
            </div>
            <div>
              <p className="text-xs text-zinc-500 mb-1.5">…and all day on</p>
              <div className="flex flex-wrap gap-1.5">
                {DAY_NAMES.map((dn, i) => {
                  const on = days.includes(i);
                  return (
                    <button key={dn} type="button" aria-pressed={on} aria-label={dn} title={dn}
                      onClick={() => setQuiet({ days: on ? days.filter(x => x !== i) : [...days, i].sort((a, b) => a - b) })}
                      className={`w-9 h-9 rounded-lg text-xs font-black transition-colors ${on ? 'bg-amber-600 text-white' : 'bg-zinc-950 border border-white/10 text-zinc-400 hover:text-white'}`}>
                      {dn[0]}
                    </button>
                  );
                })}
              </div>
            </div>
            {days.length >= 7 ? (
              <p className="text-xs font-bold text-red-400 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />Every day is picked — the board would never show.</p>
            ) : (
              <p className="text-xs text-zinc-500">
                Right now: {quietNow
                  ? <><b className="text-amber-400">dimmed</b>{until ? ` — back ${resumeLabel(until, nowDate, tz)}` : ''}</>
                  : <b className="text-emerald-400">showing the board</b>}
              </p>
            )}
          </div>
        )}
        <FieldRow label="Daily refresh" desc="Each TV reloads once a day to pick up updates. Pick a time nobody's watching.">
          <select aria-label="Daily refresh time" value={settings.tvRefreshHour ?? 3} onChange={e => set({ tvRefreshHour: Number(e.target.value) })} className={selectCls}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
          </select>
        </FieldRow>
      </div>
    </Card>
  );
}

// ── Weather ──────────────────────────────────────────────────────────

const US_STATES: Record<string, string> = {
  al: 'alabama', ak: 'alaska', az: 'arizona', ar: 'arkansas', ca: 'california', co: 'colorado', ct: 'connecticut',
  de: 'delaware', dc: 'district of columbia', fl: 'florida', ga: 'georgia', hi: 'hawaii', id: 'idaho', il: 'illinois',
  in: 'indiana', ia: 'iowa', ks: 'kansas', ky: 'kentucky', la: 'louisiana', me: 'maine', md: 'maryland',
  ma: 'massachusetts', mi: 'michigan', mn: 'minnesota', ms: 'mississippi', mo: 'missouri', mt: 'montana',
  ne: 'nebraska', nv: 'nevada', nh: 'new hampshire', nj: 'new jersey', nm: 'new mexico', ny: 'new york',
  nc: 'north carolina', nd: 'north dakota', oh: 'ohio', ok: 'oklahoma', or: 'oregon', pa: 'pennsylvania',
  ri: 'rhode island', sc: 'south carolina', sd: 'south dakota', tn: 'tennessee', tx: 'texas', ut: 'utah',
  vt: 'vermont', va: 'virginia', wa: 'washington', wv: 'west virginia', wi: 'wisconsin', wy: 'wyoming',
};

type Place = { latitude: number; longitude: number; name: string; admin1?: string; country_code?: string };

async function findPlace(q: string): Promise<Place | null> {
  const search = async (name: string): Promise<Place[]> => {
    const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en&format=json`);
    const d = await res.json() as { results?: Place[] };
    return (d.results || []).filter(r => typeof r.latitude === 'number' && typeof r.longitude === 'number');
  };
  // "Fresno, CA" → search "Fresno", then prefer the matching state.
  const [cityPart, regionPart = ''] = q.split(',').map(s => s.trim());
  const list = await search(regionPart ? cityPart : q);
  const region = regionPart.toLowerCase();
  const fullRegion = US_STATES[region] || region;
  return (/^\d{5}$/.test(q) && list.find(r => r.country_code === 'US'))   // a bare ZIP matches postal codes worldwide
    || (region && list.find(r => (r.admin1 || '').toLowerCase() === fullRegion || (r.country_code || '').toLowerCase() === region))
    || list.find(r => r.country_code === 'US')
    || list[0]
    || null;
}

function WeatherCard({ settings, set, addToast }: { settings: SystemSettings; set: Patch; addToast: Toast }) {
  const lat = settings.weatherLat, lon = settings.weatherLon;
  const has = lat != null && lon != null;
  const [input, setInput] = useState('');
  const [looking, setLooking] = useState(false);
  const [temp, setTemp] = useState<number | 'error' | null>(null);

  useEffect(() => {
    setTemp(null);
    if (lat == null || lon == null) return;
    let cancelled = false;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m&temperature_unit=fahrenheit`)
      .then(r => r.json() as Promise<{ current?: { temperature_2m?: number } }>)
      .then(d => { if (!cancelled) setTemp(typeof d.current?.temperature_2m === 'number' ? Math.round(d.current.temperature_2m) : 'error'); })
      .catch(() => { if (!cancelled) setTemp('error'); });
    return () => { cancelled = true; };
  }, [lat, lon]);

  const lookUp = async () => {
    const q = input.trim();
    if (!q || looking) return;
    setLooking(true);
    try {
      const hit = await findPlace(q);
      if (!hit) { addToast('error', `Couldn't find "${q}" — try "City, State" or a 5-digit ZIP`); return; }
      const label = [hit.name, hit.admin1, hit.country_code].filter(Boolean).join(', ');
      set({ weatherCity: label, weatherLat: hit.latitude, weatherLon: hit.longitude });
      setInput('');
      addToast('success', `Weather set to ${label}`);
    } catch {
      addToast('error', 'Lookup failed — check the internet and try again');
    } finally {
      setLooking(false);
    }
  };

  const useThisComputer = () => {
    if (!navigator.geolocation) { addToast('error', "This browser can't share its location — type a city or ZIP instead"); return; }
    setLooking(true);
    navigator.geolocation.getCurrentPosition(
      pos => {
        const la = Math.round(pos.coords.latitude * 1e4) / 1e4, lo = Math.round(pos.coords.longitude * 1e4) / 1e4;
        set({ weatherCity: `Near ${la.toFixed(2)}, ${lo.toFixed(2)}`, weatherLat: la, weatherLon: lo });
        setLooking(false);
        addToast('success', 'Weather set to this computer’s location');
      },
      err => {
        setLooking(false);
        addToast('error', err.code === err.PERMISSION_DENIED
          ? 'Location is blocked for this site — type a city or ZIP instead'
          : "Couldn't get the location — type a city or ZIP instead");
      },
      { timeout: 10_000 },
    );
  };

  return (
    <Card anchor="tv-weather" icon={<Cloud className="w-4 h-4" />} title="Weather" desc="For the temperature in the header and the Weather slide.">
      {has ? (
        <div className="flex items-center gap-3 rounded-xl bg-cyan-500/5 border border-cyan-500/15 p-3">
          <MapPin className="w-4 h-4 text-cyan-400 shrink-0" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">{settings.weatherCity || `${lat!.toFixed(2)}, ${lon!.toFixed(2)}`}</p>
            <p className="text-xs text-zinc-500">{temp === null ? 'Checking…' : temp === 'error' ? "Couldn't check the weather just now" : `${temp}°F right now`}</p>
          </div>
          <Btn tone="danger" onClick={() => set({ weatherCity: undefined, weatherLat: undefined, weatherLon: undefined })}>Clear</Btn>
        </div>
      ) : (
        <p className="text-xs text-amber-300/90 rounded-xl bg-amber-500/5 border border-amber-500/15 p-3 leading-snug">
          No location set — each TV guesses from its internet connection, which is often the wrong town.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') lookUp(); }}
          aria-label="City or ZIP for the weather" placeholder={has ? 'Change: city or ZIP' : 'City or ZIP — e.g. Fresno, CA or 93710'}
          className={`${inputCls} flex-1 min-w-[12rem]`} />
        <button type="button" onClick={lookUp} disabled={looking || !input.trim()}
          className="px-4 min-h-[40px] rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white text-sm font-black transition-colors">
          {looking ? 'Looking…' : 'Set'}
        </button>
      </div>
      <button type="button" onClick={useThisComputer} disabled={looking}
        className="mt-2 inline-flex items-center gap-1.5 min-h-[32px] text-xs font-bold text-zinc-500 hover:text-white disabled:opacity-40">
        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />Use this computer's location
      </button>
    </Card>
  );
}

// ── Privacy + the in-app Live Floor page ─────────────────────────────

function PrivacyCard({ settings, set }: { settings: SystemSettings; set: Patch }) {
  return (
    <Card anchor="tv-privacy" icon={<Lock className="w-4 h-4" />} title="Privacy" desc="TVs are seen by visitors, drivers and customers.">
      <div className="divide-y divide-white/5">
        <SwitchRow label="Show dollar amounts" desc="Revenue and job values on the score, stats and goal slides. Off unless you turn it on."
          checked={settings.tvShowRevenue === true} onChange={v => set({ tvShowRevenue: v })} />
        <SwitchRow label="Show customer names" desc="On job lists and the attack plan. Job and part numbers always show."
          checked={settings.tvShowCustomerNames !== false} onChange={v => set({ tvShowCustomerNames: v })} />
      </div>
    </Card>
  );
}

function LiveFloorCard({ settings, set }: { settings: SystemSettings; set: Patch }) {
  return (
    <Card anchor="tv-floor-cards" icon={<Layers className="w-4 h-4" />} title="Live Floor page (in the app)" desc="Worker cards on the Live Floor page — not the wall TV.">
      <div className="divide-y divide-white/5">
        <SwitchRow label="Customer name on worker cards" checked={settings.tvShowCustomer !== false} onChange={v => set({ tvShowCustomer: v })} />
        <SwitchRow label="Time bar on worker cards" checked={settings.tvShowElapsedBar !== false} onChange={v => set({ tvShowElapsedBar: v })} />
      </div>
    </Card>
  );
}

// ── Slides ───────────────────────────────────────────────────────────

const SAFETY_PRESETS: Record<string, { title: string; body: string; color: NonNullable<SlideMessage['color']> }> = {
  '⚠️': { title: 'Stay Alert', body: 'Watch for hazards. Report anything unsafe to your supervisor.', color: 'yellow' },
  '🦺': { title: 'Wear Your Vest', body: 'High-visibility gear is required on the shop floor.', color: 'orange' },
  '🥽': { title: 'Eye Protection', body: 'Safety glasses on at all times in the work area.', color: 'blue' },
  '🧤': { title: 'Hand Protection', body: 'Use the correct gloves for the job. Inspect before use.', color: 'blue' },
  '🚫': { title: 'No Shortcuts', body: 'Follow the process. Shortcuts cause injuries and rework.', color: 'red' },
  '🔥': { title: 'Fire Safety', body: 'Know where extinguishers are. Keep work areas clear of combustibles.', color: 'red' },
  '⚡': { title: 'Electrical Safety', body: 'Inspect cords before use. Report damaged equipment.', color: 'yellow' },
  '🛑': { title: 'Stop & Think', body: 'If something feels wrong — stop. Unsafe tasks aren\'t worth it.', color: 'red' },
  '✅': { title: 'Good Job!', body: 'Zero incidents this week — keep it up!', color: 'green' },
  '🎯': { title: 'Quality First', body: 'Double-check your work. Quality protects us all.', color: 'blue' },
  '🏭': { title: 'Keep It Clean', body: '5S: Sort, Set in order, Shine, Standardize, Sustain.', color: 'green' },
  '👷': { title: 'PPE Check', body: 'Head, eyes, ears, hands, feet — run through the list every shift.', color: 'orange' },
  '🦾': { title: 'Machine Safety', body: 'Lock-out / tag-out before servicing. No exceptions.', color: 'red' },
  '📢': { title: 'Important Notice', body: 'Check the bulletin board for today\'s updates.', color: 'blue' },
  '🔔': { title: 'Shift Change', body: 'Hand off your work cleanly. Leave notes for the next shift.', color: 'yellow' },
};

const ANNOUNCEMENT_PRESETS: Record<string, { title: string; body: string; color: NonNullable<SlideMessage['color']> }> = {
  '📢': { title: 'Important Announcement', body: 'Please read the board for today\'s updates.', color: 'blue' },
  '🎉': { title: 'Great Job Team!', body: 'We hit our goal — thank you all for the hard work.', color: 'green' },
  '🎯': { title: 'Focus Today', body: 'Priority: get the hot jobs out the door.', color: 'blue' },
  '⭐': { title: 'Shout-Out', body: 'Congrats to our top performer this week!', color: 'yellow' },
  '✨': { title: 'Keep It Up', body: 'We\'re on track — let\'s finish strong.', color: 'green' },
  '🏆': { title: 'Milestone Hit', body: 'Celebrate the win before starting the next push.', color: 'yellow' },
  '📋': { title: 'Reminder', body: 'Log all your time — it helps us quote accurately.', color: 'blue' },
  '💡': { title: 'Suggestion Box', body: 'Have an idea? Share it with your supervisor.', color: 'blue' },
};

const COLORS: { id: NonNullable<SlideMessage['color']>; cls: string }[] = [
  { id: 'blue', cls: 'bg-blue-500' }, { id: 'yellow', cls: 'bg-yellow-500' }, { id: 'orange', cls: 'bg-orange-500' },
  { id: 'red', cls: 'bg-red-500' }, { id: 'green', cls: 'bg-emerald-500' }, { id: 'white', cls: 'bg-white' },
];

/** Messages for a safety / announcement slide — one shows per pass through the lineup. */
function SlideMessagesEditor({ slide, onUpdate, confirm }: { slide: TvSlide; onUpdate: (patch: Partial<TvSlide>) => void; confirm: Confirm }) {
  const isSafety = slide.type === 'safety';
  // Older slides kept one message in title/body — read them as a list of one.
  const messages: SlideMessage[] = slide.messages && slide.messages.length > 0
    ? slide.messages
    : [{ id: 'legacy', title: slide.title, body: slide.body, color: slide.color, icon: slide.icon }];
  const write = (next: SlideMessage[]) => onUpdate({ messages: next, title: undefined, body: undefined, color: undefined, icon: undefined });
  const updateMsg = (i: number, patch: Partial<SlideMessage>) => write(messages.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  const move = (i: number, dir: -1 | 1) => {
    const t = i + dir;
    if (t < 0 || t >= messages.length) return;
    const next = [...messages];
    [next[i], next[t]] = [next[t], next[i]];
    write(next);
  };
  const add = () => write([...messages, isSafety
    ? { id: `m_${Date.now()}`, title: 'New safety reminder', body: '', color: 'yellow', icon: '⚠️' }
    : { id: `m_${Date.now()}`, title: 'New announcement', body: '', color: 'blue' }]);
  const loadPack = async () => {
    const ok = await confirm({
      title: isSafety ? 'Use the safety message pack?' : 'Use the announcement pack?',
      message: `Replaces the ${messages.length} message${messages.length === 1 ? '' : 's'} on this slide with ${isSafety ? 8 : 6} ready-made ones you can edit.`,
      tone: 'warning', confirmLabel: 'Replace',
    });
    if (!ok) return;
    const presets = isSafety ? SAFETY_PRESETS : ANNOUNCEMENT_PRESETS;
    write(Object.entries(presets).slice(0, isSafety ? 8 : 6).map(([icon, p], i) => ({
      id: `m_${Date.now()}_${i}`, title: p.title, body: p.body, color: p.color, ...(isSafety ? { icon } : {}),
    })));
  };
  const icons = Object.keys(SAFETY_PRESETS);

  return (
    <div className="space-y-2">
      {isSafety && (
        <SwitchRow label="Mix in built-in tips" checked={slide.tipLibrary !== false} onChange={v => onUpdate({ tipLibrary: v })}
          desc="40 safety, FOD and quality tips written for an aerospace shop take turns with your own messages — a different tip each time." />
      )}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-[11px] font-black text-zinc-400 uppercase tracking-widest">{messages.length} message{messages.length === 1 ? '' : 's'} · one per pass</p>
        <div className="flex gap-1.5">
          <Btn onClick={loadPack}>✨ Ready-made pack</Btn>
          <Btn tone="primary" onClick={add}><Plus className="w-3.5 h-3.5" aria-hidden="true" />Add message</Btn>
        </div>
      </div>
      {messages.map((m, i) => (
        <div key={m.id} className="bg-zinc-900/60 border border-white/5 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">#{i + 1}</span>
            <div className="flex-1" />
            <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move message up" className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-white disabled:opacity-20"><ChevronUp className="w-4 h-4" aria-hidden="true" /></button>
            <button type="button" onClick={() => move(i, 1)} disabled={i === messages.length - 1} aria-label="Move message down" className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-white disabled:opacity-20"><ChevronDown className="w-4 h-4" aria-hidden="true" /></button>
            {messages.length > 1 && (
              <button type="button" onClick={() => write(messages.filter((_, idx) => idx !== i))} aria-label="Delete message" className="w-7 h-7 flex items-center justify-center rounded text-zinc-500 hover:text-red-400"><X className="w-4 h-4" aria-hidden="true" /></button>
            )}
          </div>
          <input className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-white" aria-label="Message title"
            placeholder={isSafety ? 'Safety reminder…' : 'Announcement…'} value={m.title || ''} onChange={e => updateMsg(i, { title: e.target.value })} />
          <textarea className="w-full bg-zinc-950 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white resize-y" rows={2} aria-label="Message text"
            placeholder="More detail (optional)…" value={m.body || ''} onChange={e => updateMsg(i, { body: e.target.value })} />
          {isSafety && (
            <div className="flex flex-wrap gap-1">
              {icons.map(icn => (
                <button key={icn} type="button" title={`${SAFETY_PRESETS[icn].title} — fills empty fields`} aria-label={SAFETY_PRESETS[icn].title} aria-pressed={(m.icon || '⚠️') === icn}
                  onClick={() => {
                    // Only fill blanks — never overwrite what was typed.
                    const p = SAFETY_PRESETS[icn];
                    updateMsg(i, { icon: icn, ...(!m.title?.trim() ? { title: p.title } : {}), ...(!m.body?.trim() ? { body: p.body } : {}), ...(!m.color ? { color: p.color } : {}) });
                  }}
                  className={`w-8 h-8 rounded-md transition-all text-base ${(m.icon || '⚠️') === icn ? 'bg-amber-500/25 ring-2 ring-amber-500' : 'bg-zinc-900 hover:bg-zinc-800'}`}>
                  {icn}
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest mr-1">Color</span>
            {COLORS.map(c => (
              <button key={c.id} type="button" onClick={() => updateMsg(i, { color: c.id })} aria-label={c.id} aria-pressed={(m.color || (isSafety ? 'yellow' : 'blue')) === c.id}
                className={`w-6 h-6 rounded ${c.cls} transition-all ${(m.color || (isSafety ? 'yellow' : 'blue')) === c.id ? 'ring-2 ring-white scale-110' : 'opacity-40 hover:opacity-80'}`} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function LeaderboardOptions({ slide, onChange }: { slide: TvSlide; onChange: (patch: Partial<TvSlide>) => void }) {
  return (
    <div className="space-y-3">
      <FieldRow label="Period">
        <Segmented label="Leaderboard period" value={slide.leaderboardPeriod || 'week'} onChange={v => onChange({ leaderboardPeriod: v })}
          options={[{ value: 'today', label: 'Today' }, { value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
      </FieldRow>
      <FieldRow label="Rank by">
        <Segmented label="Leaderboard ranks by" value={slide.leaderboardMetric || 'mixed'} onChange={v => onChange({ leaderboardMetric: v })}
          options={[{ value: 'mixed', label: 'Hours + jobs' }, { value: 'hours', label: 'Hours' }, { value: 'jobs', label: 'Jobs' }]} />
      </FieldRow>
      <FieldRow label={`Show the top ${slide.leaderboardCount || 5}`}>
        <input type="range" min={3} max={10} value={slide.leaderboardCount || 5} aria-label="How many workers to show"
          onChange={e => onChange({ leaderboardCount: Number(e.target.value) })} className="w-40 accent-amber-500" />
      </FieldRow>
    </div>
  );
}

const DURATIONS = [10, 15, 20, 30, 45, 60, 90];
const loopLabel = (secs: number) => (secs < 90 ? `${secs} sec` : `${Math.round(secs / 30) / 2} min`);
const typeKey = (t: TvSlide['type']): string => (t === 'stats' ? 'stats-week' : t);

function SlidesCard({ settings, setSettings, set, confirm, addToast, onPreview }: {
  settings: SystemSettings; setSettings: SetSettings; set: Patch; confirm: Confirm; addToast: Toast;
  onPreview: (slide: TvSlide) => void;
}) {
  const custom = settings.tvSlides && settings.tvSlides.length > 0 ? settings.tvSlides : null;
  const rows = custom || DEFAULT_TV_SLIDES;
  const [expanded, setExpanded] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const defaultSecs = settings.tvSlideDuration || 15;
  const showing = effectiveTvSlides(settings.tvSlides);
  const loopSecs = showing.reduce((a, s) => a + (s.duration || defaultSecs), 0);
  const allOff = !!custom && custom.every(s => !s.enabled);

  // The first change to the built-in lineup turns it into this shop's own copy
  // (same ids, so an open editor stays open).
  const edit = (fn: (list: TvSlide[]) => TvSlide[]) => setSettings(prev => ({
    ...prev,
    tvSlides: fn(prev.tvSlides && prev.tvSlides.length > 0 ? prev.tvSlides : DEFAULT_TV_SLIDES.map(s => ({ ...s }))),
  }));
  const update = (id: string, patch: Partial<TvSlide>) => edit(list => list.map(s => (s.id === id ? { ...s, ...patch } : s)));
  const move = (id: string, dir: -1 | 1) => edit(list => {
    const i = list.findIndex(s => s.id === id), j = i + dir;
    if (i < 0 || j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const remove = async (s: TvSlide) => {
    const label = s.title || slideMeta(s.type).label;
    if ((s.type === 'message' || s.type === 'safety') && !(await confirm({
      title: `Remove “${label}”?`, message: 'Its messages are deleted with it.', tone: 'warning', confirmLabel: 'Remove',
    }))) return;
    edit(list => list.filter(x => x.id !== s.id));
    if (expanded === s.id) setExpanded(null);
  };
  const add = async (type: CatalogType) => {
    const meta = TV_SLIDE_CATALOG[type];
    if (meta.single && rows.some(s => typeKey(s.type) === type) && !(await confirm({
      title: `Show ${meta.label} twice?`, message: "It's already in the lineup — a second copy shows the same thing again.",
      tone: 'warning', confirmLabel: 'Add anyway',
    }))) return;
    const id = `${type}_${Date.now()}`;
    const mid = `m_${Date.now()}`;
    const extra: Partial<TvSlide> =
      type === 'leaderboard' ? { leaderboardMetric: 'mixed', leaderboardPeriod: 'week', leaderboardCount: 5 }
      : type === 'safety' ? { messages: [{ id: mid, title: 'Safety First', body: 'Wear your PPE. Keep your work area clean. Report hazards.', color: 'yellow', icon: '⚠️' }] }
      : type === 'message' ? { messages: [{ id: mid, title: 'Announcement', body: '', color: 'blue' }] }
      : {};
    edit(list => [...list, { id, type, enabled: true, ...extra }]);
    setAdding(false);
    if (type === 'leaderboard' || type === 'safety' || type === 'message') setExpanded(id);
    addToast('success', `${meta.label} added at the end`);
  };
  const reset = async () => {
    if (!(await confirm({
      title: 'Go back to the built-in lineup?',
      message: `Your order, slide lengths and messages are replaced with the standard ${DEFAULT_TV_SLIDES.length} slides.`,
      tone: 'warning', confirmLabel: 'Reset slides',
    }))) return;
    setSettings(prev => ({ ...prev, tvSlides: undefined }));
    setExpanded(null);
  };

  return (
    <Card anchor="tv-slides" icon={<Layers className="w-4 h-4" />} title="Slides"
      desc={`${showing.length} slide${showing.length === 1 ? '' : 's'} · about ${loopLabel(loopSecs)} per loop`}
      right={<Btn tone="primary" onClick={() => setAdding(a => !a)}><Plus className="w-3.5 h-3.5" aria-hidden="true" />{adding ? 'Close' : 'Add a slide'}</Btn>}>
      {adding && (
        <div className="mb-3 grid sm:grid-cols-2 gap-2 p-2 rounded-xl bg-zinc-950 border border-white/10">
          {(Object.keys(TV_SLIDE_CATALOG) as CatalogType[]).map(t => {
            const m = TV_SLIDE_CATALOG[t];
            const inLineup = m.single && rows.some(s => typeKey(s.type) === t);
            return (
              <button key={t} type="button" onClick={() => add(t)} className={`text-left p-2.5 rounded-lg border ${m.color} hover:brightness-125 transition-all flex items-start gap-2.5`}>
                <span className="text-xl leading-none" aria-hidden="true">{m.icon}</span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5 text-xs font-black text-white">
                    {m.label}
                    {inLineup && <span className="text-[9px] font-black text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 rounded px-1">In lineup</span>}
                  </span>
                  <span className="block text-[11px] text-white/60 leading-snug mt-0.5">{m.desc}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="divide-y divide-white/5 mb-2">
        <FieldRow label="Slide length" desc="For slides set to Auto. Lists that scroll get extra time to get through.">
          <select aria-label="Default slide length" value={defaultSecs} onChange={e => set({ tvSlideDuration: Number(e.target.value) })} className={selectCls}>
            {[10, 15, 20, 30, 45, 60].map(s => <option key={s} value={s}>{s} seconds</option>)}
          </select>
        </FieldRow>
      </div>

      {!custom && <p className="text-xs text-zinc-500 mb-2">This is the built-in lineup — change anything and it becomes yours.</p>}
      {(() => {
        const missing = (['news', 'calendar', 'safety'] as const).filter(t => !rows.some(r => r.type === t));
        if (!missing.length) return null;
        return (
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-500/25 bg-sky-500/5 p-2.5">
            <p className="text-xs text-sky-200 min-w-0">
              <b>New for the TV:</b> {missing.map(t => TV_SLIDE_CATALOG[t].label).join(', ')}{missing.includes('calendar') ? ' (with team birthdays)' : ''}.
            </p>
            <Btn tone="primary" onClick={() => {
              edit(list => [...list, ...missing.map((type, i) => ({ id: `${type}_${Date.now()}_${i}`, type, enabled: true } as TvSlide))]);
              addToast('success', `Added ${missing.length} slide${missing.length === 1 ? '' : 's'} at the end`);
            }}><Plus className="w-3.5 h-3.5" aria-hidden="true" />Add {missing.length === 1 ? 'it' : 'them'}</Btn>
          </div>
        );
      })()}
      {allOff && (
        <p className="text-xs font-bold text-amber-400 mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />Every slide is switched off — the TV shows the built-in lineup until you switch one on.
        </p>
      )}

      <ul className="space-y-1.5">
        {rows.map((s, i) => {
          const meta = slideMeta(s.type);
          const configurable = s.type === 'leaderboard' || s.type === 'message' || s.type === 'safety';
          const open = configurable && expanded === s.id;
          const msgCount = s.messages?.length || (s.title || s.body ? 1 : 0);
          const sub = s.type === 'leaderboard'
            ? `${s.leaderboardPeriod === 'today' ? 'Today' : s.leaderboardPeriod === 'month' ? 'This month' : 'This week'} · top ${s.leaderboardCount || 5}`
            : (s.type === 'message' || s.type === 'safety') ? `${msgCount} message${msgCount === 1 ? '' : 's'}`
            : meta.desc;
          return (
            <li key={s.id} className={`rounded-xl border transition-colors ${s.enabled ? 'border-white/10 bg-zinc-950/40' : 'border-white/5 bg-zinc-950/10'}`}>
              {/* Name keeps at least 9rem; on a phone the controls drop to their own line. */}
              <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 p-1.5 sm:p-2">
                <div className="flex flex-col shrink-0">
                  <button type="button" aria-label={`Move ${meta.label} up`} disabled={i === 0} onClick={() => move(s.id, -1)}
                    className="w-8 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"><ChevronUp className="w-4 h-4" aria-hidden="true" /></button>
                  <button type="button" aria-label={`Move ${meta.label} down`} disabled={i === rows.length - 1} onClick={() => move(s.id, 1)}
                    className="w-8 h-6 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/5 disabled:opacity-20 disabled:hover:bg-transparent"><ChevronDown className="w-4 h-4" aria-hidden="true" /></button>
                </div>
                <span className={`text-xl leading-none shrink-0 ${s.enabled ? '' : 'opacity-40 grayscale'}`} aria-hidden="true">{meta.icon}</span>
                {configurable ? (
                  <button type="button" onClick={() => setExpanded(open ? null : s.id)} aria-expanded={open} className="flex-1 min-w-[9rem] text-left">
                    <span className={`block text-sm font-bold truncate ${s.enabled ? 'text-white' : 'text-zinc-500'}`}>{s.title || meta.label}</span>
                    <span className="block text-[11px] text-zinc-500 truncate">{sub} · <span className="text-amber-400 font-bold">{open ? 'Close' : 'Edit'}</span></span>
                  </button>
                ) : (
                  <div className="flex-1 min-w-[9rem]">
                    <p className={`text-sm font-bold truncate ${s.enabled ? 'text-white' : 'text-zinc-500'}`}>{s.title || meta.label}</p>
                    <p className="text-[11px] text-zinc-500 truncate">{sub}</p>
                  </div>
                )}
                <div className="flex items-center gap-1.5 sm:gap-2 ml-auto">
                <select aria-label={`${meta.label} length`} title="How long this slide shows" value={s.duration ? String(s.duration) : ''}
                  onChange={e => update(s.id, { duration: e.target.value ? Number(e.target.value) : undefined })}
                  className="shrink-0 bg-zinc-950 border border-white/10 rounded-lg px-1.5 py-1.5 text-xs text-white">
                  <option value="">Auto</option>
                  {DURATIONS.map(d => <option key={d} value={d}>{d}s</option>)}
                </select>
                <button type="button" aria-label={`Preview ${meta.label} on the board`} title="See this slide on the board" onClick={() => onPreview(s)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-zinc-500 hover:text-white hover:bg-white/5"><Eye className="w-4 h-4" aria-hidden="true" /></button>
                <Toggle checked={s.enabled} onChange={v => update(s.id, { enabled: v })} label={`Show ${meta.label}`} />
                <button type="button" aria-label={`Remove ${meta.label}`} onClick={() => remove(s)}
                  className="shrink-0 w-8 h-8 flex items-center justify-center rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
                </div>
              </div>
              {open && (
                <div className="border-t border-white/5 p-3">
                  {s.type === 'leaderboard'
                    ? <LeaderboardOptions slide={s} onChange={p => update(s.id, p)} />
                    : <SlideMessagesEditor slide={s} onUpdate={p => update(s.id, p)} confirm={confirm} />}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {custom && (
        <button type="button" onClick={reset} className="mt-3 w-full min-h-[36px] text-xs font-bold text-zinc-500 hover:text-amber-400 rounded-lg hover:bg-white/[0.03] transition-colors">
          Reset to the built-in lineup
        </button>
      )}
    </Card>
  );
}

// ── Birthdays ────────────────────────────────────────────────────────

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function BirthdaysCard({ settings, set }: { settings: SystemSettings; set: Patch }) {
  const list = settings.birthdays || [];
  const [name, setName] = useState('');
  const [month, setMonth] = useState(() => new Date().getMonth() + 1);
  const [day, setDay] = useState(1);
  const daysIn = new Date(2024, month, 0).getDate();    // a leap year, so Feb 29 is allowed
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const next = [...list, { id: `b_${Date.now()}`, name: n.slice(0, 40), month, day: Math.min(day, daysIn) }]
      .sort((a, b) => a.month - b.month || a.day - b.day);
    set({ birthdays: next });
    setName('');
  };
  return (
    <Card anchor="tv-birthdays" icon={<Cake className="w-4 h-4" />} title="Birthdays"
      desc="On the TV calendar, and the board says happy birthday on the day. Month and day only — no year.">
      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input aria-label="Name" placeholder="Name" maxLength={40} value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') add(); }} className={`${inputCls} flex-1 min-w-[9rem]`} />
        <select aria-label="Birthday month" value={month} onChange={e => setMonth(Number(e.target.value))} className={selectCls}>
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select aria-label="Birthday day" value={Math.min(day, daysIn)} onChange={e => setDay(Number(e.target.value))} className={selectCls}>
          {Array.from({ length: daysIn }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
        </select>
        <Btn tone="primary" disabled={!name.trim()} onClick={add}><Plus className="w-3.5 h-3.5" aria-hidden="true" />Add</Btn>
      </div>
      {list.length === 0 ? (
        <p className="text-xs text-zinc-500">No birthdays yet — add your team and the TV celebrates them.</p>
      ) : (
        <ul className="divide-y divide-white/5">
          {list.map(b => (
            <li key={b.id} className="flex items-center justify-between gap-2 py-1.5">
              <span className="text-sm text-white truncate min-w-0">🎂 {b.name}</span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-xs text-zinc-400 tabular">{MONTHS[b.month - 1]} {b.day}</span>
                <button type="button" aria-label={`Remove ${b.name}'s birthday`} onClick={() => set({ birthdays: list.filter(x => x.id !== b.id) })}
                  className="w-8 h-8 flex items-center justify-center rounded-md text-zinc-600 hover:text-red-400 hover:bg-red-500/10"><Trash2 className="w-4 h-4" aria-hidden="true" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ── The tab ──────────────────────────────────────────────────────────

export function TvDisplaySettings({ settings, setSettings, saveNow, addToast }: {
  settings: SystemSettings; setSettings: SetSettings; saveNow: SaveNow; addToast: Toast;
}) {
  const { confirm, ConfirmHost } = useConfirm();
  const set: Patch = changes => setSettings(prev => ({ ...prev, ...changes }));
  const [devices, setDevices] = useState<TvDevice[] | null>(null);
  useEffect(() => DB.subscribeTvDevices(setDevices), []);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const i = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(i);
  }, []);

  // Opens the real board in a new tab without turning this computer into a TV —
  // optionally starting on one slide (even one that's off or not saved yet).
  const preview = async (slide?: TvSlide) => {
    let token = settings.tvToken;
    if (!token) {
      try { token = await DB.ensureTvToken(); }
      catch { addToast('error', "Couldn't set up the TV link — check the internet and try again"); return; }
    }
    const start = slide ? `&slide=${encodeURIComponent(slide.id)}&type=${encodeURIComponent(slide.type)}` : '';
    window.open(`/tv?tv=${encodeURIComponent(token)}&preview=1${start}`, '_blank', 'noopener');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-bold text-white mb-1">TV Display</h3>
          <p className="text-sm text-zinc-500 max-w-2xl">Put the shop board on any TV. Connect it once with a code — it stays on, reconnects by itself, and updates live.</p>
        </div>
        <button type="button" onClick={() => preview()}
          className="inline-flex items-center gap-2 px-4 min-h-[40px] rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-bold text-white transition-colors">
          <ExternalLink className="w-4 h-4" aria-hidden="true" />Preview the board
        </button>
      </div>

      <WallTvs settings={settings} devices={devices} now={now} saveNow={saveNow} confirm={confirm} addToast={addToast} />
      <SetupTips openWhenReady={devices === null ? null : devices.length === 0} refreshHour={settings.tvRefreshHour ?? 3} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2 items-start">
        <SlidesCard settings={settings} setSettings={setSettings} set={set} confirm={confirm} addToast={addToast} onPreview={preview} />
        <div className="space-y-4">
          <ScreenCard settings={settings} set={set} />
          <ScheduleCard settings={settings} set={set} now={now} />
          <BirthdaysCard settings={settings} set={set} />
          <WeatherCard settings={settings} set={set} addToast={addToast} />
          <PrivacyCard settings={settings} set={set} />
          <LiveFloorCard settings={settings} set={set} />
        </div>
      </div>
      {ConfirmHost}
    </div>
  );
}
