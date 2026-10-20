import { useTranslation } from 'react-i18next';
import { DoorOpen } from 'lucide-react';
import { requestWalkIn, useWalkInAvailable, type WalkInContext } from './walkin-bus';

/** Walk-in entry inside a transient overlay. `before` may close an overlay that holds no input. */
export function WalkInHandoff({ className = 'bk-btn bk-btn--sm', before, context, testId = 'button-overlay-walkin' }: { className?: string; before?: () => void; context?: WalkInContext; testId?: string }) {
  const { t } = useTranslation();
  if (!useWalkInAvailable()) return null;
  return (
    <button type="button" className={className} data-testid={testId} aria-haspopup="dialog"
      onClick={() => { before?.(); const c = context; setTimeout(() => requestWalkIn(c), 0); }}>
      <DoorOpen size={18} aria-hidden="true" />{t('calendar.actions.walkIn')}
    </button>
  );
}
