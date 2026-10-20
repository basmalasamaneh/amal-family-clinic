import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Redirect, useLocation, useSearch } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { setCsrfToken } from '@workspace/api-client-react';
import { AmalLogo, AmalPreferencesProvider, Button, EmptyState, ToastProvider } from '@workspace/amal-ui';
import { i18n } from '@/i18n';
import { LoginPage } from '@/pages/login/LoginPage';
import { DataPage } from '@/pages/data/DataPage';
import { loginHref, safeReturnTo } from '@/auth/return-to';
import { onUnauthorized, reportUnauthorized } from '@/auth/session-events';
import { ensureDemoContext, startDemoContextPolling } from '@/auth/demo-context';
import { demoPath, identityAdapter, type ShellIdentity } from './identity';
import { landingFor } from './routes';
import { AppShell } from './AppShell';
import { useOnlineStatus } from '@/hooks/use-online-status';
import './offline-messages';
import { localCache } from '@/offline';
import { readCleanupTarget, rememberCleanupTarget, UNKNOWN_CLEANUP } from './cleanup-warning';
import { allowSessionAfterLogin, markExplicitSignout, onPeerRevocation, revokeOfflineAuthorization } from '@/auth/offline-permit';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; identity: ShellIdentity | null; expired?: boolean };
const MAX_TIMER = 2_147_000_000;

/**
 * Session owner. GET /me (via the adapter) is authoritative; login only triggers a reload.
 * Preferences are mounted per identity so another account's settings never apply.
 */
