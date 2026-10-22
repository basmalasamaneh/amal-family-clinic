import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Redirect, useLocation, useSearch } from 'wouter';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Dialog from '@radix-ui/react-dialog';
import { DoorOpen, BookOpenText, CircleHelp, PlayCircle, ShieldCheck, FlaskConical, LogOut, MoreHorizontal, RotateCw, Search, X, ShieldX, UserX, FileQuestion } from 'lucide-react';
import { ConnectionStatus } from './ConnectionStatus';
import { DaySheet } from '@/day-sheet/DaySheet';
import './offline-messages';
import { usePrivateCacheContext } from './private-cache-lifecycle';
import { localCache } from '@/offline';
import { AmalLogo, Avatar, Breadcrumbs, Button, DensitySwitch, EmptyState, Icon, IconChip, PageHeader, LanguageSwitch, Segmented, ThemeSwitch, useAmalPreferences } from '@workspace/amal-ui';
import { groupOf, groupRoutes, sectionOf } from './nav-groups';
import { formatInstant, formatNumber } from './formatting';
import { demoPath, type ShellClinic, type ShellIdentity } from './identity';
import { TourOverlay } from '@/tour/TourOverlay';
import { useTour } from '@/tour/use-tour';
import { CalendarPage } from '@/calendar/CalendarPage';
import { BookingHandoff } from '@/calendar/BookingHandoff';
import { CancellationProvider } from '@/calendar/CancellationProvider';
import { PatientsPage } from '@/reception/PatientsPage';
import { WalkInButton, WalkInProvider, useWalkIn } from '@/reception/WalkIn';
import { WalkInHandoff } from '@/reception/WalkInHandoff';
import { requestWalkIn, useWalkInAvailable } from '@/reception/walkin-bus';
import { withCarry } from '@/calendar/carry';
import { NetworkSearchPage } from '@/network/NetworkSearchPage';
import { PatientCardPage } from '@/network/PatientCardPage';
import { MyDayPage } from '@/doctor/MyDayPage';
import { PrivacyPage } from '@/doctor/PrivacyPage';
import { KpiPage } from '@/kpi/KpiPage';
import { NetworkHealthPage } from '@/admin/NetworkHealthPage';
import { UsersDevicesPage } from '@/admin/UsersDevicesPage';
import { ClinicsDoctorsPage } from '@/admin/ClinicsDoctorsPage';
import { AuditPage } from '@/admin/AuditPage';
import { MessagesPage } from '@/reminders/MessagesPage';
import { WaitlistPage } from '@/waitlist/WaitlistPage';
import { DeveloperToolsPage } from '@/admin/DeveloperToolsPage';
import { clearSelection as clearNetworkSelection } from '@/network/model';
import { clearConsentSelection } from '@/consent/model';
import { ConsentPage } from '@/consent/ConsentPage';
import { ImportPage } from '@/imports/ImportPage';
import { DuplicatesPage } from '@/duplicates/DuplicatesPage';
import { AdoptionPage } from '@/adoption/AdoptionPage';
import '@/adoption/i18n';
import { SyncQueuePanel } from '@/sync/SyncQueuePanel';
import { isKnownRole, landingFor, resolve, routesFor, type Resolution, type ShellRoute } from './routes';

const BOTTOM_SLOTS = 4;
type NavigationItem = ShellRoute & { schedule?: boolean; labelKey?: string; patientSearch?: boolean };
const DOCTOR_NAV_GROUPS = [
  { group: 'doctorClinical', ids: ['myDay', 'networkSearch'] },
  { group: 'doctorRecords', ids: ['import', 'duplicates'] },
  { group: 'doctorPrivacy', ids: ['adoption', 'privacy'] },
];
const DOCTOR_NAV_LABELS: Record<string, string> = {
  networkSearch: 'findPatient', duplicates: 'reviewDuplicates', adoption: 'networkParticipation',
};
const navActive = (route: NavigationItem, location: string) => location === route.path
  || !!route.schedule && ['/desk/today', '/desk/week'].includes(location)
  || !!route.patientSearch && location === '/doctor/patient-card';

interface Props { identity: ShellIdentity; fixture: boolean; onRefresh: (strict?: boolean) => Promise<void>; onLogout: () => Promise<void> }

