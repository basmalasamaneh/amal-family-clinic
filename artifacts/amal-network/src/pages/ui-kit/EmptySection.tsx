import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, X } from 'lucide-react';
import { Button, Card, CardBody, CardFooter, CardHeader, EmptyState, useToast } from '@workspace/amal-ui';
import { Section } from './Section';

export function EmptySection({ index }: { index: number }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [items, setItems] = useState<number[]>([]);
  const [next, setNext] = useState(1);
  const add = () => { setItems((xs) => [...xs, next]); setNext((n) => n + 1); };
  return (
    <Section id="empty" index={index} intro={t('kit.empty.intro')}>
      <Card as="div" data-testid="card-empty-demo">
        {items.length === 0 ? (
          <EmptyState
            title={t('kit.empty.title')}
            description={t('kit.empty.desc')}
            actions={
              <>
                <Button startIcon={<Plus size={18} aria-hidden="true" />} onClick={add} data-testid="button-empty-add">{t('kit.empty.add')}</Button>
                <Button variant="ghost" onClick={() => toast.show({ title: t('kit.empty.tipT'), description: t('kit.empty.tipD') })} data-testid="button-empty-tip">{t('kit.empty.learn')}</Button>
              </>
            }
          />
        ) : (
          <>
            <CardHeader title={t('kit.empty.listTitle')} />
            <CardBody>
              <ul className="kit-rows kit-plain">
                {items.map((n) => {
                  const name = t('kit.empty.item', { n });
                  return (
                    <li key={n} className="kit-rowitem" data-testid={`row-item-${n}`}>
                      <span className="kit-rowitem__label">{name}</span>
                      <Button iconOnly variant="ghost" aria-label={t('kit.empty.remove', { name })} onClick={() => setItems((xs) => xs.filter((x) => x !== n))} data-testid={`button-remove-${n}`}>
                        <X size={18} aria-hidden="true" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CardBody>
            <CardFooter>
              <Button variant="secondary" startIcon={<Plus size={18} aria-hidden="true" />} onClick={add} data-testid="button-list-add">{t('kit.empty.add')}</Button>
              <Button variant="ghost" onClick={() => { setItems([]); toast.show({ title: t('kit.empty.cleared') }); }} data-testid="button-list-clear">{t('kit.empty.clear')}</Button>
            </CardFooter>
          </>
        )}
      </Card>
    </Section>
  );
}
