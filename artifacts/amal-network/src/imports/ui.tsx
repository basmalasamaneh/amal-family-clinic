import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

/** Radix dialog: focus trap, Escape and focus restoration to the opener. */
export function Modal({ open, onOpenChange, title, children, wide, testId }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; wide?: boolean; testId: string }) {
  const { t } = useTranslation();
  // Controlled dialog without Dialog.Trigger: remember the opener and restore focus to it on close.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => { if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) opener.current = document.activeElement; }, [open]);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="im-overlay" />
        <Dialog.Content className={`im-dialog${wide ? ' im-dialog--wide' : ''}`} data-testid={testId} aria-describedby={undefined}
          onCloseAutoFocus={(e) => { e.preventDefault(); const el = opener.current; opener.current = null; if (el && el.isConnected) el.focus(); }}>
          <div className="im-dialog__head">
            <Dialog.Title className="im-dialog__title">{title}</Dialog.Title>
            <Dialog.Close className="im-icon-btn" aria-label={t('im.common.close')} data-testid={`${testId}-close`}><X size={20} aria-hidden="true" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Msg({ tone, children, testId, live = 'polite' }: { tone: 'ok' | 'warn' | 'block' | 'info'; children: ReactNode; testId?: string; live?: 'polite' | 'assertive' | 'off' }) {
  const Icon = tone === 'ok' ? CheckCircle2 : tone === 'info' ? Info : AlertTriangle;
  return (
    <div className={`im-msg im-msg--${tone}`} role={tone === 'block' ? 'alert' : 'status'} aria-live={live} data-testid={testId}>
      <Icon size={18} aria-hidden="true" /><div>{children}</div>
    </div>
  );
}

/** Mixed-direction isolation for names, emails, phones and raw source values. */
export const Iso = ({ children, ltr, testId }: { children: ReactNode; ltr?: boolean; testId?: string }) => <bdi dir={ltr ? 'ltr' : 'auto'} data-testid={testId}>{children}</bdi>;

export function Skeleton({ lines = 4, label }: { lines?: number; label: string }) {
  return (
    <div role="status" aria-live="polite" className="im-skel-wrap">
      <span className="im-sr">{label}</span>
      {Array.from({ length: lines }, (_, i) => <div key={i} className="im-skel" aria-hidden="true" />)}
    </div>
  );
}