export function ShellRoot() {
  const { t } = useTranslation();
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const [cleanupTarget, setCleanupTarget] = useState<string | null>(readCleanupTarget);
  const [cleaning, setCleaning] = useState(false);
  const [demoReset, setDemoReset] = useState(false);
  const [location, navigate] = useLocation();
  const search = useSearch();
  const qc = useQueryClient();
  const mounted = useRef(true);
  const locRef = useRef(location);
  locRef.current = location;

  const clearPrivate = useCallback(() => { void localCache.setContext(null); void qc.cancelQueries(); qc.clear(); setCsrfToken(null); }, [qc]);
  /** Every load gets a generation; logout/expiry bump it so stale in-flight loads can never restore a session. */
  const gen = useRef(0);
  const principal = useRef<string | null>(null);
  /** Applies a loaded identity; any change of account id or role drops all private cached queries. */
  const apply = useCallback((identity: ShellIdentity | null, extra?: { expired?: boolean }) => {
    void localCache.setContext(null);
    const next = identity ? `${identity.id}|${identity.role ?? 'none'}` : null;
    if (principal.current !== null && principal.current !== next) { void qc.cancelQueries(); qc.clear(); }
    principal.current = next;
    setCsrfToken(identity?.csrfToken ?? null);
    setState({ status: 'ready', identity, ...extra });
  }, [qc]);

  const load = useCallback(() => {
    void localCache.setContext(null);
    const g = ++gen.current;
    setState({ status: 'loading' });
    (identityAdapter.mode === 'fixture' ? identityAdapter.load() : ensureDemoContext().then(() => identityAdapter.load())).then(
      (identity) => { if (mounted.current && g === gen.current) apply(identity); },
      () => { if (mounted.current && g === gen.current) setState({ status: 'error' }); },
    );
  }, [apply]);

  const refresh = useCallback(async (strict = false) => {
    if (!navigator.onLine) throw new Error('Online sign-in verification is required');
    // Login/account switching revokes every previous tab permit before issuing a new one.
    revokeOfflineAuthorization();
    allowSessionAfterLogin();
    const g = ++gen.current;
    if (identityAdapter.mode !== 'fixture') await ensureDemoContext();
    const identity = await identityAdapter.load();
    if (g !== gen.current || !mounted.current) throw new Error('Superseded identity load');
    if (!identity || identity.offlineRestored) { reportUnauthorized(); throw new Error('No online session after sign-in'); }
    if (strict && identity.clinicsState === 'error') {
      // Keep the confirmed wizard mounted when only selector loading failed.
      // A real authority change still replaces the old identity immediately.
      if (principal.current !== `${identity.id}|${identity.role ?? 'none'}`) apply(identity);
      throw new Error('Clinic selector refresh failed');
    }
    apply(identity);
  }, [apply]);

  const expire = useCallback(() => {
    revokeOfflineAuthorization();
    gen.current++;
    principal.current = null;
    clearPrivate();
    setState((s) => (s.status === 'ready' && s.identity ? { status: 'ready', identity: null, expired: true } : s));
    const here = locRef.current;
    if (here !== '/login' && here !== '/data') navigate(demoPath(loginHref(here, true)), { replace: true });
  }, [clearPrivate, navigate]);

  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);
  useEffect(() => onUnauthorized(expire), [expire]);
  useEffect(() => {
    if (identityAdapter.mode === 'fixture') return;
    const reset = () => {
      ++gen.current;
      principal.current = null;
      clearPrivate();
      setDemoReset(true);
      setState({ status: 'ready', identity: null, expired: true });
    };
    window.addEventListener('amal:demo-reset', reset);
    const stop = startDemoContextPolling();
    return () => { stop(); window.removeEventListener('amal:demo-reset', reset); };
  }, [clearPrivate]);
  useEffect(() => onPeerRevocation(() => {
    // Do not rebroadcast peer events (avoids a cross-tab revocation loop).
    gen.current++;
    principal.current = null;
    clearPrivate();
    setState({ status: 'ready', identity: null, expired: true });
  }), [clearPrivate]);

  // One GET /me re-check at server expiry; a 401 ends the session, success slides it. Never loops on the same expiry.
  const identity = state.status === 'ready' ? state.identity : null;
  const expiresAt = identity?.offlineAuthorizedUntil ?? identity?.expiresAt ?? null;
  useEffect(() => {
    if (!expiresAt) return;
    const at = Date.parse(expiresAt);
    if (!Number.isFinite(at)) return;
    const timer = window.setTimeout(() => {
      if (!navigator.onLine) { expire(); return; }
      const g = ++gen.current;
      identityAdapter.load().then(
        (next) => { if (!mounted.current || g !== gen.current) return; if (!next || next.offlineRestored) expire(); else apply(next); },
        () => { if (mounted.current && g === gen.current) expire(); },
      );
    }, Math.min(Math.max(at - Date.now() + 1000, 1000), MAX_TIMER));
    return () => window.clearTimeout(timer);
  }, [expiresAt, expire, apply]);
  useEffect(() => {
    const offline = () => { if (identity && !identity.offlineAuthorizedUntil) expire(); };
    const online = () => { if (identity) load(); };
    window.addEventListener('offline', offline);
    window.addEventListener('online', online);
    return () => { window.removeEventListener('offline', offline); window.removeEventListener('online', online); };
  }, [identity, expire, load]);

  const path = location.replace(/\/+$/, '') || '/';
  const params = new URLSearchParams(search);

  const retainedWork = cleanupTarget?.startsWith('pending:') ?? false;
  if (cleanupTarget && !retainedWork) {
    return <AmalPreferencesProvider key="cleanup" i18n={i18n} userId={null}>
      <main className="shell-session" data-testid="state-cleanup-incomplete">
        <AmalLogo />
        <EmptyState headingLevel={1} title={t(cleanupTarget === UNKNOWN_CLEANUP ? 'offline:cleanupUnknownTitle' : 'offline:cleanupTitle')}
          description={t(cleanupTarget === UNKNOWN_CLEANUP ? 'offline:cleanupUnknownDescription' : 'offline:cleanupDescription')}
          actions={cleanupTarget === UNKNOWN_CLEANUP ? undefined : <Button disabled={cleaning} data-testid="button-retry-cleanup" onClick={async () => {
            setCleaning(true);
            const result = await localCache.logout({ userId: cleanupTarget });
            setCleaning(false);
            if (result.ok || result.error === 'pending-outbox') {
              const target = result.ok ? null : `pending:${cleanupTarget}`;
              rememberCleanupTarget(target);
              setCleanupTarget(target);
              load();
            }
          }}>{t('offline:cleanupRetry')}</Button>} />
      </main>
    </AmalPreferencesProvider>;
  }

  if (path === '/data') {
    const home = identity ? demoPath(landingFor(identity.role) ?? '/') : demoPath('/login');
    return (
      <AmalPreferencesProvider key={identity?.id ?? 'anonymous'} i18n={i18n} userId={identity?.id ?? null}>
        <DataPage signedIn={!!identity} home={home} />
      </AmalPreferencesProvider>
    );
  }

  if (state.status === 'ready' && state.identity) {
    const id = state.identity;
    if (path === '/login') return <Redirect to={demoPath(safeReturnTo(params.get('next'), id.role))} replace />;
    return (
      <AmalPreferencesProvider key={`${id.id}|${id.role ?? 'none'}`} i18n={i18n} userId={id.id}>
        <ToastProvider>
          {retainedWork && <p className="shell-fixture" role="status">{t('offline:retained')}</p>}
          {id.offlineRestored && <p className="shell-fixture" role="status">{t('offline:continuation', { until: id.offlineAuthorizedUntil })}</p>}
          <AppShell
            identity={id}
            fixture={identityAdapter.mode === 'fixture'}
            onRefresh={async (strict = false) => { try { await refresh(strict); } catch (e) { if (strict) throw e; /* keep identity */ } }}
            onLogout={async () => {
              // Warn about retained work, never offer to discard it.
              if (!window.confirm(t('offline:pending'))) return;
              gen.current++;
              void localCache.setContext(null);
              const request = navigator.onLine ? identityAdapter.logout() : Promise.resolve();
              markExplicitSignout();
              principal.current = null;
              clearPrivate();
              // Local sign-out is immediate even if the network logout cannot finish.
              if (mounted.current) setState({ status: 'ready', identity: null });
              void request.catch(() => { /* No offline permit survives an unsuccessful network logout. */ });
              // Persist before attempting deletion, so reload cannot hide a failed cleanup.
              rememberCleanupTarget(id.id);
              setCleanupTarget(id.id);
              const cleanup = await localCache.logout({ userId: id.id });
              const target = cleanup.ok ? null : cleanup.error === 'pending-outbox' ? `pending:${id.id}` : id.id;
              rememberCleanupTarget(target);
              setCleanupTarget(target);
              if (mounted.current) { setState({ status: 'ready', identity: null }); navigate(demoPath('/login'), { replace: true }); }
            }}
          />
        </ToastProvider>
      </AmalPreferencesProvider>
    );
  }

  return (
    <AmalPreferencesProvider key="anonymous" i18n={i18n} userId={null}>
      {demoReset && <p className="shell-fixture" role="alert">{t('offline:demoReset')}</p>}
      {retainedWork && <p className="shell-fixture" role="status">{t('offline:retained')}</p>}
      {state.status === 'loading' ? <ShellLoading />
        : state.status === 'error' ? <SessionError onRetry={load} />
        : path !== '/login' ? <Redirect to={demoPath(loginHref(path === '/' ? null : path))} replace />
        : <LoginPage notice={state.expired || params.get('reason') === 'expired' ? 'expired' : null} onAuthenticated={refresh} />}
    </AmalPreferencesProvider>
  );
}

function ShellLoading() {
  const { t } = useTranslation();
  return (
    <div className="shell-loading" role="status" aria-live="polite" data-testid="status-shell-loading">
      <span className="shell-sr">{t('shell.states.loading')}</span>
      <div className="shell-skel shell-skel--side" aria-hidden="true" />
      <div className="shell-loading__main" aria-hidden="true">
        <div className="shell-skel shell-skel--bar" />
        <div className="shell-skel shell-skel--title" />
        <div className="shell-skel shell-skel--block" />
      </div>
    </div>
  );
}

function SessionError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const online = useOnlineStatus();
  useEffect(() => { document.title = `${t('shell.states.error.title')} · ${t('app.name')}`; }, [t]);
  return (
    <main className="shell-session" data-testid="state-error">
      <AmalLogo />
      <EmptyState
        headingLevel={1}
        title={t(online ? 'shell.states.error.title' : 'offline:lockedTitle')}
        description={t(online ? 'shell.states.error.desc' : 'offline:lockedDescription')}
        actions={<Button onClick={onRetry} data-testid="button-retry-identity">{t('shell.states.error.retry')}</Button>}
      />
    </main>
  );
}
