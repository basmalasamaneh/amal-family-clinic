import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';
import { Icon } from '../icons';
import { useAmalPreferences } from '../preferences/PreferencesProvider';

export interface TabItem { id: string; label: ReactNode; count?: number }
/** ARIA tabs; arrow keys follow visual order (mirrored in RTL). */
export function Tabs({ items, value, onChange, label, children, idBase }: { items: TabItem[]; value: string; onChange: (id: string) => void; label: string; children?: ReactNode; idBase?: string }) {
  const auto = useId();
  const base = idBase ?? auto;
  const { dir } = useAmalPreferences();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKey = (e: KeyboardEvent) => {
    const i = items.findIndex((x) => x.id === value);
    let n = -1;
    const next = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
    const prev = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === next) n = (i + 1) % items.length;
    else if (e.key === prev) n = (i - 1 + items.length) % items.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = items.length - 1;
    if (n < 0) return;
    e.preventDefault();
    onChange(items[n].id);
    refs.current[items[n].id]?.focus();
  };
  return (
    <div className="amal-tabs">
      <div role="tablist" aria-label={label} className="amal-tabs__list" onKeyDown={onKey}>
        {items.map((it) => (
          <button key={it.id} ref={(el) => { refs.current[it.id] = el; }} type="button" role="tab" id={`${base}-tab-${it.id}`} aria-controls={`${base}-panel`}
            aria-selected={value === it.id} tabIndex={value === it.id ? 0 : -1} className="amal-tabs__tab" onClick={() => onChange(it.id)} data-testid={`tab-${it.id}`}>
            {it.label}{it.count !== undefined && <span className="amal-tabs__count amal-num">{it.count}</span>}
          </button>
        ))}
      </div>
      {children !== undefined && <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${value}`} className="amal-tabs__panel" tabIndex={0}>{children}</div>}
    </div>
  );
}

export interface StepperProps { steps: ReactNode[]; current: number; label: string }
/** Horizontal stepper; flows inline-start to inline-end so it mirrors in RTL. */
export function Stepper({ steps, current, label }: StepperProps) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <ol className="amal-stepper" aria-label={label}>
      {steps.map((s, i) => {
        const state = i < current ? 'done' : i === current ? 'current' : 'todo';
        return (
          <li key={i} className="amal-stepper__step" data-state={state} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="amal-stepper__num amal-num" aria-hidden="true">{state === 'done' ? <Icon name="check" size={14} /> : i + 1}</span>
            <span className="amal-stepper__label">{s}<span className="amal-sr-only"> ({t(`stepper.${state}`)})</span></span>
          </li>
        );
      })}
    </ol>
  );
}

export interface ConfirmDialogProps { open: boolean; title: ReactNode; description?: ReactNode; confirmLabel: ReactNode; cancelLabel?: ReactNode; tone?: 'primary' | 'danger'; onConfirm: () => void; onCancel: () => void; busy?: boolean }
/** Native modal dialog (focus trap + Escape handled by the platform). */
export function ConfirmDialog({ open, title, description, confirmLabel, cancelLabel, tone = 'primary', onConfirm, onCancel, busy }: ConfirmDialogProps) {
  const { t } = useTranslation(AMAL_UI_NS);
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const cancelRef = useRef(onCancel);
  cancelRef.current = onCancel;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal?.();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="amal-dialog" aria-labelledby={`${id}-t`} aria-describedby={description ? `${id}-d` : undefined}
      onCancel={(e) => { e.preventDefault(); cancelRef.current(); }} data-testid="dialog-confirm">
      <h2 id={`${id}-t`} className="amal-dialog__title">{title}</h2>
      {description && <p id={`${id}-d`} className="amal-dialog__desc">{description}</p>}
      <div className="amal-dialog__actions">
        <button type="button" className="amal-btn amal-btn--secondary" onClick={onCancel} data-testid="button-confirm-cancel">{cancelLabel ?? t('dialog.cancel')}</button>
        <button type="button" className={cx('amal-btn', tone === 'danger' ? 'amal-btn--danger' : 'amal-btn--primary')} onClick={onConfirm} disabled={busy} aria-busy={busy || undefined} data-testid="button-confirm-ok">{confirmLabel}</button>
      </div>
    </dialog>
  );
}

export interface FormFieldProps { label: ReactNode; hint?: ReactNode; error?: ReactNode; required?: boolean; children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode }
/** Label + control + hint/error wiring for any control (render-prop gives ids). */
export function FormField({ label, hint, error, required, children }: FormFieldProps) {
  const { t } = useTranslation(AMAL_UI_NS);
  const id = useId();
  const describedBy = [hint && `${id}-h`, error && `${id}-e`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="amal-field">
      <label htmlFor={id} className="amal-field__label">{label}{required ? <span className="amal-field__req">({t('field.required')})</span> : <span className="amal-field__opt">({t('field.optional')})</span>}</label>
      {children({ id, describedBy, invalid: !!error })}
      {hint && <p id={`${id}-h`} className="amal-field__hint">{hint}</p>}
      {error && <p id={`${id}-e`} className="amal-field__error" role="alert"><Icon name="warning" size={14} />{error}</p>}
    </div>
  );
}
