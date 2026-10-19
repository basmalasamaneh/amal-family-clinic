import { useTranslation } from 'react-i18next';
import { Button, useToast, type ToastTone } from '@workspace/amal-ui';
import { Section } from './Section';

const TONES: ToastTone[] = ['info', 'success', 'warning', 'danger'];

export function ToastsSection({ index }: { index: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const fire = (tone: ToastTone) =>
    toast.show({
      tone,
      title: t(`kit.toasts.${tone}T`),
      description: t(`kit.toasts.${tone}D`),
      duration: tone === 'danger' ? 0 : 6000,
      action: tone === 'danger' ? { label: t('kit.toasts.retry'), onClick: () => toast.show({ tone: 'success', title: t('kit.toasts.retried') }) } : undefined,
    });
  return (
    <Section id="toasts" index={index} intro={t('kit.toasts.intro')}>
      <div className="kit-row">
        {TONES.map((tone) => (
          <Button key={tone} variant={tone === 'danger' ? 'danger' : 'secondary'} onClick={() => fire(tone)} data-testid={`button-toast-${tone}`}>
            {t(`kit.toasts.${tone}`)}
          </Button>
        ))}
      </div>
    </Section>
  );
}
