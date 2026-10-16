// Full-screen pieces for an unattended wall TV: pairing, connection badge,
// "show your name", quiet-hours clock, and the exit confirmation. Sized for
// reading from across a shop floor.

import React, { useEffect, useRef, useState } from 'react';
import * as DB from '../services/mockDb';
import { tvHomeUrl } from '../utils/tvRuntime';

const big = (min: string, vw: string, max: string) => `clamp(${min}, ${vw}, ${max})`;

/**
 * Shown when this TV has no valid link: a 6-digit code to type into
 * Settings → TV Display. The TV keeps the link afterwards, so this is a
 * one-time step per TV.
 */
export function TvPairScreen({ deviceId, reason, onPaired }: {
  deviceId: string;
  reason?: 'new' | 'outdated' | 'disconnected';
  onPaired: (token: string, name: string) => void;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const pairedRef = useRef(false);
  // Latest callback without restarting pairing (a new code) on every render.
  const onPairedRef = useRef(onPaired);
  onPairedRef.current = onPaired;

  useEffect(() => {
    let cancelled = false;
    let current: string | null = null;
    let unsub = () => {};
    let busy = false;   // one attempt at a time — offline, overlapping attempts piled up codes and leaked listeners
    const begin = async () => {
      if (busy) return;
      busy = true;
      unsub();
      unsub = () => {};
      if (current) { DB.endTvPairing(current); current = null; }
      try {
        const c = await DB.startTvPairing(deviceId);
        if (cancelled) { DB.endTvPairing(c); return; }
        current = c;
        setCode(c);
        setError(false);
        unsub = DB.subscribeTvPairing(c, p => {
          if (p?.status === 'approved' && p.token && !pairedRef.current) {
            pairedRef.current = true;
            DB.endTvPairing(c);
            onPairedRef.current(p.token, p.name || 'Shop TV');
          }
        });
      } catch {
        if (!cancelled) setError(true);
      } finally {
        busy = false;
      }
    };
    begin();
    // Codes last 15 minutes — take a fresh one before this one expires. After
    // a failure (no internet), retry sooner.
    const refresh = window.setInterval(begin, 14 * 60_000);
    const retry = window.setInterval(() => { if (!current) begin(); }, 30_000);
    return () => { cancelled = true; window.clearInterval(refresh); window.clearInterval(retry); unsub(); if (current && !pairedRef.current) DB.endTvPairing(current); };
  }, [deviceId]);

  const heading = reason === 'outdated' ? 'This TV needs to be reconnected'
    : reason === 'disconnected' ? 'This TV was disconnected'
    : 'Connect this TV';

  return (
    <div className="fixed inset-0 bg-zinc-950 text-white flex items-center justify-center p-[4vw] text-center">
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-[-25%] left-[-10%] w-[60%] h-[60%] rounded-full bg-orange-600/10 blur-[120px]" />
        <div className="absolute bottom-[-25%] right-[-10%] w-[60%] h-[60%] rounded-full bg-amber-600/10 blur-[120px]" />
      </div>
      <div className="relative max-w-4xl">
        <p className="font-black tracking-tight" style={{ fontSize: big('1.75rem', '3.2vw', '3.5rem') }}>{heading}</p>
        <p className="text-white/60 mt-3" style={{ fontSize: big('1rem', '1.6vw', '1.75rem') }}>
          On your phone or computer, open FabTrack → <span className="text-white font-bold">Settings → TV Display</span> → <span className="text-white font-bold">Connect a TV</span>, and type this code:
        </p>
        <div className="mt-[4vh] inline-flex items-center gap-[1.2vw] rounded-3xl border border-amber-500/30 bg-amber-500/10 px-[3vw] py-[2.5vh]">
          {(code || '······').split('').map((d, i) => (
            <span key={i} className={`font-black tabular-nums ${code ? 'text-amber-300' : 'text-white/20'}`} style={{ fontSize: big('3rem', '8vw', '9rem'), lineHeight: 1 }}>
              {i === 3 && <span className="inline-block w-[1.5vw]" />}{d}
            </span>
          ))}
        </div>
        <p className="text-white/40 mt-[4vh]" style={{ fontSize: big('0.85rem', '1.1vw', '1.25rem') }}>
          {error ? "Can't reach the server — check this TV's internet. Retrying…"
            : code ? 'Waiting for the code… this screen switches on by itself.'
            : 'Getting a code…'}
        </p>
        <p className="text-white/30 mt-2" style={{ fontSize: big('0.75rem', '0.95vw', '1.1rem') }}>
          This TV's address is <span className="text-white/60 font-mono">{tvHomeUrl().replace(/^https?:\/\//, '')}</span> — it remembers its connection after this.
        </p>
      </div>
    </div>
  );
}

/** "Live" / "Reconnecting…" / "No internet" — so anyone can see the TV is
 *  current. `downSince` = when live data stopped (null while live). */
export function TvConnectionBadge({ online, synced, downSince }: { online: boolean; synced: boolean; downSince: number | null }) {
  const [, tick] = useState(0);
  useEffect(() => { const i = window.setInterval(() => tick(n => n + 1), 30_000); return () => window.clearInterval(i); }, []);
  const since = (() => {
    if (!downSince) return '';
    const mins = Math.floor((Date.now() - downSince) / 60_000);
    if (mins < 1) return 'showing data from a moment ago';
    if (mins < 60) return `showing data from ${mins} min ago`;
    return `showing data from ${new Date(downSince).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  })();
  const state = !online ? 'offline' : synced ? 'live' : 'reconnecting';
  const cls = state === 'live'
    ? 'text-emerald-300 bg-emerald-500/10 border-emerald-500/25'
    : state === 'reconnecting'
      ? 'text-amber-300 bg-amber-500/10 border-amber-500/30'
      : 'text-red-300 bg-red-500/10 border-red-500/30';
  const dot = state === 'live' ? 'bg-emerald-400' : state === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400 animate-pulse';
  return (
    <div className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 font-black uppercase tracking-widest ${cls}`} style={{ fontSize: big('0.55rem', '0.7vw', '0.75rem') }}
      title={state === 'live' ? 'Connected — showing live data' : 'Showing the last data received'}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot}`} />
      {state === 'live' ? 'Live' : state === 'reconnecting' ? `Reconnecting · ${since}` : `No internet · ${since}`}
    </div>
  );
}

/** Big name banner — the office pressed "Show name" to find which TV is which. */
export function TvIdentifyOverlay({ name }: { name: string }) {
  return (
    <div className="fixed inset-0 z-[10010] flex items-center justify-center bg-black/70 backdrop-blur-sm pointer-events-none animate-fade-in">
      <div className="rounded-3xl border-4 border-amber-400 bg-zinc-950 px-[5vw] py-[5vh] text-center shadow-2xl">
        <p className="text-amber-300 font-black uppercase tracking-[0.3em]" style={{ fontSize: big('0.9rem', '1.4vw', '1.5rem') }}>This screen is</p>
        <p className="text-white font-black mt-2" style={{ fontSize: big('2.5rem', '6vw', '7rem'), lineHeight: 1.05 }}>{name}</p>
      </div>
    </div>
  );
}

/**
 * For a minute after the board comes back from an unplanned stop: when it
 * went away, and the one setting that stops it on a Fire TV. Whoever just
 * restarted it is standing there with the remote. Never takes input.
 */
export function TvStopNotice({ crash, fireTv }: { crash: { at: number; text: string }; fireTv: boolean }) {
  // The report's own "last alive" time; a report carried over from an older
  // version only has the time it was sent.
  const when = crash.text.match(/last alive ([^;)]+)/)?.[1]
    || new Date(crash.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return (
    <div role="status" className="fixed left-1/2 -translate-x-1/2 bottom-[4vh] z-[10005] w-[min(92vw,1100px)] rounded-2xl border-2 border-amber-400 bg-zinc-950/95 shadow-2xl px-[2.4vw] py-[2.2vh] pointer-events-none animate-fade-in">
      <p className="text-amber-300 font-black uppercase tracking-[0.16em]" style={{ fontSize: big('0.75rem', '1.15vw', '1.25rem') }}>
        The board went off the screen around {when}
      </p>
      {fireTv && /pop-up or menu came up|screen hidden since/i.test(crash.text) ? (
        <p className="text-white font-bold mt-1 leading-snug" style={{ fontSize: big('1rem', '2vw', '2.2rem') }}>
          Stop it for good — Fire TV <span className="text-amber-300">Settings → Preferences → Data Usage Monitoring</span> → turn <span className="text-amber-300">Still Watching</span> off.
        </p>
      ) : fireTv ? (
        <p className="text-white font-bold mt-1 leading-snug" style={{ fontSize: big('1rem', '2vw', '2.2rem') }}>
          The TV's browser closed while the board was showing (out of memory). <span className="text-amber-300">FabTrack Settings → TV Display</span> shows how to keep it on.
        </p>
      ) : (
        <p className="text-white font-bold mt-1 leading-snug" style={{ fontSize: big('1rem', '2vw', '2.2rem') }}>
          Turn off the TV's own sleep, screensaver and power-saving timers — FabTrack Settings → TV Display has the steps.
        </p>
      )}
      <p className="text-zinc-500 font-semibold mt-1" style={{ fontSize: big('0.7rem', '1vw', '1.1rem') }}>Press any button to hide</p>
    </div>
  );
}

/**
 * Outside working hours: a dim clock that drifts slowly, so the panel isn't
 * holding one bright image all night (burn-in) and anyone walking by sees
 * the TV is still alive.
 */
export function TvQuietScreen({ companyName, resumes }: { companyName?: string; resumes?: string }) {
  const [now, setNow] = useState(() => new Date());
  const [pos, setPos] = useState({ x: 50, y: 50 });
  useEffect(() => {
    const i = window.setInterval(() => setNow(new Date()), 15_000);
    const m = window.setInterval(() => setPos({ x: 25 + Math.random() * 50, y: 25 + Math.random() * 50 }), 60_000);
    return () => { window.clearInterval(i); window.clearInterval(m); };
  }, []);
  return (
    <div className="fixed inset-0 bg-black text-white overflow-hidden">
      <div className="absolute text-center transition-all duration-[3000ms] ease-in-out"
        style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)', opacity: 0.55 }}>
        <p className="font-black tabular-nums" style={{ fontSize: big('3rem', '9vw', '10rem'), lineHeight: 1 }}>
          {now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
        </p>
        <p className="text-white/50 mt-3" style={{ fontSize: big('0.9rem', '1.5vw', '1.6rem') }}>
          {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <p className="text-white/30 mt-6" style={{ fontSize: big('0.75rem', '1vw', '1.1rem') }}>
          {companyName ? `${companyName} · ` : ''}{resumes ? `Shop board resumes ${resumes}` : 'Shop board is resting'}
        </p>
      </div>
    </div>
  );
}

/** Exit from a wall TV needs a deliberate second press — "Stay" is focused,
 *  so a stray OK on the remote never leaves the screen. */
export function TvExitConfirm({ onStay, onExit }: { onStay: () => void; onExit: () => void }) {
  const stayRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stayRef.current?.focus();
    const t = window.setTimeout(onStay, 10_000);   // walk away → it stays on
    return () => window.clearTimeout(t);
  }, [onStay]);
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="tv-exit-title" className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="rounded-3xl border border-white/15 bg-zinc-900 p-[3vw] text-center max-w-2xl">
        <p id="tv-exit-title" className="text-white font-black" style={{ fontSize: big('1.25rem', '2.2vw', '2.5rem') }}>Leave the TV display?</p>
        <p className="text-white/50 mt-2" style={{ fontSize: big('0.85rem', '1.2vw', '1.3rem') }}>It stays on by itself if nobody chooses.</p>
        <div className="mt-[3vh] flex items-center justify-center gap-4">
          <button ref={stayRef} type="button" onClick={onStay}
            className="rounded-2xl bg-amber-500 px-8 py-4 font-black text-black outline-none focus:ring-4 focus:ring-amber-300" style={{ fontSize: big('1rem', '1.4vw', '1.5rem') }}>
            Stay on TV
          </button>
          <button type="button" onClick={onExit}
            className="rounded-2xl border border-white/20 bg-white/5 px-8 py-4 font-bold text-white/80 outline-none focus:ring-4 focus:ring-white/40" style={{ fontSize: big('1rem', '1.4vw', '1.5rem') }}>
            Exit
          </button>
        </div>
      </div>
    </div>
  );
}