export function AppShell({ identity, fixture, onRefresh, onLogout }: Props) {
  return <CancellationProvider key={identity.id} clinicNames={Object.fromEntries(identity.clinics.map((c) => [c.id, c.name]))}><AppShellContent identity={identity} fixture={fixture} onRefresh={onRefresh} onLogout={async () => {
    window.dispatchEvent(new Event('amal:discard-cancellations'));
    clearNetworkSelection(); clearConsentSelection();
    await onLogout();
  }} /></CancellationProvider>;
}

function AppShellContent({ identity, fixture, onRefresh, onLogout }: Props) {
  const { t } = useTranslation();
  const [location] = useLocation();
  const role = isKnownRole(identity.role) ? identity.role : null;
  // Expiry/unmount must also clear transient selections, not just explicit logout.
  useEffect(() => () => { clearNetworkSelection(); clearConsentSelection(); }, [identity.id, role]);
  const items = useMemo<NavigationItem[]>(() => routesFor(role)
    .filter((r) => !r.navHidden && !(role === 'front-desk' && ['week', 'newBooking', 'daySheet'].includes(r.id))
      && !(role === 'doctor' && r.id === 'patientCard'))
    .map((r) => role === 'doctor' ? { ...r, labelKey: DOCTOR_NAV_LABELS[r.id], patientSearch: r.id === 'networkSearch' }
      : role === 'front-desk' && r.id === 'today' ? { ...r, schedule: true } : r), [role]);
  const navGroups = role === 'doctor'
    ? DOCTOR_NAV_GROUPS.map((g) => ({ group: g.group, items: g.ids.flatMap((id) => items.filter((r) => r.id === id)) }))
    : groupRoutes(items);
  const orderedItems = role === 'doctor' ? navGroups.flatMap((g) => g.items) : items;
  const res = resolve(location, role);

  const clinics = identity.clinics;
  const [clinicId, setClinicId] = useState<number | null>(clinics[0]?.id ?? null);
  useEffect(() => {
    if (clinicId === null || !clinics.some((c) => c.id === clinicId)) setClinicId(clinics[0]?.id ?? null);
  }, [clinics, clinicId]);
  const clinic = clinics.find((c) => c.id === clinicId) ?? null;
  usePrivateCacheContext(identity, clinic?.id ?? null, fixture);

  const tour = useTour(identity.id, role);
  const [collapsed, setCollapsed] = useState(() => { try { return window.localStorage.getItem('amal.nav.collapsed') === '1'; } catch { return false; } });
  const toggleCollapsed = () => setCollapsed((c) => { try { window.localStorage.setItem('amal.nav.collapsed', c ? '0' : '1'); } catch { /* storage unavailable */ } return !c; });
  const title = role === 'doctor' && res.kind === 'page' && DOCTOR_NAV_LABELS[res.route.id]
    ? t(`shell.nav.${DOCTOR_NAV_LABELS[res.route.id]}`) : titleFor(res, t);
  const [announce, setAnnounce] = useState('');
  const first = useRef(true);
  useEffect(() => {
    if (res.kind === 'landing') return;
    setAnnounce(t('shell.page.announce', { title }));
    if (first.current) { first.current = false; return; }
    document.getElementById('page-title')?.focus();
  }, [location, title, res.kind, t]);

  const crumbs = res.kind === 'page' && !res.isLanding
    ? [{ label: t(`shell.groups.${role === 'doctor'
      ? DOCTOR_NAV_GROUPS.find((g) => g.ids.includes(res.route.id === 'patientCard' ? 'networkSearch' : res.route.id))?.group ?? groupOf(res.route.id)
      : groupOf(res.route.id)}`) }, { label: title }]
    : [{ label: title }];

  if (res.kind === 'landing') return <Redirect to={demoPath(res.to)} replace />;

  return (
    <WalkInProvider key={clinic?.id ?? 'none'} clinic={clinic} fixture={fixture} enabled={role === 'front-desk'}>
    <div className="shell" data-testid="app-shell" data-role={identity.role ?? 'none'} data-collapsed={collapsed || undefined}>
      <a href="#main" className="shell-skip" data-testid="link-skip">{t('shell.skip')}</a>
      <div className="shell-sr" role="status" aria-live="polite" data-testid="status-route-announce">{announce}</div>

      <aside className="shell-side" data-testid="nav-sidebar" data-tour="nav-side" data-collapsed={collapsed || undefined}>
        <div className="shell-side__top">
          <Link href={demoPath('/')} className="shell-side__brand" aria-label={t('shell.brand')} data-testid="link-brand">
            <AmalLogo />
          </Link>
          <button type="button" className="shell-side__collapse" aria-pressed={collapsed} aria-label={collapsed ? t('shell.nav.expand') : t('shell.nav.collapse')} title={collapsed ? t('shell.nav.expand') : t('shell.nav.collapse')} onClick={toggleCollapsed} data-testid="button-nav-collapse">
            <Icon name={collapsed ? 'expand' : 'collapse'} size={18} />
          </button>
        </div>
        <nav aria-label={t('shell.nav.label')}>
          {navGroups.map((g) => (
            <div key={g.group} className="shell-side__group" role="group" aria-labelledby={`nav-g-${g.group}`}>
              <p id={`nav-g-${g.group}`} className="shell-side__glabel">{t(`shell.groups.${g.group}`)}</p>
              <ul className="shell-side__list">
                {g.items.map((r) => <li key={r.id}><NavLink route={r} location={location} variant="side" /></li>)}
              </ul>
            </div>
          ))}
        </nav>
        <div className="shell-side__foot">
          <Link href={demoPath('/data')} className="shell-side__kit shell-side__data" data-tour="your-data" data-testid="link-side-data" title={t('data.navLink')}><Icon name="shield" size={18} /><span className="shell-side__kitlabel">{t('data.navLink')}</span></Link>
        </div>
      </aside>

      <div className="shell-body">
        {fixture && (
          <section className="shell-fixture" aria-label={t('shell.fixtureBanner')} data-testid="banner-fixture">
            <FlaskConical size={16} aria-hidden="true" />{t('shell.fixtureBanner')}
          </section>
        )}
        <header className="shell-top">
          <div className="shell-top__main">
          <div className="shell-top__brand"><AmalLogo /></div>
          <ClinicSwitcher clinics={clinics} state={identity.clinicsState} value={clinicId} onChange={(id) => { void localCache.setContext(null); clearNetworkSelection(); clearConsentSelection(); setClinicId(id); }} onRetry={onRefresh} />
          {!(res.kind === 'page' && (res.route.id === 'networkSearch' || res.route.id === 'patientCard')) && <GlobalSearch key={clinicId ?? 'none'} />}
          <div className="shell-top__walkin"><WalkInButton /></div>
          <div className="shell-top__end">
            <button type="button" className="shell-iconbtn" aria-disabled="true" aria-label={t('shell.bell.label')} title={t('shell.bell.soon')} data-testid="button-notifications">
              <Icon name="bell" size={19} />
            </button>
            <div className="shell-top__prefs"><LanguageSwitch /><ThemeSwitch /></div>
            <HelpMenu onReplay={tour.start} canReplay={tour.steps.length > 0} />
            <UserMenu identity={identity} fixture={fixture} onLogout={onLogout} />
          </div>
          </div>
          <div className="shell-top__status">
            <ConnectionStatus userId={identity.id} clinicId={clinic?.id ?? null} queueAvailable={role === 'front-desk'} />
          </div>
        </header>

        <div className="shell-crumbs"><Breadcrumbs label={t('shell.crumbs')} items={[{ label: t('shell.crumbsHome'), render: (c: ReactNode, cls: string) => <Link href={demoPath('/')} className={cls} data-testid="link-crumb-home">{c}</Link> }, ...crumbs]} /></div>
        <main id="main" tabIndex={-1} className="shell-main" key={role === 'admin' ? 'admin' : clinicId ?? 'none'}>
          <PageContent identity={identity} res={res} title={title} clinic={clinic} clinics={clinics} fixture={fixture} landing={landingFor(role)} scope={`${identity.id}:${role ?? 'none'}:${role === 'admin' ? 'all' : clinic?.id ?? 'none'}`} onRefresh={onRefresh} />
        </main>
      </div>

      {items.length > 0 && <BottomNav items={orderedItems} location={location} />}
      {tour.open && <TourOverlay key={tour.run} steps={tour.steps} onFinish={tour.finish} />}
    </div>
    </WalkInProvider>
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

function NavLink({ route, location, variant }: { route: NavigationItem; location: string; variant: 'side' | 'bottom' }) {
  const { t } = useTranslation();
  const Icon = route.icon;
  const search = useSearch();
  // Today/Week keep the selected date and doctor filter (validated again by the calendar page).
  const calendarRoute = route.id === 'today' || route.id === 'week';
  const fromCalendar = location === '/desk/today' || location === '/desk/week';
  const active = navActive(route, location);
  const label = t(`shell.nav.${route.labelKey ?? (route.schedule ? 'schedule' : route.id)}`);
  const destination = route.schedule && fromCalendar ? location : route.path;
  return (
    <Link
      href={demoPath(calendarRoute && fromCalendar ? withCarry(destination, search) : destination)}
      className={`shell-nav shell-nav--${variant}${active ? ' is-active' : ''}`}
      data-section={sectionOf(route.id)}
      title={variant === 'side' ? label : undefined}
      aria-current={active ? 'page' : undefined}
      data-testid={`link-nav-${variant}-${route.id}`}
    >
      {variant === 'side' ? <IconChip icon={Icon} section={sectionOf(route.id)} size="sm" /> : <Icon size={20} aria-hidden="true" />}
      <span className="shell-nav__label">{label}</span>
    </Link>
  );
}

function BottomNav({ items, location }: { items: NavigationItem[]; location: string }) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const needsMore = items.length > BOTTOM_SLOTS + 1;
  const visible = needsMore ? items.slice(0, BOTTOM_SLOTS) : items;
  const overflow = needsMore ? items.slice(BOTTOM_SLOTS) : [];
  const overflowActive = overflow.some((r) => navActive(r, location));
  const walkInOk = useWalkInAvailable();
  return (
    <nav className="shell-bottom" aria-label={t('shell.nav.label')} data-testid="nav-bottom" data-tour="nav-bottom">
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
                  {walkInOk && <DropdownMenu.Item className="shell-menu__item" onSelect={() => setTimeout(requestWalkIn, 0)} data-testid="menuitem-more-walkin"><DoorOpen size={18} aria-hidden="true" />{t('calendar.actions.walkIn')}</DropdownMenu.Item>}
                  {overflow.map((r) => {
                    const Icon = r.icon;
                    return (
                      <DropdownMenu.Item
                        key={r.id}
                        className={`shell-menu__item${navActive(r, location) ? ' is-active' : ''}`}
                        onSelect={() => navigate(demoPath(r.path))}
                        data-testid={`menuitem-more-${r.id}`}
                      >
                        <Icon size={18} aria-hidden="true" />{t(`shell.nav.${r.labelKey ?? r.id}`)}
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

function UserMenu({ identity, fixture, onLogout }: { identity: ShellIdentity; fixture: boolean; onLogout: () => Promise<void> }) {
  const { t } = useTranslation();
  const { locale, digitPreference, setDigitPreference } = useAmalPreferences();
  const [logoutState, setLogoutState] = useState<'idle' | 'pending' | 'error'>('idle');
  const doLogout = async () => {
    setLogoutState('pending');
    try { await onLogout(); setLogoutState('idle'); } catch { setLogoutState('error'); }
  };
  const roleLabel = t(`shell.roles.${isKnownRole(identity.role) ? identity.role : 'none'}`);
  return (
    <Dialog.Root>
      <Dialog.Trigger data-tour="user-menu" className="shell-user" data-testid="button-user-menu">
        <Avatar name={identity.name} size="sm" className="shell-user__avatar" />
        <span className="shell-user__name"><bdi>{identity.name}</bdi></span>
        <span className="shell-sr">{t('shell.user.title')}</span>
        <Icon name="chevronDown" size={16} className="shell-user__icon" />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-overlay" />
        <Dialog.Content className="shell-dialog account-dialog" data-testid="dialog-user" aria-describedby={undefined}>
          <div className="shell-dialog__head">
            <Dialog.Title className="shell-dialog__title">{t('shell.user.title')}</Dialog.Title>
            <Dialog.Close className="amal-btn amal-btn--icon shell-dialog__x" aria-label={t('shell.user.close')} data-testid="button-user-close">
              <X size={20} aria-hidden="true" />
            </Dialog.Close>
          </div>
          <dl className="account-dialog__summary">
            <div className="account-dialog__identity">
              <dt>{t('shell.user.identity')}</dt><dd data-testid="text-user-name"><bdi>{identity.name}</bdi></dd>
            </div>
              <div><dt>{t('shell.user.role')}</dt><dd data-testid="text-user-role">{roleLabel}</dd></div>
              <div><dt>{t('shell.user.clinics')}</dt>
                <dd className="account-dialog__clinics" data-testid="text-user-clinics">{identity.clinics.length ? identity.clinics.map((c) => <bdi key={c.id} className="shell-chip">{c.name}</bdi>) : t('shell.user.noClinics')}</dd>
              </div>
          </dl>
          <section className="shell-dialog__section" aria-labelledby="display-h">
            <h3 id="display-h" className="shell-dialog__h">{t('shell.user.display')}</h3>
            <div>
              <div className="account-dialog__row">
                <p className="account-dialog__label" id="account-language-label">{t('shell.user.language')}</p>
                <div className="account-dialog__control" role="group" aria-labelledby="account-language-label"><LanguageSwitch /></div>
              </div>
              <div className="account-dialog__row">
                <p className="account-dialog__label" id="account-theme-label">{t('shell.user.theme')}</p>
                <div className="account-dialog__control" role="group" aria-labelledby="account-theme-label"><ThemeSwitch /></div>
              </div>
              <div className="account-dialog__row">
                <p className="account-dialog__label" id="account-density-label">{t('shell.user.density')}</p>
                <div className="account-dialog__control" role="group" aria-labelledby="account-density-label"><DensitySwitch /></div>
              </div>
              <div className="account-dialog__row">
                <p className="account-dialog__label" id="account-numerals-label">{t('shell.user.numerals')}</p>
                <div className="account-dialog__control" role="group" aria-labelledby="account-numerals-label" aria-describedby="account-numerals-preview">
              <Segmented
                label={t('shell.user.digits')}
                value={digitPreference}
                onChange={(v: 'latn' | 'arab') => setDigitPreference(v)}
                options={[
                  { value: 'latn', label: t('shell.user.digitsLatn'), testId: 'button-digits-latn' },
                  { value: 'arab', label: t('shell.user.digitsArab'), testId: 'button-digits-arab' },
                ]}
              />
              <p className="shell-dialog__preview" id="account-numerals-preview" data-testid="text-digit-preview">
                {t('shell.user.preview')}: <bdi>{formatNumber(1234.5, locale, digitPreference)}</bdi>
              </p>
                </div>
              </div>
            </div>
          </section>
          <div className="shell-dialog__foot">
            <WalkInHandoff className="amal-btn amal-btn--secondary" testId="button-user-walkin" />
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

function HelpMenu({ onReplay, canReplay }: { onReplay: () => void; canReplay: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const walkIn = useWalkIn();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className="shell-user shell-help" data-tour="help" aria-label={t('help.open')} data-testid="button-help">
        <CircleHelp size={22} aria-hidden="true" />
        <span className="shell-user__name" aria-hidden="true">{t('help.label')}</span>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="shell-overlay" />
        <Dialog.Content className="shell-dialog" data-testid="dialog-help" aria-describedby="help-desc">
          <div className="shell-dialog__head">
            <Dialog.Title className="shell-dialog__title">{t('help.title')}</Dialog.Title>
            <Dialog.Close className="amal-btn amal-btn--icon shell-dialog__x" aria-label={t('help.close')} data-testid="button-help-close"><X size={20} aria-hidden="true" /></Dialog.Close>
          </div>
          <p id="help-desc" className="shell-dialog__preview">{t('help.desc')}</p>
          <ul className="help-list">
            {walkIn.enabled && <li>
              <button type="button" className="help-item" onClick={() => { setOpen(false); setTimeout(() => walkIn.open(), 0); }} data-testid="button-help-walkin">
                <DoorOpen size={22} aria-hidden="true" />
                <span><strong>{t('calendar.actions.walkIn')}</strong></span>
              </button>
            </li>}
            <li>
              <button type="button" className="help-item" disabled={!canReplay} onClick={() => { setOpen(false); setTimeout(onReplay, 0); }} data-testid="button-replay-tour">
                <PlayCircle size={22} aria-hidden="true" />
                <span><strong>{t('help.replay')}</strong><small>{t('help.replayDesc')}</small></span>
              </button>
            </li>
            <li>
              <Link href={demoPath('/data')} className="help-item" onClick={() => setOpen(false)} data-testid="link-help-data">
                <BookOpenText size={22} aria-hidden="true" />
                <span><strong>{t('data.title')}</strong><small>{t('help.dataDesc')}</small></span>
              </Link>
            </li>
          </ul>
          <p className="shell-note">{t('help.support')}</p>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function PageContent({ identity, res, title, clinic, clinics, fixture, landing, scope, onRefresh }: { identity: ShellIdentity; res: Resolution; title: string; clinic: ShellClinic | null; clinics: ShellClinic[]; fixture: boolean; landing: string | null; scope: string; onRefresh: (strict?: boolean) => Promise<void> }) {
  const { t } = useTranslation();
  const { locale, digitPreference } = useAmalPreferences();
  const [now] = useState(() => new Date().toISOString());

  if (res.kind === 'page' && (res.route.id === 'today' || res.route.id === 'week')) return <CalendarPage view={res.route.id === 'today' ? 'day' : 'week'} clinic={clinic} fixture={fixture} title={title} />;
  if (res.kind === 'page' && res.route.id === 'patientLookup') return <PatientsPage clinic={clinic} fixture={fixture} title={title} />;
  if (res.kind === 'page' && res.route.id === 'import') return <ImportPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'duplicates') return <DuplicatesPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'sync') return <SyncQueuePanel key={scope} clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'daySheet') return <DaySheet key={scope} clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'consent') return <ConsentPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'networkSearch') return <NetworkSearchPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'patientCard') return <PatientCardPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'myDay') return <MyDayPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'privacy') return <PrivacyPage clinic={clinic} title={title} scope={scope} />;
  if (res.kind === 'page' && res.route.id === 'adoption') return <AdoptionPage key={scope} clinic={clinic} accountId={identity.id} title={title} landing={landing} canSeePrivacy={identity.role === 'doctor'} onRefresh={onRefresh} />;
  if (res.kind === 'page' && res.route.id === 'kpi') return <KpiPage key={scope} title={title} clinics={clinics} />;
  // Admin pages are keyed by account+role scope so late results never cross a logout or role change.
  if (res.kind === 'page' && res.route.id === 'networkHealth') return <NetworkHealthPage key={scope} title={title} />;
  if (res.kind === 'page' && res.route.id === 'usersDevices') return <UsersDevicesPage key={scope} title={title} />;
  if (res.kind === 'page' && res.route.id === 'clinicsDoctors') return <ClinicsDoctorsPage key={scope} title={title} accountKey={scope.split(':').slice(0, -2).join(':')} onClinicsChanged={() => onRefresh(true)} />;
  if (res.kind === 'page' && res.route.id === 'waitlist') return <WaitlistPage key={scope} clinic={clinic} title={title} scope={scope} fixture={fixture} />;
  if (res.kind === 'page' && res.route.id === 'messages') return <MessagesPage key={scope} identity={identity} clinic={clinic} title={title} />;
  if (res.kind === 'page' && res.route.id === 'audit') return <AuditPage key={scope} title={title} />;
  if (res.kind === 'page' && res.route.id === 'developer') return <DeveloperToolsPage key={scope} title={title} />;
  if (res.kind === 'page' && res.route.id === 'newBooking') return <BookingHandoff clinic={clinic} fixture={fixture} title={title} />;
  if (res.kind === 'page') {
    const Icon = res.route.icon;
    const isAdmin = res.route.roles.includes('admin');
    return (
      <article className="shell-page" data-testid={`page-${res.route.id}`}>
        <PageHeader icon={Icon} section={sectionOf(res.route.id)} eyebrow={res.isLanding ? t('shell.page.landing') : t('shell.page.placeholder')} title={title} description={t('shell.page.body')} />
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
        illustration={<span className={`shell-state__icon shell-state__icon--${kind}`} aria-hidden="true">{kind === 'forbidden' ? <ShieldX size={40} /> : kind === 'noRole' ? <UserX size={40} /> : <FileQuestion size={40} />}</span>}
        title={<span id="page-title" tabIndex={-1}>{title}</span>}
        description={t(`shell.states.${kind}.desc`)}
        actions={landing && kind !== 'noRole'
          ? <Link href={demoPath(landing)} className="amal-btn amal-btn--primary" data-testid="link-landing">{t(`shell.states.${kind}.back`)}</Link>
          : undefined}
      />
    </div>
  );
}
