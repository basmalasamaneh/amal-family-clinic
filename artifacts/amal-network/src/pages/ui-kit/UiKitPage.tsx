import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { AmalMark } from '@workspace/amal-ui';
import { KitHeader } from './KitHeader';
import { SECTION_IDS } from './Section';
import { PaletteSection } from './PaletteSection';
import { TypeSection } from './TypeSection';
import { ButtonsSection } from './ButtonsSection';
import { InputsSection } from './InputsSection';
import { StatusSection } from './StatusSection';
import { CardsSection } from './CardsSection';
import { ToastsSection } from './ToastsSection';
import { EmptySection } from './EmptySection';
import { Section } from './Section';
import { CombinationMatrix, ComponentsGallery } from './ComponentsGallery';

export default function UiKitPage() {
  const { t } = useTranslation();
  return (
    <div className="kit">
      <a href="#main" className="kit-skip">{t('app.skip')}</a>
      <KitHeader />
      <div className="kit-layout">
        <nav className="kit-toc" aria-label={t('kit.toc')}>
          <p className="kit-toc__title">{t('kit.toc')}</p>
          <ol>
            {SECTION_IDS.map((id, i) => (
              <li key={id}>
                <a href={`#${id}`} className="kit-toc__link" data-testid={`link-toc-${id}`}>
                  <span className="kit-toc__num" aria-hidden="true">{String(i + 1).padStart(2, '0')}</span>
                  {t(`kit.sections.${id}`)}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <main id="main" tabIndex={-1} className="kit-main">
          <div className="kit-hero">
            <p className="kit-hero__eyebrow">{t('kit.eyebrow')}</p>
            <h1 className="kit-hero__title" data-testid="text-page-title">{t('kit.title')}</h1>
            <p className="kit-hero__lede">{t('kit.lede')}</p>
            <p className="kit-hero__notice" data-testid="text-demo-notice">
              <ShieldCheck size={20} aria-hidden="true" />
              {t('kit.demoNotice')}
            </p>
          </div>
          <PaletteSection index={0} />
          <TypeSection index={1} />
          <ButtonsSection index={2} />
          <InputsSection index={3} />
          <StatusSection index={4} />
          <CardsSection index={5} />
          <ToastsSection index={6} />
          <EmptySection index={7} />
          <Section id="components" index={8} intro={t('kit.g.intro')}><ComponentsGallery /></Section>
          <Section id="matrix" index={9} intro={t('kit.g.matrixIntro')}><CombinationMatrix /></Section>
          <footer className="kit-footer">
            <AmalMark size={32} />
            <span>{t('kit.footer')}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
