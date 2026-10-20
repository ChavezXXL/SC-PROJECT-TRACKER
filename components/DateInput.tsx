/**
 * DateInput — an <input type="date"> you can type a year into.
 *
 * Chrome/Edge report every keystroke of the year ("0002-10-25", "0020-10-25"…).
 * A controlled input whose value went through a date check turned those into
 * "" (or 1902) mid-typing, so the field cleared itself under the user's
 * fingers and an unreadable due date could be saved. This keeps whatever is
 * being typed locally and only reports a complete date in 2000–2099, or ''
 * when the field is cleared. Leaving the field with a half-typed date puts
 * the last good value back.
 *
 * value / onChange use the input's own "YYYY-MM-DD" form.
 */
import React, { useEffect, useRef, useState } from 'react';
import { parseYmd } from '../utils/dueDates';

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
};

const complete = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !!parseYmd(v);

export const DateInput = ({ value, onChange, onFocus, onBlur, ...rest }: Props) => {
  const [raw, setRaw] = useState(value);
  const editing = useRef(false);
  // Follow outside changes, but never while the person is typing.
  useEffect(() => { if (!editing.current) setRaw(value); }, [value]);
  return (
    <input
      {...rest}
      type="date"
      value={raw}
      onFocus={e => { editing.current = true; onFocus?.(e); }}
      onBlur={e => {
        editing.current = false;
        if (raw !== '' && !complete(raw)) setRaw(value);
        onBlur?.(e);
      }}
      onChange={e => {
        const v = e.target.value;
        setRaw(v);
        if (v === '' || complete(v)) onChange(v);
      }}
    />
  );
};

export default DateInput;
