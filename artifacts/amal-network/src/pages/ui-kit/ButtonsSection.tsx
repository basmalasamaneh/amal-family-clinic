import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button, useToast } from '@workspace/amal-ui';
import { Section } from './Section';

export function ButtonsSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const runDemo = () => {
    setLoading(true);
    timer.current = window.setTimeout(() => {
      setLoading(false);
      toast.show({ tone: 'success', title: t('kit.buttons.loadingDone') });
    }, 2000);
  };
  return (
    <Section id="buttons" index={index} intro={t('kit.buttons.intro')}>
      <div className="kit-row">
        <Button data-testid="button-demo-primary" endIcon={<ArrowLeft size={18} className="kit-dir-arrow" aria-hidden="true" />}>{t('kit.buttons.primary')}</Button>
        <Button variant="secondary" data-testid="button-demo-secondary">{t('kit.buttons.secondary')}</Button>
        <Button variant="ghost" data-testid="button-demo-ghost">{t('kit.buttons.ghost')}</Button>
        <Button variant="danger" startIcon={<Trash2 size={18} aria-hidden="true" />} data-testid="button-demo-danger">{t('kit.buttons.danger')}</Button>
        <Button disabled data-testid="button-demo-disabled">{t('kit.buttons.disabled')}</Button>
      </div>
      <div className="kit-row">
        <Button size="sm" variant="secondary" data-testid="button-demo-small">{t('kit.buttons.small')}</Button>
        <Button size="lg" data-testid="button-demo-large">{t('kit.buttons.large')}</Button>
        <Button iconOnly variant="secondary" aria-label={t('kit.buttons.iconAdd')} data-testid="button-demo-icon"><Plus size={20} aria-hidden="true" /></Button>
        <Button loading={loading} onClick={runDemo} data-testid="button-demo-loading">{t('kit.buttons.loadingDemo')}</Button>
      </div>
    </Section>
  );
}
