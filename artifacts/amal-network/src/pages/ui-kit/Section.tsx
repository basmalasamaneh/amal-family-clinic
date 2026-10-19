import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const SECTION_IDS = ['palette', 'type', 'buttons', 'inputs', 'status', 'cards', 'toasts', 'empty'] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export function Section({ id, index, intro, children }: { id: SectionId; index: number; intro: string; children: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section id={id} className="kit-section" aria-labelledby={`${id}-title`} data-testid={`section-${id}`}>
      <header className="kit-section__head">
        <span className="kit-section__num" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <h2 id={`${id}-title`} className="kit-section__title">{t(`kit.sections.${id}`)}</h2>
          <p className="kit-section__intro">{intro}</p>
        </div>
      </header>
      {children}
    </section>
  );
}
