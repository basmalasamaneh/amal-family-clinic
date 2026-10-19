import { useTranslation } from 'react-i18next';
import { Section } from './Section';

const SCALE = [38, 30, 24, 20, 18, 16, 14, 12];

export function TypeSection({ index }: { index: number }) {
  const { t } = useTranslation();
  return (
    <Section id="type" index={index} intro={t('kit.type.intro')}>
      <ol className="kit-scale">
        {SCALE.map((px) => (
          <li key={px} className="kit-scale__row">
            <span className="kit-scale__px" dir="ltr">{px}px</span>
            <span style={{ fontSize: px }} className="kit-scale__sample">
              <span lang="ar">{t('kit.type.sampleAr')}</span>
              <span className="kit-scale__sep" aria-hidden="true">·</span>
              <span lang="en">{t('kit.type.sampleEn')}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="kit-type-pair">
        <figure className="kit-type-card">
          <figcaption className="kit-type-card__cap">{t('kit.type.body')}</figcaption>
          <p className="kit-type-card__text">{t('kit.type.bodySample')}</p>
        </figure>
        <figure className="kit-type-card amal-reception" data-testid="sample-reception">
          <figcaption className="kit-type-card__cap">{t('kit.type.reception')}</figcaption>
          <p className="kit-type-card__text">{t('kit.type.receptionSample')}</p>
        </figure>
      </div>
    </Section>
  );
}
