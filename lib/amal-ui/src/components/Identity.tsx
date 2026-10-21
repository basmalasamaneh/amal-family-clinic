import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';
import { Icon } from '../icons';

const HUES = 6;
export function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)!) >>> 0;
  return h % HUES;
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = Array.from(parts[0])[0] ?? '';
  const last = parts.length > 1 ? Array.from(parts[parts.length - 1])[0] ?? '' : '';
  return (first + last).toUpperCase();
}
/** Initials avatar; tint is derived from the name (decorative, never meaning). */
export function Avatar({ name, size = 'md', className }: { name: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return <span className={cx('amal-avatar', `amal-avatar--${size}`, className)} data-hue={avatarHue(name)} aria-hidden="true"><bdi>{initials(name)}</bdi></span>;
}

export type ConsentState = 'granted' | 'withdrawn' | 'pending' | 'unknown';
export function ConsentBadge({ state }: { state: ConsentState }) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <span className="amal-badge" data-consent={state} data-testid={`badge-consent-${state}`}>
      <Icon name={state === 'granted' ? 'shield' : state === 'withdrawn' ? 'shieldOff' : state === 'pending' ? 'clock' : 'info'} size={14} />
      {t(`consent.${state}`)}
    </span>
  );
}

/** Key clinical alert (e.g. allergy). Text supplied by caller; icon + text, never colour alone. */
export function KeyAlertChip({ children, level = 'high' }: { children: ReactNode; level?: 'high' | 'info' }) {
  return <span className="amal-badge amal-keyalert" data-level={level} data-testid="chip-key-alert"><Icon name="alert" size={14} /><bdi dir="auto">{children}</bdi></span>;
}

/** Wraps phone numbers so they always render LTR inside RTL text. */
export function Phone({ value }: { value: string }) { return <bdi dir="ltr" className="amal-tel">{value}</bdi>; }
/** Wraps names, emails and other user-entered strings with automatic direction. */
export function Bidi({ children }: { children: ReactNode }) { return <bdi dir="auto">{children}</bdi>; }
