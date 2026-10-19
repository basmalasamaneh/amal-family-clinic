import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CircleCheck, Info, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';
export interface ToastInput {
  title: string;
  description?: string;
  tone?: ToastTone;
  action?: { label: string; onClick: () => void };
  /** ms; 0 keeps it until dismissed. Default 6000. */
  duration?: number;
}
interface ToastItem extends ToastInput { id: number }

interface ToastApi { show: (t: ToastInput) => number; dismiss: (id: number) => void }
const ToastContext = createContext<ToastApi | null>(null);

const ICON = { info: Info, success: CircleCheck, warning: AlertTriangle, danger: AlertTriangle };

function ToastView({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const { t } = useTranslation(AMAL_UI_NS);
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;
  const duration = item.duration ?? 6000;
  useEffect(() => {
    if (!duration || paused) return;
    const h = window.setTimeout(() => dismissRef.current(item.id), duration);
    return () => window.clearTimeout(h);
  }, [duration, paused, item.id]);
  const Icon = ICON[item.tone ?? 'info'];
  const urgent = item.tone === 'danger' || item.tone === 'warning';
  return (
    <div
      className="amal-toast"
      role={urgent ? 'alert' : 'status'}
      data-tone={item.tone ?? 'info'}
      data-testid={`toast-${item.id}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon className="amal-toast__icon" size={20} aria-hidden="true" />
      <div>
        <p className="amal-toast__title">{item.title}</p>
        {item.description && <p className="amal-toast__desc">{item.description}</p>}
        {item.action && (
          <button type="button" className="amal-toast__action" onClick={() => { item.action?.onClick(); onDismiss(item.id); }}>
            {item.action.label}
          </button>
        )}
      </div>
      <button type="button" className="amal-toast__close" aria-label={t('toast.close')} onClick={() => onDismiss(item.id)} data-testid={`button-toast-close-${item.id}`}>
        <X size={18} aria-hidden="true" />
      </button>
    </div>
  );
}

/** Renders a polite live region; danger/warning toasts use role="alert". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation(AMAL_UI_NS);
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback((input: ToastInput) => {
    const id = ++seq.current;
    setItems((xs) => [...xs.slice(-3), { ...input, id }]);
    return id;
  }, []);
  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);
  return (
    <ToastContext.Provider value={api}>
      {children}
      <section className="amal-toasts" aria-label={t('toast.region')} aria-live="polite">
        {items.map((it) => <ToastView key={it.id} item={it} onDismiss={dismiss} />)}
      </section>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
