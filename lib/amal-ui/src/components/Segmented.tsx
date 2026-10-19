import type { ReactNode } from 'react';

export interface SegmentOption<T extends string> { value: T; label: ReactNode; icon?: ReactNode; lang?: string; testId?: string }

/** Group of toggle buttons (aria-pressed). Tab moves between options. */
export function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: SegmentOption<T>[]; onChange: (v: T) => void }) {
  return (
    <div role="group" aria-label={label} className="amal-seg">
      {options.map((o) => (
        <button key={o.value} type="button" lang={o.lang} className="amal-seg__btn" aria-pressed={value === o.value} onClick={() => onChange(o.value)} data-testid={o.testId}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}
