import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'wouter';
import { X } from 'lucide-react';
import { Button } from '@workspace/amal-ui';
import { WalkInHandoff } from '@/reception/WalkInHandoff';
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
  const [cardSize, setCardSize] = useState({ width: 360, height: 300 });
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

  useLayoutEffect(() => {
    const el = step ? findTarget(step.targets) : null;
    if (el) {
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth)
        el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }
    measure();
  }, [measure, location]);
  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => {
      setCardSize({ width: card.offsetWidth, height: card.offsetHeight });
      measure();
    });
    observer.observe(card);
    const target = step ? findTarget(step.targets) : null;
    if (target) observer.observe(target);
    return () => observer.disconnect();
  }, [measure, step]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [measure]);
  useEffect(() => { headRef.current?.focus({ preventScroll: true }); }, [index]);

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
  const cardW = Math.min(cardSize.width, vw - 24);
  const cardH = Math.min(cardSize.height, vh - 24);
  let style: CSSProperties | undefined;
  if (box) {
    const clampStart = (s: number) => Math.max(12, Math.min(s, vw - cardW - 12));
    const clampTop = (y: number) => Math.max(12, Math.min(y, vh - cardH - 12));
    const after = box.start + box.inline + 16;
    const before = box.start - cardW - 16;
    const below = box.top + box.block + 12;
    const above = box.top - cardH - 12;
    // Logical inline coordinates keep the same placement rules in RTL and LTR.
    if (box.block > vh * 0.5 && after + cardW <= vw - 12)
      style = { insetBlockStart: clampTop(box.top + 24), insetInlineStart: after };
    else if (below + cardH <= vh - 12)
      style = { insetBlockStart: clampTop(below), insetInlineStart: clampStart(box.start) };
    else if (above >= 12)
      style = { insetBlockStart: above, insetInlineStart: clampStart(box.start) };
    else if (before >= 12)
      style = { insetBlockStart: clampTop(box.top), insetInlineStart: before };
    else
      style = { insetBlockStart: clampTop(below), insetInlineStart: clampStart(box.start) };
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
          <WalkInHandoff className="amal-btn amal-btn--secondary amal-btn--sm" before={() => finish('dismissed')} testId="button-tour-walkin" />
          <Button variant="ghost" size="sm" onClick={() => finish('dismissed')} data-testid="button-tour-skip">{t('tour.skip')}</Button>
          <span className="tour-card__spacer" />
          {index > 0 && <Button variant="secondary" size="sm" onClick={() => setIndex(index - 1)} data-testid="button-tour-back">{t('tour.back')}</Button>}
          <Button size="sm" onClick={() => (last ? finish('completed') : setIndex(index + 1))} data-testid="button-tour-next">{last ? t('tour.done') : t('tour.next')}</Button>
        </div>
      </div>
    </>
  );
}
