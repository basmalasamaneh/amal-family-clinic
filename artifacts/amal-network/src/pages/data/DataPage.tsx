import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { ArrowLeft, BarChart3, Ban, ClipboardList, Contact, FileText, HeartHandshake, History, KeyRound, ShieldCheck, Stethoscope, type LucideIcon } from 'lucide-react';
import { AmalLogo, Button, LanguageSwitch, ThemeSwitch, useAmalPreferences } from '@workspace/amal-ui';
import { formatNumber } from '@/shell/formatting';

const STORED: { id: string; icon: LucideIcon }[] = [
  { id: 'identity', icon: Contact }, { id: 'appointments', icon: ClipboardList }, { id: 'clinical', icon: Stethoscope },
  { id: 'consent', icon: HeartHandshake }, { id: 'account', icon: KeyRound }, { id: 'audit', icon: History },
];
const ROLES = ['reception', 'doctorBasic', 'doctorClinical', 'admin'] as const;
const COLS = ['identity', 'visits', 'clinical'] as const;
const MATRIX: Record<(typeof ROLES)[number], Record<(typeof COLS)[number], 'yes' | 'own' | 'no'>> = {
  reception: { identity: 'own', visits: 'no', clinical: 'no' },
  doctorBasic: { identity: 'yes', visits: 'yes', clinical: 'no' },
  doctorClinical: { identity: 'yes', visits: 'yes', clinical: 'yes' },
  admin: { identity: 'no', visits: 'no', clinical: 'no' },
};
const SECTIONS = ['stored', 'who', 'consent', 'audit', 'choices'] as const;

