import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AmalLogo, AmalPreferencesProvider, Button, EmptyState, ToastProvider } from '@workspace/amal-ui';
import { i18n } from '@/i18n';
import { identityAdapter, type ShellIdentity } from './identity';
import { AppShell } from './AppShell';

type LoadState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; identity: ShellIdentity | null };

/**
 * Loads identity before mounting the account shell so another user's preferences are never applied.
 * While loading/signed-out/error, preferences use isolated defaults (userId null).
 */
export function ShellRoot() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  const mounted = useRef(true);

  const load = useCallback(() => {
    setState({ status: 'loading' });
    identityAdapter.load().then(
      (identity) => mounted.current && setState({ status: 'ready', identity }),
      () => mounted.current && setState({ status: 'error' }),
    );
  }, []);

  /** Refresh without unmounting the shell (e.g. clinic retry); keeps identity on failure. */
  const refresh = useCallback(async () => {
    try {
      const identity = await identityAdapter.load();
      if (mounted.current) setState({ status: 'ready', identity });
    } catch { /* keep current identity */ }
  }, []);

  useEffect(() => { mounted.current = true; load(); return () => { mounted.current = false; }; }, [load]);

  if (state.status === 'ready' && state.identity) {
    const identity = state.identity;
    return (
      <AmalPreferencesProvider key={identity.id} i18n={i18n} userId={identity.id}>
        <ToastProvider>
          <AppShell
            identity={identity}
            fixture={identityAdapter.mode === 'fixture'}
            onRefresh={refresh}
            onLogout={async () => {
              await identityAdapter.logout();
              if (mounted.current) setState({ status: 'ready', identity: null });
            }}
          />
        </ToastProvider>
      </AmalPreferencesProvider>
    );
  }

  return (
    <AmalPreferencesProvider key="anonymous" i18n={i18n} userId={null}>
      {state.status === 'loading' ? <ShellLoading /> : <SessionState kind={state.status === 'error' ? 'error' : 'signedOut'} onRetry={load} />}
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

function SessionState({ kind, onRetry }: { kind: 'error' | 'signedOut'; onRetry: () => void }) {
  const { t } = useTranslation();
  const h1 = useRef<HTMLDivElement>(null);
  useEffect(() => { document.title = `${t(`shell.states.${kind}.title`)} · ${t('app.name')}`; }, [kind, t]);
  return (
    <main className="shell-session" ref={h1} data-testid={`state-${kind}`}>
      <AmalLogo />
      <EmptyState
        headingLevel={1}
        title={t(`shell.states.${kind}.title`)}
        description={t(`shell.states.${kind}.desc`)}
        actions={<Button onClick={onRetry} data-testid="button-retry-identity">{t(`shell.states.${kind}.retry`)}</Button>}
      />
    </main>
  );
}
