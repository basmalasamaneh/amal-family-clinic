import { useTranslation } from 'react-i18next';
import { Bell } from 'lucide-react';
import { Button, Card, CardBody, CardFooter, CardHeader, useToast } from '@workspace/amal-ui';
import { Section } from './Section';

export function CardsSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  return (
    <Section id="cards" index={index} intro={t('kit.cards.intro')}>
      <div className="kit-cards">
        <Card className="kit-cards__a" data-testid="card-glance">
          <CardHeader title={t('kit.cards.a.title')} description={t('kit.cards.a.desc')} />
          <CardBody>
            <p className="kit-stat"><span className="kit-stat__num">{t('kit.cards.a.stat')}</span> <span className="kit-stat__label">{t('kit.cards.a.statLabel')}</span></p>
          </CardBody>
          <CardFooter>
            <Button variant="secondary" startIcon={<Bell size={18} aria-hidden="true" />} onClick={() => toast.show({ title: t('kit.toasts.infoT'), description: t('kit.toasts.infoD') })} data-testid="button-card-toast">{t('kit.cards.a.action')}</Button>
          </CardFooter>
        </Card>
        <Card tone="muted" data-testid="card-note">
          <CardHeader title={t('kit.cards.b.title')} description={t('kit.cards.b.desc')} />
          <CardBody><p className="kit-p">{t('kit.cards.b.body')}</p></CardBody>
        </Card>
        <Card data-testid="card-radii">
          <CardHeader title={t('kit.cards.c.title')} />
          <CardBody className="kit-radii">
            <span className="kit-radii__box" style={{ borderRadius: 'var(--amal-radius-control)' }}>{t('kit.cards.c.control')}</span>
            <span className="kit-radii__box" style={{ borderRadius: 'var(--amal-radius-card)' }}>{t('kit.cards.c.card')}</span>
            <span className="kit-radii__box" style={{ borderRadius: 'var(--amal-radius-dialog)' }}>{t('kit.cards.c.dialog')}</span>
          </CardBody>
        </Card>
      </div>
    </Section>
  );
}
