import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { Ban, CalendarClock, Info, ShieldAlert, TriangleAlert, X } from 'lucide-react';
import type { ConflictItem, ConflictItemSuggestedSlotsItem, ConflictPreview } from '@workspace/api-client-react';
import { WalkInHandoff } from '@/reception/WalkInHandoff';
import { summarize } from './conflicts';

export interface ConflictDialogProps {
  open: boolean; onOpenChange: (o: boolean) => void;
  preview: ConflictPreview; clinicId: number; doctorName: string;
  /** Pre-formatted local interval label for the requested slot. */
  whenLabel: string; formatSlot: (s: ConflictItemSuggestedSlotsItem) => string;
  ack: boolean; onAck: (v: boolean) => void; reason: string; onReason: (v: string) => void; reasonError: boolean;
  onPick: (s: ConflictItemSuggestedSlotsItem) => void;
}
const ICON = { blocking: Ban, warning: TriangleAlert, info: Info } as const;
const TONE = { blocking: 'block', warning: 'warn', info: 'info' } as const;

export function ConflictDialog(p: ConflictDialogProps) {
  const { t } = useTranslation();
  const s = summarize(p.preview);
  const ordered: ConflictItem[] = [...s.blocking, ...s.warnings, ...s.info];
  const hasDoctor = s.blocking.some((c) => c.type === 'doctor-overlap' || c.type === 'slot-held' || c.type === 'outside-hours');
  return (
    <Dialog.Root open={p.open} onOpenChange={p.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="bk-overlay bk-dialog-overlay" />
        <Dialog.Content className="bk-dialog" data-testid="dialog-conflicts" aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            document.querySelector<HTMLElement>('[data-testid="button-review-conflicts"]')?.focus();
          }}>
          <div className="bk-dialog__head">
            <Dialog.Title className="bk-dialog__title">{t('bk.conflict.title')}</Dialog.Title>
            <WalkInHandoff testId="button-conflict-walkin" />
            <Dialog.Close className="bk-x" aria-label={t('bk.conflict.close')} data-testid="button-close-conflicts"><X size={20} aria-hidden="true" /></Dialog.Close>
          </div>
          <p className="bk-hint"><bdi dir="auto">{t('bk.conflict.intro', { doctor: p.doctorName, when: p.whenLabel })}</bdi></p>
          <ul className="bk-list">
            {ordered.map((c, i) => {
              const sev = (c.severity in ICON ? c.severity : 'blocking') as keyof typeof ICON;
              const Icon = ICON[sev];
              const known = ['doctor-overlap', 'slot-held', 'outside-hours', 'patient-overlap', 'same-day-other-clinic'].includes(c.type);
              return (
                <li key={i} className={`bk-msg bk-msg--${TONE[sev]}`} data-testid={`conflict-${c.type}`}>
                  <Icon size={20} aria-hidden="true" />
                  <div className="bk-msg__body">
                    <span className="bk-sev">{t(`bk.conflict.sev.${sev}`)}</span>
                    <p><strong>{t(known ? `bk.conflict.types.${c.type}` : 'bk.conflict.types.unknown')}</strong></p>
                    <p className="bk-hint">{c.with
                      ? t('bk.conflict.with', { id: c.with.appointmentId, clinic: c.with.clinicId === p.clinicId ? t('bk.conflict.thisClinic') : t('bk.conflict.otherClinic') })
                      : t('bk.conflict.redacted')}</p>
                  </div>
                </li>
              );
            })}
          </ul>
          {hasDoctor && (
            <section aria-labelledby="bk-sugg-h" className="bk-field">
              <h3 id="bk-sugg-h" className="bk-label"><CalendarClock size={16} aria-hidden="true" /> {t('bk.conflict.suggestTitle')}</h3>
              {s.suggestions.length > 0 && (
                <ul className="bk-slots">
                  {s.suggestions.map((sl) => (
                    <li key={sl.startsAt}>
                      <button type="button" className="bk-btn" onClick={() => p.onPick(sl)} data-testid={`button-suggestion-${sl.startsAt}`}>
                        <CalendarClock size={18} aria-hidden="true" /><bdi>{t('bk.conflict.pick', { when: p.formatSlot(sl) })}</bdi>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {s.suggestions.length === 0 && <p className="bk-hint" data-testid="text-suggestions-none">{t('bk.conflict.suggestNone')}</p>}
              {s.suggestions.length > 0 && s.suggestions.length < 3 && <p className="bk-hint" data-testid="text-suggestions-fewer">{t('bk.conflict.suggestFewer', { count: s.suggestions.length })}</p>}
            </section>
          )}
          {s.overrideable ? (
            <section aria-labelledby="bk-ovr-h" className="bk-field" data-testid="section-override">
              <h3 id="bk-ovr-h" className="bk-label"><ShieldAlert size={16} aria-hidden="true" /> {t('bk.conflict.overrideTitle')}</h3>
              <label className="bk-check"><input type="checkbox" checked={p.ack} onChange={(e) => p.onAck(e.target.checked)} data-testid="checkbox-override-ack" />{t('bk.conflict.overrideAck')}</label>
              {p.ack && <>
                <label className="bk-label" htmlFor="bk-reason">{t('bk.conflict.reason')}</label>
                <textarea id="bk-reason" className="bk-input" dir="auto" maxLength={2000} value={p.reason} aria-invalid={p.reasonError}
                  aria-describedby={p.reasonError ? 'bk-reason-err' : undefined} onChange={(e) => p.onReason(e.target.value)} data-testid="input-override-reason" />
                {p.reasonError && <p id="bk-reason-err" className="bk-err">{t('bk.conflict.reasonErr')}</p>}
              </>}
            </section>
          ) : s.blocking.length > 0 && <p className="bk-hint" data-testid="text-no-override">{t('bk.conflict.noOverride')}</p>}
          <Dialog.Close className="bk-btn">{t('bk.conflict.close')}</Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
