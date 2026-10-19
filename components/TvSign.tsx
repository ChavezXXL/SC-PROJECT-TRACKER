import React, { useState } from 'react';

// Emoji as pictures (Twemoji), not font glyphs: the shop's Fire TV font is
// from 2018 and drew newer emoji — 🦺 vest, 🪖 helmet, 🪜 ladder — as an
// empty box. Falls back to the plain glyph if the picture can't load.
const TWEMOJI = 'https://cdn.jsdelivr.net/gh/jdecked/twemoji@15.1.0/assets/svg/';
export function emojiFile(e: string): string {
  const cps = [...e].map(c => c.codePointAt(0)!.toString(16));
  const keycap = cps.includes('20e3');
  return cps.filter(cp => keycap || cp !== 'fe0f').join('-');
}
export function TvEmoji({ e, size }: { e: string; size: string }) {
  const [failed, setFailed] = useState(false);
  // (No \p{…} regex: an older TV web engine can't even parse one.)
  if (failed || ![...e].some(c => (c.codePointAt(0) || 0) > 0x2100)) return <span style={{ fontSize: size, lineHeight: 1 }}>{e}</span>;
  return <img src={`${TWEMOJI}${emojiFile(e)}.svg`} alt="" draggable={false} onError={() => setFailed(true)} style={{ width: size, height: size }} />;
}

// A TV message laid out like a real shop safety sign (ANSI Z535 style): a
// bold colored band with the signal word, then a big icon, headline and
// text that fill a widescreen TV instead of a small centered box. Sized by
// both width and height, so it fits a 960×540 TV stick and a 4K panel alike.

export type SignTone = 'yellow' | 'orange' | 'red' | 'blue' | 'green' | 'white';

const TONES: Record<SignTone, { band: string; ink: string; edge: string; stripe: string | null; word: string; symbol: string }> = {
  yellow: { band: '#FACC15', ink: '#0A0A0A', edge: '#FACC15', stripe: '#0A0A0A', word: 'Caution', symbol: '⚠' },
  orange: { band: '#F97316', ink: '#0A0A0A', edge: '#F97316', stripe: '#0A0A0A', word: 'Warning', symbol: '⚠' },
  red:    { band: '#DC2626', ink: '#FFFFFF', edge: '#EF4444', stripe: '#FFFFFF', word: 'Danger', symbol: '⚠' },
  blue:   { band: '#2563EB', ink: '#FFFFFF', edge: '#3B82F6', stripe: null, word: 'Notice', symbol: 'ℹ' },
  green:  { band: '#16A34A', ink: '#FFFFFF', edge: '#22C55E', stripe: null, word: 'Safety First', symbol: '✚' },
  white:  { band: '#E4E4E7', ink: '#0A0A0A', edge: '#D4D4D8', stripe: null, word: 'Reminder', symbol: '★' },
};

export const asTone = (c?: string, fallback: SignTone = 'yellow'): SignTone =>
  c && c in TONES ? (c as SignTone) : fallback;

/** The standard signal word for a tone (Caution, Warning, Danger, …). */
export const toneWord = (tone: SignTone) => TONES[tone].word;

export function TvSign({ tone, word, symbol, icon, title, body, meta }: {
  tone: SignTone;
  /** Band text; defaults to the tone's signal word. */
  word?: string;
  /** Small mark before the band text; defaults to the tone's. */
  symbol?: string;
  icon?: string;
  title: string;
  body?: string;
  /** Right side of the band, e.g. "Tip 7 of 40". */
  meta?: string;
}) {
  const t = TONES[tone] || TONES.yellow;
  // Longer messages get smaller type so a long note still fits the screen.
  const tScale = title.length > 60 ? 0.68 : title.length > 36 ? 0.84 : 1;
  const bScale = !body ? 1 : body.length > 240 ? 0.7 : body.length > 150 ? 0.84 : 1;
  const stripes = t.stripe ? `repeating-linear-gradient(-45deg, ${t.band} 0 18px, ${t.stripe} 18px 36px)` : null;
  const box = 'clamp(4.5rem, min(16vw, 30vh), 19rem)';
  return (
    <div className="h-full w-full flex items-center justify-center overflow-hidden" style={{ padding: 'clamp(0.75rem, min(2.5vw, 3.5vh), 3rem)' }}>
      <div className="w-full h-full max-w-[1800px] max-h-[1100px] flex flex-col overflow-hidden bg-zinc-950"
        style={{ borderRadius: 'clamp(0.75rem, 1.6vw, 1.75rem)', border: `clamp(4px, 0.45vw, 8px) solid ${t.edge}`, boxShadow: `0 0 70px ${t.edge}30` }}>
        {/* Signal band */}
        <div className="shrink-0 flex items-center justify-between gap-4"
          style={{ background: t.band, color: t.ink, padding: 'clamp(0.35rem, min(1vw, 1.8vh), 1rem) clamp(1rem, 2.2vw, 2.25rem)' }}>
          <span className="font-black uppercase flex items-center min-w-0" style={{ fontSize: 'clamp(1.1rem, min(3.1vw, 5.6vh), 4rem)', lineHeight: 1, letterSpacing: '0.1em', gap: '0.45em' }}>
            <span aria-hidden="true">{symbol ?? t.symbol}</span>
            <span className="truncate">{word || t.word}</span>
          </span>
          {meta && (
            <span className="shrink-0 font-black uppercase tabular opacity-75" style={{ fontSize: 'clamp(0.6rem, min(1vw, 1.8vh), 1.05rem)', letterSpacing: '0.18em' }}>{meta}</span>
          )}
        </div>
        {/* The message */}
        <div className="flex-1 min-h-0 flex items-center" style={{ gap: 'clamp(1rem, 3vw, 3.25rem)', padding: 'clamp(0.75rem, min(2.6vw, 4vh), 3rem) clamp(1rem, 3.2vw, 3.75rem)' }}>
          {icon && (
            <div aria-hidden="true" className="shrink-0 flex items-center justify-center"
              style={{ width: box, height: box, borderRadius: '24%', background: `${t.edge}1f`, border: `2px solid ${t.edge}66`, fontSize: 'clamp(2.4rem, min(8.8vw, 16.5vh), 10.5rem)', lineHeight: 1 }}>
              <TvEmoji e={icon} size="0.9em" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="font-black text-white tracking-tight text-balance line-clamp-3" style={{ fontSize: `calc(clamp(1.6rem, min(5.2vw, 10vh), 7rem) * ${tScale})`, lineHeight: 1.04 }}>{title}</h2>
            {body && (
              <p className="text-white/85 font-semibold leading-snug text-pretty line-clamp-5" style={{ fontSize: `calc(clamp(1rem, min(2.3vw, 4.4vh), 2.9rem) * ${bScale})`, marginTop: '0.6em' }}>{body}</p>
            )}
          </div>
        </div>
        {stripes && <div aria-hidden="true" className="shrink-0" style={{ height: 'clamp(10px, 1.7vh, 20px)', background: stripes }} />}
      </div>
    </div>
  );
}