/** Public, directly addressable disclosure. Describes design intent; planned items are labelled as planned. */
export function DataPage({ signedIn, home }: { signedIn: boolean; home: string }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const num = (n: number) => formatNumber(n, locale, digitPreference);
  useEffect(() => { document.title = `${t('data.title')} · ${t('app.name')}`; document.getElementById('data-title')?.focus(); }, [t]);
  const Planned = () => <span className="data-planned">{t('data.planned')}</span>;
  return (
    <div className="data" data-testid="page-data">
      <a href="#data-main" className="shell-skip">{t('shell.skip')}</a>
      <header className="data-top">
        <Link href={home} className="data-top__brand" aria-label={signedIn ? t('data.backApp') : t('data.backLogin')} data-testid="link-data-home"><AmalLogo /></Link>
        <div className="data-top__end">
          <LanguageSwitch /><ThemeSwitch />
          <Link href={home} className="amal-btn amal-btn--secondary amal-btn--sm" data-testid="link-data-back">
            <ArrowLeft size={16} aria-hidden="true" className="data-dir" />{signedIn ? t('data.backApp') : t('data.backLogin')}
          </Link>
        </div>
      </header>
      <main id="data-main" tabIndex={-1} className="data-main">
        <section className="data-hero">
          <p className="data-hero__eyebrow">{t('data.eyebrow')}</p>
          <h1 id="data-title" tabIndex={-1} className="data-hero__title">{t('data.title')}</h1>
          <p className="data-hero__lede">{t('data.lede')}</p>
          <p className="data-hero__status" role="note" data-testid="text-data-status">{t('data.status')}</p>
        </section>

        <section className="data-promise" aria-labelledby="no-analytics" data-testid="section-no-analytics">
          <span className="data-promise__icon" aria-hidden="true"><BarChart3 size={28} /><Ban size={44} className="data-promise__ban" /></span>
          <div>
            <h2 id="no-analytics" className="data-promise__title">{t('data.noAnalytics.title')}</h2>
            <p>{t('data.noAnalytics.body')}</p>
          </div>
        </section>

        <div className="data-layout">
          <nav className="data-toc" aria-label={t('data.toc')}>
            <ol>{SECTIONS.map((s, i) => <li key={s}><a href={`#data-${s}`} className="data-toc__link"><span className="data-toc__num">{num(i + 1)}</span>{t(`data.${s}.title`)}</a></li>)}</ol>
          </nav>
          <div className="data-body">
            <section id="data-stored" className="data-sec">
              <h2 className="data-sec__title"><span className="data-sec__num">{num(1)}</span>{t('data.stored.title')}</h2>
              <p className="data-sec__intro">{t('data.stored.intro')}</p>
              <ul className="data-grid">
                {STORED.map(({ id, icon: Icon }) => (
                  <li key={id} className="data-item" data-testid={`item-stored-${id}`}>
                    <Icon size={22} aria-hidden="true" />
                    <h3>{t(`data.stored.${id}.t`)}</h3>
                    <p>{t(`data.stored.${id}.d`)}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section id="data-who" className="data-sec">
              <h2 className="data-sec__title"><span className="data-sec__num">{num(2)}</span>{t('data.who.title')}<Planned /></h2>
              <p className="data-sec__intro">{t('data.who.intro')}</p>
              <div className="data-table-wrap" tabIndex={0} role="region" aria-label={t('data.who.title')}>
                <table className="data-table" data-testid="table-visibility">
                  <thead><tr><th scope="col">{t('data.who.role')}</th>{COLS.map((c) => <th key={c} scope="col">{t(`data.who.col.${c}`)}</th>)}</tr></thead>
                  <tbody>
                    {ROLES.map((r) => (
                      <tr key={r}>
                        <th scope="row">{t(`data.who.row.${r}`)}</th>
                        {COLS.map((c) => <td key={c}><span className={`data-cell data-cell--${MATRIX[r][c]}`}>{t(`data.who.cell.${MATRIX[r][c]}`)}</span></td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="data-notes">
                <li>{t('data.who.n1')}</li><li>{t('data.who.n2')}</li><li>{t('data.who.n3')}</li>
              </ul>
            </section>

            <section id="data-consent" className="data-sec">
              <h2 className="data-sec__title"><span className="data-sec__num">{num(3)}</span>{t('data.consent.title')}<Planned /></h2>
              <ol className="data-levels">
                {(['none', 'basic', 'clinical'] as const).map((l) => (
                  <li key={l} className={`data-level data-level--${l}`}><h3>{t(`data.consent.${l}.t`)}</h3><p>{t(`data.consent.${l}.d`)}</p></li>
                ))}
              </ol>
              <ul className="data-notes">
                <li><strong>{t('data.consent.before.t')}</strong> {t('data.consent.before.d')}</li>
                <li><strong>{t('data.consent.guardian.t')}</strong> {t('data.consent.guardian.d')}</li>
                <li><strong>{t('data.consent.lite.t')}</strong> {t('data.consent.lite.d')}</li>
              </ul>
            </section>

            <section id="data-audit" className="data-sec">
              <h2 className="data-sec__title"><span className="data-sec__num">{num(4)}</span>{t('data.audit.title')}<Planned /></h2>
              <p className="data-sec__intro">{t('data.audit.body')}</p>
            </section>

            <section id="data-choices" className="data-sec">
              <h2 className="data-sec__title"><span className="data-sec__num">{num(5)}</span>{t('data.choices.title')}</h2>
              <div className="data-choices">
                {(['withdraw', 'export'] as const).map((c) => (
                  <article key={c} className="data-choice" data-testid={`card-choice-${c}`}>
                    <h3>{t(`data.choices.${c}.t`)}</h3>
                    <p>{t(`data.choices.${c}.d`)}</p>
                    <Button variant="secondary" disabled aria-describedby={`choice-${c}-na`} data-testid={`button-${c}-unavailable`}>{t(`data.choices.${c}.btn`)}</Button>
                    <p id={`choice-${c}-na`} className="data-choice__na">{t('data.choices.unavailable')}</p>
                  </article>
                ))}
              </div>
              <div className="data-howto">
                <FileText size={22} aria-hidden="true" />
                <div><h3>{t('data.choices.how.t')}</h3><p>{t('data.choices.how.d')}</p></div>
              </div>
              <ul className="data-notes">
                <li><strong>{t('data.choices.vsDelete.t')}</strong> {t('data.choices.vsDelete.d')}</li>
                <li><strong>{t('data.choices.effect.t')}</strong> {t('data.choices.effect.d')}</li>
              </ul>
            </section>
            <p className="data-foot"><ShieldCheck size={18} aria-hidden="true" />{t('data.foot')}</p>
          </div>
        </div>
      </main>
    </div>
  );
}
