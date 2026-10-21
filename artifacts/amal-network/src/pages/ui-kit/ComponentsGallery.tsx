import { useMemo, useState } from 'react';
import { useTranslation, I18nextProvider } from 'react-i18next';
import {
  AmalIcons, Avatar, Bidi, Breadcrumbs, Button, ConfirmDialog, ConsentBadge, DataTable, EmptyState, FilterBar, FormField, InfoCard, KeyAlertChip, PageHeader, Phone,
  SectionCard, Skeleton, StatCard, StatusBadge, Stepper, Tabs, Timeline, useToast, type Column,
} from '@workspace/amal-ui';

interface Row { id: number; name: string; phone: string; time: string; status: 'booked' | 'completed' | 'noshow' }

/** Every shared component, rendered with synthetic demo values. */
export function ComponentsGallery({ idPrefix = 'g' }: { idPrefix?: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState('all');
  const [confirm, setConfirm] = useState(false);
  const [tableState, setTableState] = useState<'ready' | 'loading' | 'error' | 'empty'>('ready');
  const [q, setQ] = useState('');
  const rows: Row[] = useMemo(() => [
    { id: 1, name: t('kit.g.p1'), phone: '+962 79 555 0142', time: '09:15', status: 'booked' },
    { id: 2, name: t('kit.g.p2'), phone: '+962 77 555 0187', time: '09:40', status: 'completed' },
    { id: 3, name: t('kit.g.p3'), phone: '+962 78 555 0119', time: '10:05', status: 'noshow' },
  ], [t]);
  const columns: Column<Row>[] = [
    { key: 'name', header: t('kit.g.colName'), cell: (r) => <span className="kit-g-name"><Avatar name={r.name} size="sm" /><Bidi>{r.name}</Bidi></span> },
    { key: 'phone', header: t('kit.g.colPhone'), cell: (r) => <Phone value={r.phone} /> },
    { key: 'status', header: t('kit.g.colStatus'), cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'time', header: t('kit.g.colTime'), cell: (r) => <time>{r.time}</time>, numeric: true },
  ];
  return (
    <div className="kit-g">
      <Breadcrumbs label={t('shell.crumbs')} items={[{ label: t('shell.crumbsHome'), href: '#components' }, { label: t('shell.groups.reception'), href: '#components' }, { label: t('shell.nav.today') }]} />
      <PageHeader level={3} titleId={`${idPrefix}-ph`} icon={AmalIcons.today} section="reception" eyebrow={t('kit.g.eyebrow')} title={t('shell.nav.today')} description={t('kit.g.phDesc')}
        secondaryActions={<Button variant="secondary" size="sm">{t('kit.g.print')}</Button>} primaryAction={<Button size="sm">{t('kit.g.newBooking')}</Button>} />
      <div className="kit-g-stats">
        <StatCard icon={AmalIcons.today} section="reception" value="47" label={t('kit.g.stat1')} trend={{ direction: 'up', label: t('kit.g.trend1') }} />
        <StatCard icon={AmalIcons.patients} section="patients" value="1,284" label={t('kit.g.stat2')} />
        <StatCard icon={AmalIcons.networkSearch} section="network" value="3" label={t('kit.g.stat3')} />
        <StatCard icon={AmalIcons.kpi} section="admin" value="2.4 s" label={t('kit.g.stat4')} trend={{ direction: 'down', label: t('kit.g.trend4') }} />
      </div>
      <div className="kit-g-grid">
        <SectionCard title={t('kit.g.tableTitle')} description={t('kit.g.tableDesc')} icon={AmalIcons.today} section="reception" level={3}
          actions={<select className="amal-input kit-g-select" value={tableState} onChange={(e) => setTableState(e.target.value as typeof tableState)} aria-label={t('kit.g.stateLabel')} data-testid={`${idPrefix}-select-table-state`}>
            {(['ready', 'loading', 'error', 'empty'] as const).map((s) => <option key={s} value={s}>{t(`kit.g.state.${s}`)}</option>)}
          </select>}>
          <FilterBar label={t('kit.g.filters')} onReset={() => setQ('')}>
            <input className="amal-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('kit.g.filterPh')} aria-label={t('kit.g.filterPh')} dir="auto" />
          </FilterBar>
          <Tabs label={t('kit.g.tabs')} value={tab} onChange={setTab} items={[{ id: 'all', label: t('kit.g.tabAll'), count: 3 }, { id: 'waiting', label: t('kit.g.tabWaiting'), count: 1 }, { id: 'done', label: t('kit.g.tabDone'), count: 1 }]} idBase={`${idPrefix}-tabs`}>
            <DataTable caption={t('kit.g.tableTitle')} columns={columns} rowKey={(r) => r.id} testId={`${idPrefix}-dt`}
              rows={tableState === 'empty' ? [] : rows.filter((r) => (tab === 'all' || (tab === 'waiting' ? r.status === 'booked' : r.status === 'completed')) && r.name.includes(q))}
              status={tableState === 'loading' ? 'loading' : tableState === 'error' ? 'error' : 'ready'} onRetry={() => setTableState('ready')}
              cardTitle={(r) => <Bidi>{r.name}</Bidi>} emptyTitle={t('kit.g.emptyTable')}
              rowActions={() => <Button variant="ghost" size="sm">{t('kit.g.open')}</Button>} />
          </Tabs>
        </SectionCard>
        <div className="kit-g-col">
          <SectionCard title={t('kit.g.patient')} icon={AmalIcons.patientCard} section="patients" level={3}>
            <div className="kit-g-patient">
              <Avatar name={rows[0].name} size="lg" />
              <div><p className="kit-g-pname"><Bidi>{rows[0].name}</Bidi></p><p className="kit-g-muted">{t('kit.g.phoneLine')} <Phone value={rows[0].phone} /></p></div>
            </div>
            <div className="kit-row"><ConsentBadge state="granted" /><ConsentBadge state="pending" /><ConsentBadge state="withdrawn" /><ConsentBadge state="unknown" /></div>
            <div className="kit-row"><KeyAlertChip>{t('kit.g.alert1')}</KeyAlertChip><KeyAlertChip level="info">{t('kit.g.alert2')}</KeyAlertChip></div>
          </SectionCard>
          <SectionCard title={t('kit.g.timeline')} icon={AmalIcons.accessLog} section="network" level={3}>
            <Timeline label={t('kit.g.timeline')} items={[
              { id: 1, title: t('kit.g.tl1'), time: '2025-06-14T09:12', timeLabel: '09:12', tone: 'primary' },
              { id: 2, title: t('kit.g.tl2'), time: '2025-06-14T09:30', timeLabel: '09:30', tone: 'success' },
              { id: 3, title: t('kit.g.tl3'), time: '2025-06-14T10:02', timeLabel: '10:02' },
            ]} />
          </SectionCard>
        </div>
      </div>
      <SectionCard title={t('kit.g.form')} icon={AmalIcons.newBooking} section="reception" level={3} tone="soft">
        <Stepper label={t('kit.g.form')} current={1} steps={[t('kit.g.s1'), t('kit.g.s2'), t('kit.g.s3'), t('kit.g.s4')]} />
        <div className="kit-form-grid kit-g-form">
          <FormField label={t('kit.g.fName')} required hint={t('kit.g.fNameHint')}>{({ id, describedBy }) => <input id={id} aria-describedby={describedBy} className="amal-input" dir="auto" />}</FormField>
          <FormField label={t('kit.g.fPhone')} required error={t('kit.g.fPhoneErr')}>{({ id, describedBy, invalid }) => <input id={id} type="tel" dir="ltr" aria-describedby={describedBy} aria-invalid={invalid} className="amal-input" defaultValue="+962 79" />}</FormField>
        </div>
        <div className="kit-row">
          <Button variant="danger" onClick={() => setConfirm(true)} data-testid={`${idPrefix}-button-open-confirm`}>{t('kit.g.cancelBooking')}</Button>
          <Button variant="secondary" onClick={() => toast.show({ title: t('kit.g.toastTitle'), description: t('kit.g.toastDesc'), tone: 'success' })} data-testid={`${idPrefix}-button-toast`}>{t('kit.g.showToast')}</Button>
        </div>
      </SectionCard>
      <div className="kit-g-grid2">
        <InfoCard title={t('kit.g.info')} tone="info">{t('kit.g.infoBody')}</InfoCard>
        <InfoCard title={t('kit.g.warn')} tone="warning">{t('kit.g.warnBody')}</InfoCard>
        <SectionCard title={t('kit.g.loading')} level={3}><Skeleton lines={3} /></SectionCard>
        <SectionCard title={t('kit.g.empty')} level={3}><EmptyState className="amal-empty--compact" title={t('kit.g.emptyTitle')} description={t('kit.g.emptyDesc')} /></SectionCard>
      </div>
      <ConfirmDialog open={confirm} tone="danger" title={t('kit.g.confirmTitle')} description={t('kit.g.confirmDesc')} confirmLabel={t('kit.g.cancelBooking')} cancelLabel={t('kit.g.keep')}
        onConfirm={() => setConfirm(false)} onCancel={() => setConfirm(false)} />
    </div>
  );
}

const COMBOS = [
  { lng: 'ar', theme: 'light' }, { lng: 'ar', theme: 'dark' }, { lng: 'en', theme: 'light' }, { lng: 'en', theme: 'dark' },
] as const;

/** The same components in all four combinations (AR/EN x Light/Dark), side by side. */
export function CombinationMatrix() {
  const { i18n } = useTranslation();
  const clones = useMemo(() => COMBOS.map((c) => i18n.cloneInstance({ lng: c.lng, initAsync: false })), [i18n]);
  return (
    <div className="kit-combos">
      {COMBOS.map((c, i) => (
        <I18nextProvider key={c.lng + c.theme} i18n={clones[i]}>
          <ComboPanel lng={c.lng} theme={c.theme} />
        </I18nextProvider>
      ))}
    </div>
  );
}

function ComboPanel({ lng, theme }: { lng: 'ar' | 'en'; theme: 'light' | 'dark' }) {
  const { t } = useTranslation();
  return (
    <section lang={lng} dir={lng === 'ar' ? 'rtl' : 'ltr'} data-theme={theme} className="kit-combo" data-testid={`combo-${lng}-${theme}`} aria-label={`${lng.toUpperCase()} · ${theme}`}>
      <p className="kit-combo__tag">{lng.toUpperCase()} · {t(`kit.g.theme.${theme}`)}</p>
      <div className="kit-g-stats kit-g-stats--2">
        <StatCard icon={AmalIcons.today} section="reception" value="47" label={t('kit.g.stat1')} />
        <StatCard icon={AmalIcons.networkSearch} section="network" value="3" label={t('kit.g.stat3')} />
      </div>
      <div className="kit-row"><StatusBadge status="booked" /><StatusBadge status="conflict" /><ConsentBadge state="granted" /><KeyAlertChip>{t('kit.g.alert1')}</KeyAlertChip></div>
      <div className="kit-row"><Avatar name={t('kit.g.p1')} /><Bidi>{t('kit.g.p1')}</Bidi><Phone value="+962 79 555 0142" /></div>
      <Stepper label={t('kit.g.form')} current={1} steps={[t('kit.g.s1'), t('kit.g.s2'), t('kit.g.s3')]} />
      <div className="kit-row"><Button size="sm">{t('kit.g.newBooking')}</Button><Button size="sm" variant="secondary">{t('kit.g.print')}</Button></div>
      <InfoCard title={t('kit.g.info')}>{t('kit.g.infoBody')}</InfoCard>
    </section>
  );
}
