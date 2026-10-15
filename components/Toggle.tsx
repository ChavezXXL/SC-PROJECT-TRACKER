import React from 'react';

/** iOS-style on/off switch used across Settings. Pass `label` — a switch with
 *  no name reads as just "switch, on" to a screen reader. */
export const Toggle = ({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex w-10 h-6 rounded-full transition-colors duration-200 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-500 ${
      checked ? 'bg-amber-500' : 'bg-zinc-700 hover:bg-zinc-600'
    }`}
  >
    <span
      className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow-sm transition-transform duration-200 ${
        checked ? 'translate-x-5' : 'translate-x-1'
      }`}
    />
  </button>
);
