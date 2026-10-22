import { useEffect, useReducer } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Smartphone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { previewReducer } from './phone-preview-model';
import './phone-preview.css';

/** Receives only authorized display text, never a recipient or a transport callback. */
export function PhonePreview({ text, language, trigger, onClose }: {
  text: string; language: string; trigger: HTMLButtonElement; onClose: () => void;
}) {
  const { t } = useTranslation('rem');
  const [phase, dispatch] = useReducer(previewReducer, 'ready');
  useEffect(() => {
    if (phase !== 'animating') return;
    const timer = window.setTimeout(() => dispatch('finish'), 800);
    return () => window.clearTimeout(timer);
  }, [phase]);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="rem-phone-overlay" />
        <Dialog.Content className="rem-phone-dialog" dir={language.startsWith('ar') ? 'rtl' : 'ltr'}
          data-testid="dialog-phone-preview" onCloseAutoFocus={(event) => { event.preventDefault(); if (trigger.isConnected) trigger.focus(); }}>
          <Dialog.Title>{t('phone.title')}</Dialog.Title>
          <Dialog.Description className="rem-phone-note">{t('phone.notice')}</Dialog.Description>
          <div className="rem-phone">
            <div className="rem-phone__header"><Smartphone size={20} aria-hidden="true" />{t('phone.header')}</div>
            <div className="rem-phone__screen">
              {phase === 'ready' && <p className="rem-phone-note">{t('phone.ready')}</p>}
              {phase === 'animating' && <p className="rem-phone__pending">{t('phone.animating')}</p>}
              {phase === 'simulated' && <p className="rem-phone__bubble" lang={language} data-testid="text-phone-preview">{text}</p>}
            </div>
          </div>
          <p className="rem-phone-result" role="status" aria-live="polite">{phase === 'simulated' ? t('phone.result') : t('phone.local')}</p>
          <div className="rem-phone-actions">
            <button type="button" className="bk-btn bk-btn--primary" disabled={phase !== 'ready'} onClick={() => dispatch('simulate')} data-testid="button-phone-simulate">{t('phone.send')}</button>
            <Dialog.Close asChild><button type="button" className="bk-btn">{t('phone.close')}</button></Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
