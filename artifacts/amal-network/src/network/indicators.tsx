import { useTranslation } from 'react-i18next';
import { Activity, MessageSquareQuote, Pill, Shield, ShieldCheck, ShieldOff, ShieldQuestion, TriangleAlert } from 'lucide-react';
import { useAmalPreferences } from '@workspace/amal-ui';
import type { AlertChip } from '@workspace/api-client-react';
import { formatVisitDay, type ConsentView } from './model';
import './i18n';

const CONSENT_ICON = { none: ShieldOff, basic: Shield, clinical: ShieldCheck, unknown: ShieldQuestion } as const;

/** Informational only: shows the server's effective level. Unknown never implies permission. */
export function ConsentBadge({ level, testId }: { level: ConsentView; testId?: string }) {
  const { t } = useTranslation();
  const Icon = CONSENT_ICON[level];
  return (
    <span className={`net-consent net-consent--${level}`} data-level={level} data-testid={testId ?? 'badge-consent'} title={t('net.consent.note')}>
      <Icon size={16} aria-hidden="true" />
      <span><span className="net-sr">{t('net.consent.label')}: </span>{t(`net.consent.${level}`)}</span>
    </span>
  );
}

const KIND_ICON = { medication: Pill, allergy: TriangleAlert, condition: Activity } as const;

/** Server-authorized flag with its original excerpt, provenance and disclaimers always adjacent. */
export function KeyAlertChip({ alert, testId }: { alert: AlertChip; testId?: string }) {
  const { t, i18n } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const Icon = KIND_ICON[alert.kind] ?? Activity;
  // App-authored label localized by server key; unknown keys fall back to the English label only in English.
  const label = i18n.exists(alert.labelKey) ? t(alert.labelKey, { ...alert.labelParams, interpolation: { escapeValue: false } }) : locale === 'en' ? alert.label : '';
  const cross = alert.crossClinicDisclaimerKey !== null;
  return (
    <figure className={`net-flag net-flag--${alert.kind}${cross ? ' is-cross' : ''}`} data-testid={testId ?? 'chip-alert'}>
      <div className="net-flag__chip">
        <Icon size={16} aria-hidden="true" />
        <span className="net-flag__kind">{t(`net.alert.kind.${alert.kind}`)}</span>
        {label && <bdi className="net-flag__label" dir="auto" data-testid="text-alert-label">{label}</bdi>}
      </div>
      <blockquote className="net-flag__quote" aria-label={t('net.alert.excerpt')}>
        <MessageSquareQuote size={14} aria-hidden="true" />
        <bdi dir="auto" data-testid="text-alert-excerpt">{alert.sourceNoteExcerpt}</bdi>
      </blockquote>
      <figcaption className="net-flag__meta">
        <span data-testid="text-alert-source">{t('net.alert.from', { clinic: '\u2068' + alert.sourceClinicName + '\u2069', date: '\u2068' + formatVisitDay(alert.sourceVisitDate, locale, digitPreference) + '\u2069' })}</span>
        {cross && <strong className="net-flag__cross" data-testid="text-alert-cross">{t('net.alert.crossClinic')}</strong>}
        <span className="net-flag__disc">{t('net.alert.disclaimer')}</span>
      </figcaption>
    </figure>
  );
}

export function NoAlerts({ testId }: { testId?: string }) {
  const { t } = useTranslation();
  return (
    <p className="net-noflags" data-testid={testId ?? 'status-no-alerts'}>
      <strong>{t('net.alert.noneTitle')}</strong> <span>{t('net.alert.noneDesc')}</span>
    </p>
  );
}
