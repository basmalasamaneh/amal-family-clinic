import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { X } from 'lucide-react';
import { Button } from '@workspace/amal-ui';
import type { TourStep } from './tours';

interface Box { top: number; start: number; inline: number; block: number }

function findTarget(targets: string[]): HTMLElement | null {
  for (const t of targets) {
    const el = document.querySelector<HTMLElement>(`[data-tour="${t}"]`);
    if (el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/** Non-modal, keyboard accessible coach mark. Missing/hidden targets fall back to a centered step. */
export function TourOverlay({ steps, onFinish }: { steps: TourStep[]; onFinish: (status: 'completed' | 'dismissed') => void }) {
  const { t, i18n } = useTranslation();
  const [location] = useLocation();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLHeadingElement>(null);
  const restoreRef = useRef<Element | null>(typeof document !== 'undefined' ? document.activeElement : null);
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  const rtl = i18n.dir() === 'rtl';

  const measure = useCallback(() => {
    const el = step ? findTarget(step.targets) : null;
    if (!el) { setBox(null); return; }
    const r = el.getBoundingClientRect();
    setBox({ top: r.top, start: rtl ? window.innerWidth - r.right : r.left, inline: r.width, block: r.height });
  }, [step, rtl]);

  useLayoutEffect(measure, [measure, location]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [measure]);
  useEffect(() => { headRef.current?.focus(); }, [index]);

  const finish = useCallback((status: 'completed' | 'dismissed') => {
    onFinish(status);
    const prev = restoreRef.current;
    queueMicrotask(() => {
      if (prev instanceof HTMLElement && prev.isConnected && prev !== document.body) prev.focus();
      else document.getElementById('main')?.focus();
    });
  }, [onFinish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      // Nested dialogs/menus own Escape; otherwise dismiss wherever focus is (coach mark is non-modal).
      const owner = Array.from(document.querySelectorAll('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]'))
        .some((el) => !cardRef.current?.contains(el) && el !== cardRef.current && el.getClientRects().length > 0);
      if (owner) return;
      e.preventDefault();
      finish('dismissed');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [finish]);

  if (!step) return null;

  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;
  const cardW = Math.min(360, vw - 24);
  let style: CSSProperties | undefined;
  if (box) {
    const clampStart = (s: number) => Math.max(12, Math.min(s, vw - cardW - 12));
    if (box.block > vh * 0.5 && box.start + box.inline + cardW + 28 < vw) {
      style = { insetBlockStart: 96, insetInlineStart: box.start + box.inline + 16 };
    } else if (box.top + box.block + 220 < vh) {
      style = { insetBlockStart: box.top + box.block + 12, insetInlineStart: clampStart(box.start) };
    } else {
      style = { insetBlockEnd: vh - box.top + 12, insetInlineStart: clampStart(box.start) };
    }
  }

  return (
    <>
      {box && <div className="tour-ring" aria-hidden="true" style={{ insetBlockStart: box.top - 4, insetInlineStart: box.start - 4, inlineSize: box.inline + 8, blockSize: box.block + 8 }} />}
      <div
        ref={cardRef}
        role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body"
        className={`tour-card${box ? '' : ' tour-card--free'}`} style={style} data-testid="tour-dialog" data-step={step.id}
      >
        <div className="tour-card__head">
          <p className="tour-card__count" data-testid="text-tour-step">{t('tour.step', { n: index + 1, total: steps.length })}</p>
          <button type="button" className="amal-btn amal-btn--icon amal-btn--ghost tour-card__x" aria-label={t('tour.dismiss')} onClick={() => finish('dismissed')} data-testid="button-tour-close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <h2 id="tour-title" ref={headRef} tabIndex={-1} className="tour-card__title">{t(step.titleKey)}</h2>
        <p id="tour-body" className="tour-card__body">{t(step.bodyKey)}</p>
        <ol className="tour-card__dots" aria-hidden="true">{steps.map((s, i) => <li key={s.id} className={i === index ? 'is-on' : ''} />)}</ol>
        <div className="tour-card__foot">
          <Button variant="ghost" size="sm" onClick={() => finish('dismissed')} data-testid="button-tour-skip">{t('tour.skip')}</Button>
          <span className="tour-card__spacer" />
          {index > 0 && <Button variant="secondary" size="sm" onClick={() => setIndex(index - 1)} data-testid="button-tour-back">{t('tour.back')}</Button>}
          <Button size="sm" onClick={() => (last ? finish('completed') : setIndex(index + 1))} data-testid="button-tour-next">{last ? t('tour.done') : t('tour.next')}</Button>
        </div>
      </div>
    </>
  );
}
