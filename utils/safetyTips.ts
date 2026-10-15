// Built-in tips for the TV's Safety slide — written for an aerospace
// deburring / finishing shop. They mix in with the shop's own messages (one
// per pass), starting at a different tip each day so the wall stays fresh.

export type TipKind = 'safety' | 'fod' | 'quality' | 'shop';

export interface ShopTip {
  kind: TipKind;
  icon: string;
  title: string;
  body: string;
  color: 'blue' | 'yellow' | 'red' | 'green' | 'white' | 'orange';
}

export const TIP_KIND_LABEL: Record<TipKind, string> = {
  safety: 'Safety Reminder',
  fod: 'FOD Prevention',
  quality: 'Quality Reminder',
  shop: 'Shop Tip',
};

export const SHOP_TIPS: ShopTip[] = [
  // ── Safety ──
  { kind: 'safety', icon: '🥽', color: 'yellow', title: 'Eyes on, every time', body: 'Safety glasses go on before you pick up a deburring tool. Burrs and chips fly farther than you think.' },
  { kind: 'safety', icon: '🧤', color: 'orange', title: 'Sharp edges bite', body: 'Fresh-cut edges are razor sharp. Wear cut-resistant gloves when handling parts straight off the machine.' },
  { kind: 'safety', icon: '🎧', color: 'yellow', title: 'Protect your hearing', body: 'Tumblers, grinders and air tools add up. Wear hearing protection in loud areas — hearing loss does not come back.' },
  { kind: 'safety', icon: '😷', color: 'yellow', title: 'Breathe clean air', body: 'Use dust collection or a respirator when sanding, grinding or blasting. Fine metal dust and grit stay in your lungs.' },
  { kind: 'safety', icon: '🔒', color: 'red', title: 'Lock it out', body: 'Before you clear a jam or reach into a machine, lock it out and tag it. Never trust the off switch alone.' },
  { kind: 'safety', icon: '⚙️', color: 'red', title: 'Guards stay on', body: 'Never run a grinder, buffer or belt sander with the guard off or the tool rest out of adjustment.' },
  { kind: 'safety', icon: '💨', color: 'orange', title: 'Air is not a broom', body: 'Never blow chips off yourself or toward anyone. Use a chip brush, and a safety nozzle under 30 psi for cleaning.' },
  { kind: 'safety', icon: '🧪', color: 'orange', title: 'Know your chemicals', body: 'Read the SDS before using a new cleaner, compound or solvent, and wear the gloves and goggles it calls for.' },
  { kind: 'safety', icon: '🔥', color: 'red', title: 'Rags go in the red can', body: 'Solvent rags can catch fire on their own. Put them in the metal safety can and keep sparks away from cleaning areas.' },
  { kind: 'safety', icon: '🧹', color: 'yellow', title: 'Clean as you go', body: 'A clean floor is a safe floor. Wipe up coolant and compound spills right away and keep the walkways clear.' },
  { kind: 'safety', icon: '🏋️', color: 'yellow', title: 'Lift smart', body: 'Bend your knees, keep the load close, and get help or a cart for anything heavy or awkward. Full bins add up fast.' },
  { kind: 'safety', icon: '💍', color: 'orange', title: 'Nothing to catch', body: 'No loose sleeves, jewelry or long hair near spinning tools. If it can get caught, it will.' },
  { kind: 'safety', icon: '✋', color: 'orange', title: 'Hands out of the line of fire', body: 'Clamp small parts or use a fixture instead of holding them by hand against a moving tool.' },
  { kind: 'safety', icon: '🩹', color: 'yellow', title: 'Report every cut', body: 'Even a small cut gets reported and cleaned. It keeps you healthy and helps us fix what caused it.' },
  { kind: 'safety', icon: '🚑', color: 'green', title: 'Know where it is', body: 'Know where the first-aid kit, eyewash station and fire extinguisher are — before you ever need them.' },
  { kind: 'safety', icon: '🔌', color: 'yellow', title: 'Check hoses and cords', body: 'Look over air hoses and power cords before use. Frayed, cut or leaking? Tag it and swap it out.' },
  { kind: 'safety', icon: '🛠️', color: 'yellow', title: 'Sharp tools are safer', body: 'Use the right deburring tool with a sharp blade. Dull tools slip, and slips cause cuts.' },
  { kind: 'safety', icon: '💧', color: 'blue', title: 'Stay hydrated', body: 'Drink water through the shift, especially near ovens and wash lines, and on hot days.' },
  { kind: 'safety', icon: '🙆', color: 'green', title: 'Take a stretch', body: 'Hand deburring is hard on wrists and shoulders. Stretch and change your grip every hour.' },
  { kind: 'safety', icon: '🗣️', color: 'red', title: 'See it, say it', body: 'See something unsafe? Stop and speak up. Everyone here can stop unsafe work.' },
  // ── FOD (foreign object debris) ──
  { kind: 'fod', icon: '🔩', color: 'orange', title: 'FOD is everyone\'s job', body: 'Loose debris can ground an aircraft. Keep your bench clean and account for every tool, part and fastener.' },
  { kind: 'fod', icon: '🧰', color: 'orange', title: 'Tools in, tools out', body: 'Shadow boards and tool counts stop FOD. Every tool goes back where it lives when the job is done.' },
  { kind: 'fod', icon: '🚶', color: 'orange', title: 'Do a FOD walk', body: 'Before you leave your area, look down and pick up any chips, wire, hardware or debris.' },
  { kind: 'fod', icon: '📦', color: 'orange', title: 'Cap it, bag it', body: 'Cover open holes and bag finished parts right away so nothing gets inside on the way to inspection.' },
  { kind: 'fod', icon: '🧽', color: 'orange', title: 'Chips stay here', body: 'Clean every part completely before it leaves your station. A chip found later means rework — or worse.' },
  // ── Quality ──
  { kind: 'quality', icon: '📋', color: 'blue', title: 'Read the traveler first', body: 'Right part, right revision, right operation, right quantity — check the traveler and the drawing before you start.' },
  { kind: 'quality', icon: '🔤', color: 'blue', title: 'Verify the revision', body: 'The wrong revision means scrapped work. Make sure the drawing rev matches the PO before the first piece.' },
  { kind: 'quality', icon: '🔍', color: 'blue', title: 'First piece first', body: 'Inspect the first part before running the batch. Catching it on one part beats catching it on a hundred.' },
  { kind: 'quality', icon: '📏', color: 'blue', title: 'Measure, don\'t guess', body: 'Use calibrated gauges and check the cal sticker. Out of date? Don\'t use it — tell a lead.' },
  { kind: 'quality', icon: '🏷️', color: 'blue', title: 'Keep it identified', body: 'Every part and bin keeps its tag and paperwork. A part nobody can identify can\'t ship.' },
  { kind: 'quality', icon: '⛔', color: 'red', title: 'When in doubt, hold it', body: 'Not sure a part is good? Set it aside, tag it, and ask. Never pass on a part you have doubts about.' },
  { kind: 'quality', icon: '✍️', color: 'blue', title: 'Sign it off as you go', body: 'Record your work on the traveler when you do it. If it isn\'t written down, it didn\'t happen.' },
  { kind: 'quality', icon: '🔁', color: 'blue', title: 'Report what you find', body: 'Found a defect from an earlier step? Report it right away so the cause gets fixed, not just the part.' },
  { kind: 'quality', icon: '🧼', color: 'blue', title: 'Handle with care', body: 'Aerospace finishes scratch easily. Use clean gloves and separators, and never stack bare parts metal on metal.' },
  { kind: 'quality', icon: '⏱️', color: 'green', title: 'Right the first time', body: 'Doing it right the first time is the fastest way to ship on time. Rework is the slowest job in the shop.' },
  // ── Shop ──
  { kind: 'shop', icon: '🤝', color: 'green', title: 'Help the next person', body: 'Leave your station the way you would want to find it — clean, stocked and ready to go.' },
  { kind: 'shop', icon: '🎯', color: 'green', title: 'Know what\'s next', body: 'Check the board before starting your next job: late jobs first, then the soonest due.' },
  { kind: 'shop', icon: '📅', color: 'green', title: 'Every part has a promise date', body: 'Each job on the floor was promised to a customer. Keep it moving, and flag anything that\'s stuck.' },
  { kind: 'shop', icon: '💬', color: 'green', title: 'Ask early', body: 'Questions about a print, a spec or a setup? Ask before you start — not after the batch is done.' },
  { kind: 'shop', icon: '⭐', color: 'white', title: 'These parts fly', body: 'Treat every part like someone\'s life depends on it — because it might.' },
];

/** The tip for the n-th pass of the safety slide today: a different starting
 *  point each day, then one tip per pass. */
export function tipForPass(pass: number, now: Date = new Date()): ShopTip {
  const day = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 86_400_000);
  const n = SHOP_TIPS.length;
  return SHOP_TIPS[(((day * 7 + pass) % n) + n) % n];
}
