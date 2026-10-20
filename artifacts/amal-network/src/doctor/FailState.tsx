import { useTranslation } from 'react-i18next';
import { LogIn, RotateCcw, ShieldAlert } from 'lucide-react';
import type { Failure } from '@/network/model';
import { Empty } from '@/network/NetworkSearchPage';
import './i18n';

/** Localized error / forbidden / session-expired states shared by doctor screens. */
export function FailState({ why, onRetry, testPrefix }: { why: Failure; onRetry: () => void; testPrefix: string }) {
  const { t } = useTranslation();
  const k = why === 'denied' ? 'denied' : why === 'session' ? 'session' : 'error';
  return (
    <Empty
      icon={why === 'error' ? <RotateCcw size={30} /> : why === 'session' ? <LogIn size={30} /> : <ShieldAlert size={30} />}
      title={t(`doc.common.${k}Title`)} desc={t(`doc.common.${k}Desc`)} alert testId={`state-${testPrefix}-${why}`}
      action={why === 'error' ? <button type="button" className="amal-btn amal-btn--secondary" onClick={onRetry} data-testid={`button-${testPrefix}-retry`}><RotateCcw size={16} aria-hidden="true" />{t('doc.common.retry')}</button> : undefined}
    />
  );
}
