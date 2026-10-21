import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { i18n } from '@/i18n';
import './messages';
import './pwa.css';

/** Mount once in the application root. No installation prompting or forced activation. */
export function PwaNotice() {
  const { t } = useTranslation('pwa', { i18n });
  const [notice, setNotice] = useState<'update' | 'error' | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const updateManifest = () => {
      const locale = i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'ar';
      document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
        ?.setAttribute('href', `${import.meta.env.BASE_URL}manifest-${locale}.webmanifest`);
    };
    updateManifest();
    i18n.on('languageChanged', updateManifest);
    return () => { i18n.off('languageChanged', updateManifest); };
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let disposed = false;
    let cleanup = () => {};
    const show = (value: 'update' | 'error') => { if (!disposed) setNotice(value); };
    void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, {
      scope: import.meta.env.BASE_URL,
      updateViaCache: 'none',
    }).then((registration) => {
      if (disposed) return;
      if (registration.waiting) show('update');
      const listeners: Array<() => void> = [];
      const watch = () => {
        const worker = registration.installing;
        if (!worker) return;
        const changed = () => {
          if (worker.state === 'installed' && registration.active && registration.waiting) show('update');
          if (worker.state === 'redundant') show('error');
        };
        worker.addEventListener('statechange', changed);
        listeners.push(() => worker.removeEventListener('statechange', changed));
      };
      registration.addEventListener('updatefound', watch);
      watch();
      cleanup = () => {
        registration.removeEventListener('updatefound', watch);
        listeners.forEach((remove) => remove());
      };
    }).catch(() => show('error'));
    return () => { disposed = true; cleanup(); };
  }, [attempt]);

  if (!notice) return null;
  return (
    <aside className="pwa-notice" data-testid="pwa-notice" aria-labelledby="pwa-notice-message">
      <p id="pwa-notice-message" role="status" aria-live="polite" aria-atomic="true">{t(notice)}</p>
      <div className="pwa-notice__actions">
        {notice === 'error' && (
          <button type="button" onClick={() => { setNotice(null); setAttempt((n) => n + 1); }}>{t('retry')}</button>
        )}
        <button type="button" onClick={() => setNotice(null)}>{t('dismiss')}</button>
      </div>
    </aside>
  );
}
