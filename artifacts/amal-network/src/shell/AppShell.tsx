import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Redirect, useLocation } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { CircleUserRound, FlaskConical, LogOut, MoreHorizontal, RotateCw, Search, WifiOff, X } from 'lucide-react';
import { AmalLogo, AmalMark, Button, EmptyState, LanguageSwitch, Segmented, ThemeSwitch, useAmalPreferences } from '@workspace/amal-ui';
import { formatInstant, formatNumber } from './formatting';
import { demoPath, type ShellClinic, type ShellIdentity } from './identity';
import { isKnownRole, landingFor, resolve, routesFor, type Resolution, type ShellRoute } from './routes';

const BOTTOM_SLOTS = 4;

interface Props { identity: ShellIdentity; fixture: boolean; onRefresh: () => Promise<void>; onLogout: () => Promise<void> }

export function AppShell({ identity, fixture, onRefresh, onLogout }: Props) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const role = isKnownRole(identity.role) ? identity.role : null;
  const items = useMemo(() => routesFor(role), [role]);
  const res = resolve(location, role);

  const clinics = identity.clinics;
  const [clinicId, setClinicId] = useState<number | null>(clinics[0]?.id ?? null);
  useEffect(() => {
    if (clinicId === null || !clinics.some((c) => c.id === clinicId)) setClinicId(clinics[0]?.id ?? null);
  }, [clinics, clinicId]);
  const clinic = clinics.find((c) => c.id === clinicId) ?? null;

  const title = titleFor(res, t);
  const [announce, setAnnounce] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (res.kind === 'landing') return;
    document.title = `${title} · ${t('app.name')}`;
    setAnnounce(t('shell.page.announce', { title }));
    if (first.current) { first.current = false; return; }
    document.getElementById('page-title')?.focus();
  }, [location, title, res.kind, t]);

  if (res.kind === 'landing') return <Redirect to={demoPath(res.to)} replace />;

  return (
    <div className="shell" data-testid="app-shell" data-role={identity.role ?? 'none'}>
      <a href="#main" className="shell-skip" data-testid="link-skip">{t('shell.skip')}</a>
      <div className="shell-sr" role="status" aria-live="polite" data-testid="status-route-announce">{announce}</div>

      <aside className="shell-side" data-testid="nav-sidebar">
        <Link href={demoPath('/')} className="shell-side__brand" aria-label={t('shell.brand')} data-testid="link-brand">
          <AmalMark size={36} />
          <span aria-hidden="true">{t('app.name')}</span>
        </Link>
        <nav aria-label={t('shell.nav.label')}>
          <ul className="shell-side__list">
            {items.map((r) => <li key={r.id}><NavLink route={r} location={location} variant="side" /></li>)}
          </ul>
        </nav>
        <Link href="/ui-kit" className="shell-side__kit" data-testid="link-ui-kit">{t('shell.nav.uiKit')}</Link>
      </aside>

      <div className="shell-body">
        {fixture && (
          <section className="shell-fixture" aria-label={t('shell.fixtureBanner')} data-testid="banner-fixture">
            <FlaskConical size={16} aria-hidden="true" />{t('shell.fixtureBanner')}
          </section>
        )}
        <header className="shell-top">
          <div className="shell-top__brand"><AmalLogo /></div>
          <ClinicSwitcher clinics={clinics} state={identity.clinicsState} value={clinicId} onChange={setClinicId} onRetry={onRefresh} />
          <GlobalSearch key={clinicId ?? 'none'} />
          <div className="shell-top__end">
            <ConnectionPill />
            <div className="shell-top__prefs"><LanguageSwitch /><ThemeSwitch /></div>
            <UserMenu identity={identity} fixture={fixture} onLogout={onLogout} />
          </div>
        </header>

        <main id="main" tabIndex={-1} className="shell-main" key={clinicId ?? 'none'}>
          <PageContent res={res} title={title} clinic={clinic} landing={landingFor(role)} />
        </main>
      </div>

      {items.length > 0 && <BottomNav items={items} location={location} />}
    </div>
  );
}

function titleFor(res: Resolution, t: (k: string) => string): string {
  switch (res.kind) {
    case 'page': return t(`shell.nav.${res.route.id}`);
    case 'forbidden': return t('shell.states.forbidden.title');
    case 'noRole': return t('shell.states.noRole.title');
    case 'notFound': return t('shell.states.notFound.title');
    default: return '';
  }
}

function NavLink({ route, location, variant }: { route: ShellRoute; location: string; variant: 'side' | 'bottom' }) {
  const { t } = useTranslation();
  const Icon = route.icon;
  const active = location === route.path;
  return (
    <Link
      href={demoPath(route.path)}
      className={`shell-nav shell-nav--${variant}${active ? ' is-active' : ''}`}
      aria-current={active ? 'page' : undefined}
      data-testid={`link-nav-${variant}-${route.id}`}
    >
      <Icon size={20} aria-hidden="true" />
      <span className="shell-nav__label">{t(`shell.nav.${route.id}`)}</span>
    </Link>
  );
}

