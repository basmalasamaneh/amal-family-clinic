import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';

/*
 * Inline renderings of assets/amal-logo-mark.svg and assets/amal-logo-horizontal.svg.
 * Artwork is unchanged; it is inlined so the wordmark <text> uses the page-loaded
 * IBM Plex Sans Arabic (an <img> SVG cannot see document web fonts and would fall back).
 * Gradient/clip ids are scoped per instance to avoid collisions.
 */
function MarkArt({ uid }: { uid: string }) {
  return (
    <>
      <rect width="512" height="512" rx="116" fill={`url(#${uid}-bg)`} />
      <g clipPath={`url(#${uid}-badge)`}>
        <circle cx="256" cy="486" r="150" fill="#F5B544" />
        <circle cx="256" cy="486" r="198" fill="none" stroke="#F5B544" strokeOpacity=".55" strokeWidth="10" />
        <circle cx="256" cy="486" r="246" fill="none" stroke="#F5B544" strokeOpacity=".28" strokeWidth="10" />
      </g>
      <rect x="226" y="108" width="60" height="176" rx="18" fill="#FFFFFF" />
      <rect x="168" y="166" width="176" height="60" rx="18" fill="#FFFFFF" />
    </>
  );
}
function Defs({ uid }: { uid: string }) {
  return (
    <defs>
      <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#139AA6" />
        <stop offset="1" stopColor="#0B5F69" />
      </linearGradient>
      <clipPath id={`${uid}-badge`}><rect width="512" height="512" rx="116" /></clipPath>
    </defs>
  );
}

export function AmalMark({ size = 40, className }: { size?: number; className?: string }) {
  const { t } = useTranslation(AMAL_UI_NS);
  const uid = `amal${useId().replace(/:/g, '')}`;
  return (
    <svg viewBox="0 0 512 512" width={size} height={size} role="img" aria-label={t('brand.markLabel')} className={className}>
      <Defs uid={uid} />
      <MarkArt uid={uid} />
    </svg>
  );
}

/** Horizontal lockup on a theme-safe white island (dark theme). */
export function AmalLogo({ className }: { className?: string }) {
  const { t } = useTranslation(AMAL_UI_NS);
  const uid = `amal${useId().replace(/:/g, '')}`;
  return (
    <span className="amal-logo-island" data-testid="img-logo">
      <svg viewBox="0 0 760 160" role="img" aria-label={t('brand.logoLabel')} className={className ?? 'amal-logo'} lang="en" direction="ltr">
        <Defs uid={uid} />
        <svg x="0" y="0" width="160" height="160" viewBox="0 0 512 512"><MarkArt uid={uid} /></svg>
        <g fontFamily="'IBM Plex Sans Arabic','Segoe UI',Tahoma,Arial,sans-serif" aria-hidden="true">
          <text x="190" y="78" fontSize="52" fontWeight="700" fill="#0B2545">Amal Family Clinic</text>
          <text x="191" y="118" fontSize="26" fontWeight="500" fill="#0E7C86">Group · Three clinics, one chart</text>
        </g>
      </svg>
    </span>
  );
}
