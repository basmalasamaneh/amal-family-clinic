import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { EmptyState } from '@workspace/amal-ui';

export default function NotFound() {
  const { t } = useTranslation();
  return (
    <main className="kit-notfound">
      <EmptyState
        headingLevel={1}
        title={t('notFound.title')}
        description={t('notFound.desc')}
        actions={<Link href="/ui-kit" className="amal-btn amal-btn--primary" data-testid="link-ui-kit">{t('notFound.back')}</Link>}
      />
    </main>
  );
}