function BottomNav({ items, location }: { items: ShellRoute[]; location: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const needsMore = items.length > BOTTOM_SLOTS + 1;
  const visible = needsMore ? items.slice(0, BOTTOM_SLOTS) : items;
  const overflow = needsMore ? items.slice(BOTTOM_SLOTS) : [];
  const overflowActive = overflow.some((r) => r.path === location);
  return (
    <nav className="shell-bottom" aria-label={t('shell.nav.label')} data-testid="nav-bottom">
      <ul>
        {visible.map((r) => <li key={r.id}><NavLink route={r} location={location} variant="bottom" /></li>)}
        {needsMore && (
          <li>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger className={`shell-nav shell-nav--bottom${overflowActive ? ' is-active' : ''}`} aria-label={t('shell.nav.moreLabel')} data-testid="button-nav-more">
                <MoreHorizontal size={20} aria-hidden="true" />
                <span className="shell-nav__label" aria-hidden="true">{t('shell.nav.more')}</span>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content className="shell-menu" side="top" align="end" sideOffset={8} collisionPadding={8}>
                  {overflow.map((r) => {
                    const Icon = r.icon;
                    return (
                      <DropdownMenu.Item
                        key={r.id}
                        className={`shell-menu__item${r.path === location ? ' is-active' : ''}`}
                        onSelect={() => navigate(demoPath(r.path))}
                        data-testid={`menuitem-more-${r.id}`}
                      >
                        <Icon size={18} aria-hidden="true" />{t(`shell.nav.${r.id}`)}
                      </DropdownMenu.Item>
                    );
                  })}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </li>
        )}
      </ul>
    </nav>
  );
}

function ClinicSwitcher({ clinics, state, value, onChange, onRetry }: {
  clinics: ShellClinic[]; state?: 'ready' | 'error'; value: number | null; onChange: (id: number) => void; onRetry: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [retrying, setRetrying] = useState(false);
  if (state === 'error') {
    return (
      <div className="shell-clinic shell-clinic--msg" role="alert" data-testid="status-clinic-error">
        <span>{t('shell.clinic.error')}</span>
        <button
          type="button" className="amal-btn amal-btn--secondary amal-btn--sm" disabled={retrying} data-testid="button-clinic-retry"
          onClick={async () => { setRetrying(true); try { await onRetry(); } finally { setRetrying(false); } }}
        >
          <RotateCw size={16} aria-hidden="true" />{retrying ? t('shell.clinic.loading') : t('shell.clinic.retry')}
        </button>
      </div>
    );
  }
  if (clinics.length === 0) return <p className="shell-clinic shell-clinic--msg" data-testid="status-clinic-none">{t('shell.clinic.none')}</p>;
  if (clinics.length === 1) {
    return (
      <p className="shell-clinic" data-testid="text-clinic-single">
        <span className="shell-clinic__label">{t('shell.clinic.single')}</span>
        <bdi className="shell-clinic__name">{clinics[0].name}</bdi>
      </p>
    );
  }
  return (
    <label className="shell-clinic">
      <span className="shell-clinic__label">{t('shell.clinic.label')}</span>
      <select className="shell-clinic__select" value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))} data-testid="select-clinic">
        {clinics.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
    </label>
  );
}

function GlobalSearch() {
  const { t } = useTranslation();
  const [q, setQ] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const submit = (e: FormEvent) => { e.preventDefault(); setMsg(q.trim() ? t('shell.search.result') : t('shell.search.empty')); };
  return (
    <form role="search" className="shell-search" onSubmit={submit} aria-label={t('shell.search.label')}>
      <label className="shell-search__field">
        <span className="shell-sr">{t('shell.search.label')}</span>
        <Search size={18} aria-hidden="true" />
        <input
          type="search" value={q} onChange={(e) => { setQ(e.target.value); setMsg(null); }}
          placeholder={t('shell.search.placeholder')} dir="auto" data-testid="input-global-search"
        />
      </label>
      <button type="submit" className="amal-btn amal-btn--secondary amal-btn--sm" data-testid="button-global-search">{t('shell.search.submit')}</button>
      <p className="shell-search__msg" role="status" aria-live="polite" data-testid="status-search">{msg}</p>
    </form>
  );
}

function ConnectionPill() {
  const { t } = useTranslation();
  return (
    <span className="shell-pill" role="note" aria-label={`${t('shell.connection.label')}. ${t('shell.connection.tooltip')}`} title={t('shell.connection.tooltip')} data-testid="status-connection">
      <WifiOff size={16} aria-hidden="true" />
      <span aria-hidden="true">{t('shell.connection.text')}</span>
    </span>
  );
}

