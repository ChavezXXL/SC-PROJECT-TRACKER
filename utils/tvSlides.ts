// One catalog of TV slides, shared by the wall TV and Settings → TV Display.
// They used to keep separate lists: Settings described a 4-slide default the
// TV didn't use, "Load Default Lineup" installed a third lineup, and two
// slides in the TV's default (Today, At-Risk) couldn't be added back at all.

import type { TvSlide, TvSlideType } from '../types';

export interface TvSlideMeta {
  label: string;
  desc: string;
  icon: string;
  color: string;
  /** Shows the same content every time — a second copy just repeats it. */
  single: boolean;
}

export const TV_SLIDE_CATALOG: Record<Exclude<TvSlideType, 'stats'>, TvSlideMeta> = {
  today:         { label: "Today's Score", desc: 'Jobs done, hours, due today, overdue — the day at a glance', icon: '🎯', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400', single: true },
  'attack-plan': { label: 'Attack Plan', desc: 'Ranked "run these in this order" — risk first, then due date', icon: '⚡', color: 'bg-orange-500/15 border-orange-500/30 text-orange-400', single: true },
  workers:       { label: 'Live Workers', desc: 'Who is running what right now, with timers', icon: '👷', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400', single: true },
  'at-risk':     { label: 'At-Risk Jobs', desc: 'Jobs predicted to miss their due date', icon: '🚨', color: 'bg-red-500/15 border-red-500/30 text-red-400', single: true },
  jobs:          { label: 'Open Jobs', desc: 'Every open job, soonest due first, auto-scrolling', icon: '📋', color: 'bg-purple-500/15 border-purple-500/30 text-purple-400', single: true },
  leaderboard:   { label: 'Leaderboard', desc: 'Ranked workers by hours / jobs (today, week or month)', icon: '🏆', color: 'bg-amber-500/15 border-amber-500/30 text-amber-400', single: false },
  goals:         { label: 'Shop Goals', desc: 'Your targets from Settings → Goals', icon: '🏁', color: 'bg-teal-500/15 border-teal-500/30 text-teal-400', single: true },
  'stats-week':  { label: 'Weekly Stats', desc: 'Hours, jobs and sessions with a daily bar graph', icon: '📊', color: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400', single: true },
  weather:       { label: 'Weather', desc: 'Current conditions + 5-day outlook', icon: '🌤️', color: 'bg-cyan-500/15 border-cyan-500/30 text-cyan-400', single: true },
  'flow-map':    { label: 'Shop Flow Map', desc: 'Jobs moving through each stage, with live workers', icon: '🗺️', color: 'bg-indigo-500/15 border-indigo-500/30 text-indigo-400', single: true },
  safety:        { label: 'Safety Message', desc: 'Big, bold safety reminders that rotate', icon: '⚠️', color: 'bg-yellow-500/15 border-yellow-500/30 text-yellow-400', single: false },
  message:       { label: 'Announcement', desc: 'Your own messages — title, text and color', icon: '📢', color: 'bg-pink-500/15 border-pink-500/30 text-pink-400', single: false },
};

/** Old slides saved as 'stats' still show (as Weekly Stats). */
export function slideMeta(type: TvSlideType): TvSlideMeta {
  return type === 'stats' ? TV_SLIDE_CATALOG['stats-week'] : (TV_SLIDE_CATALOG[type] || TV_SLIDE_CATALOG.message);
}

/** The built-in lineup the TV shows when nothing is customized. Module-level
 *  constant so the TV's memoized slide list keeps a stable identity. */
export const DEFAULT_TV_SLIDES: TvSlide[] = [
  { id: 'default-today', type: 'today', enabled: true },
  { id: 'default-attack-plan', type: 'attack-plan', enabled: true },
  { id: 'default-workers', type: 'workers', enabled: true },
  { id: 'default-at-risk', type: 'at-risk', enabled: true },
  { id: 'default-jobs', type: 'jobs', enabled: true },
  { id: 'default-leaderboard-week', type: 'leaderboard', enabled: true, leaderboardMetric: 'mixed', leaderboardPeriod: 'week', leaderboardCount: 5 },
  { id: 'default-goals', type: 'goals', enabled: true },
  { id: 'default-stats-week', type: 'stats-week', enabled: true },
  { id: 'default-weather', type: 'weather', enabled: true },
];

/** A fresh, editable copy of the built-in lineup (unique ids). */
export function defaultLineup(now: number = Date.now()): TvSlide[] {
  return DEFAULT_TV_SLIDES.map((s, i) => ({ ...s, id: `slide_${now}_${i + 1}` }));
}

/** What the TV actually rotates through: the shop's enabled slides, or the
 *  built-in lineup when none are set up / all are switched off. */
export function effectiveTvSlides(slides?: TvSlide[]): TvSlide[] {
  const enabled = (slides || []).filter(s => s.enabled);
  if (enabled.length === 0) return DEFAULT_TV_SLIDES;
  const seen = new Set<string>();
  return enabled.filter(s => (seen.has(s.id) ? false : (seen.add(s.id), true)));
}
