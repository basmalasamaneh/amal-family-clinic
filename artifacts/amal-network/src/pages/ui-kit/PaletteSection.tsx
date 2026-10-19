import { useTranslation } from 'react-i18next';
import { APPOINTMENT_STATUSES, useAmalPreferences } from '@workspace/amal-ui';
import tokens from '@workspace/amal-ui/tokens.json';
import { Section } from './Section';
import { contrast } from './contrast';

type ColorMap = Record<string, { $value: string }>;

export function PaletteSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const { theme } = useAmalPreferences();
  const mode = tokens.color[theme];
  const raw = mode.raw as ColorMap;
  const sem = mode.semantic as ColorMap;
  const themeName = t(`amalUi:theme.${theme}`);
  return (
    <Section id="palette" index={index} intro={t('kit.palette.intro')}>
      <h3 className="kit-sub">{t('kit.palette.raw', { theme: themeName })}</h3>
      <ul className="kit-swatches" data-testid="list-swatches">
        {Object.entries(raw).map(([name, v]) => (
          <li key={name} className="kit-swatch" data-testid={`swatch-${name}`}>
            <span className="kit-swatch__chip" style={{ background: v.$value }} aria-hidden="true" />
            <span className="kit-swatch__name" dir="ltr">--amal-{name}</span>
            <span className="kit-swatch__hex" dir="ltr">{v.$value}</span>
          </li>
        ))}
        <li className="kit-swatch kit-swatch--gold" data-testid="swatch-gold">
          <span className="kit-swatch__chip" style={{ background: 'var(--amal-surface-2)' }} aria-hidden="true" />
          <span className="kit-swatch__name" dir="ltr">--amal-gold</span>
          <span className="kit-swatch__hex" dir="ltr">{tokens.color.brand.gold.$value}</span>
        </li>
      </ul>
      <p className="kit-note">{t('kit.palette.goldNote')}</p>

      <h3 className="kit-sub">{t('kit.palette.semantic')}</h3>
      <ul className="kit-pairs">
        {APPOINTMENT_STATUSES.map((s) => {
          const fg = sem[`status-${s}-fg`].$value;
          const bg = sem[`status-${s}-bg`].$value;
          return (
            <li key={s} className="kit-pair" style={{ background: bg, color: fg, borderColor: sem[`status-${s}-border`].$value }}>
              <span className="kit-pair__sample">{t(`amalUi:status.${s}`)}</span>
              <span dir="ltr" className="kit-pair__meta">{fg} / {bg} · {contrast(fg, bg).toFixed(2)}:1</span>
            </li>
          );
        })}
        {(['on-primary:primary', 'on-danger:danger', 'disabled-fg:disabled-bg', 'toast-fg:toast-bg'] as const).map((p) => {
          const [f, b] = p.split(':');
          const fg = sem[f].$value;
          const bg = (sem[b] ?? raw[b]).$value;
          return (
            <li key={p} className="kit-pair" style={{ background: bg, color: fg, borderColor: bg }}>
              <span className="kit-pair__sample" dir="ltr">{f}</span>
              <span dir="ltr" className="kit-pair__meta">{fg} / {bg} · {contrast(fg, bg).toFixed(2)}:1</span>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