function UserMenu({ identity, fixture, onLogout }: { identity: ShellIdentity; fixture: boolean; onLogout: () => Promise<void> }) {
  const { t } = useTranslation();
  const { locale, digitPreference, setDigitPreference } = useAmalPreferences();
  const [logoutState, setLogoutState] = useState<'idle' | 'pending' | 'error'>('idle');
  const doLogout = async () => {
    setLogoutState('pending');
    try { await onLogout(); } catch { setLogoutState('error'); }
  };
  const roleLabel = t(`shell.roles.${isKnownRole(identity.role) ? identity.role : 'none'}`);
  return (
    <Dialog.Root>
      <Dialog.Trigger className="shell-user" aria-label={t('shell.user.open', { name: identity.name })} data-testid="button-user-menu">
        <span className="shell-user__avatar" aria-hidden="true"><CircleUserRound size={22} /></span>
        <span className="shell-user__name" aria-hidden="true"><bdi>{identity.name}</bdi></span>
        <CircleUserRound size={18} aria-hidden="true" className="shell-user__icon" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-overlay" />
        <Dialog.Content className="shell-dialog" data-testid="dialog-user" aria-describedby={undefined}>
          <div className="shell-dialog__head">
            <Dialog.Title className="shell-dialog__title">{t('shell.user.title')}</Dialog.Title>
            <Dialog.Close className="amal-btn amal-btn--icon shell-dialog__x" aria-label={t('shell.user.close')} data-testid="button-user-close">
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <dl className="shell-dl">
            <dt>{t('shell.user.identity')}</dt><dd data-testid="text-user-name"><bdi>{identity.name}</bdi></dd>
            <dt>{t('shell.user.role')}</dt><dd data-testid="text-user-role">{roleLabel}</dd>
            <dt>{t('shell.user.clinics')}</dt>
            <dd data-testid="text-user-clinics">{identity.clinics.length ? identity.clinics.map((c) => <bdi key={c.id} className="shell-chip">{c.name}</bdi>) : t('shell.user.noClinics')}</dd>
          </dl>
          <section className="shell-dialog__section" aria-labelledby="display-h">
            <h3 id="display-h" className="shell-dialog__h">{t('shell.user.display')}</h3>
            <div className="shell-dialog__controls">
              <LanguageSwitch />
              <ThemeSwitch />
              <Segmented
                label={t('shell.user.digits')}
                value={digitPreference}
                onChange={(v: 'latn' | 'arab') => setDigitPreference(v)}
                options={[
                  { value: 'latn', label: t('shell.user.digitsLatn'), testId: 'button-digits-latn' },
                  { value: 'arab', label: t('shell.user.digitsArab'), testId: 'button-digits-arab' },
                ]}
              />
              <p className="shell-dialog__preview" data-testid="text-digit-preview">
                {t('shell.user.preview')}: <bdi>{formatNumber(1234.5, locale, digitPreference)}</bdi>
              </p>
            </div>
          </section>
          <div className="shell-dialog__foot">
            <Button variant="secondary" onClick={() => void doLogout()} disabled={logoutState === 'pending'} data-testid="button-logout">
              <LogOut size={18} aria-hidden="true" className="shell-dir-icon" />
              {logoutState === 'error' ? t('shell.user.logoutRetry') : fixture ? t('shell.user.logoutFixture') : t('shell.user.logout')}
            </Button>
            {logoutState === 'error' && <p className="shell-error" role="alert" data-testid="status-logout-error">{t('shell.user.logoutError')}</p>}
            {fixture && <p className="shell-note">{t('shell.user.logoutNote')}</p>}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PageContent({ res, title, clinic, landing }: { res: Resolution; title: string; clinic: ShellClinic | null; landing: string | null }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const [now] = useState(() => new Date().toISOString());

  if (res.kind === 'page') {
    const Icon = res.route.icon;
    const isAdmin = res.route.roles.includes('admin');
    return (
      <article className="shell-page" data-testid={`page-${res.route.id}`}>
        <p className="shell-page__eyebrow">{res.isLanding ? t('shell.page.landing') : t('shell.page.placeholder')}</p>
        <h1 id="page-title" tabIndex={-1} className="shell-page__title"><Icon size={28} aria-hidden="true" />{title}</h1>
        <p className="shell-page__body">{t('shell.page.body')}</p>
        <ul className="shell-page__meta">
          <li data-testid="text-page-clinic">{clinic ? t('shell.page.clinic', { clinic: '\u2068' + clinic.name + '\u2069' }) : t('shell.page.noClinic')}</li>
          <li data-testid="text-page-clock">{t('shell.page.clock', { time: formatInstant(now, locale, digitPreference) })}</li>
          {isAdmin && <li>{t('shell.page.adminNote')}</li>}
        </ul>
        <div className="shell-page__ghost" aria-hidden="true"><span /><span /><span /></div>
      </article>
    );
  }
  const kind = res.kind === 'forbidden' ? 'forbidden' : res.kind === 'noRole' ? 'noRole' : 'notFound';
  return (
    <div className="shell-state" data-testid={`state-${kind}`}>
      <EmptyState
        headingLevel={1}
        title={<span id="page-title" tabIndex={-1}>{title}</span>}
        description={t(`shell.states.${kind}.desc`)}
        actions={landing && kind !== 'noRole'
          ? <Link href={demoPath(landing)} className="amal-btn amal-btn--primary" data-testid="link-landing">{t(`shell.states.${kind}.back`)}</Link>
          : undefined}
      />
    </div>
  );
}
