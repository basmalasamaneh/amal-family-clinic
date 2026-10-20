import { type ReactNode } from 'react';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { isAuthFailure, isUnauthorized } from '@/auth/errors';
import { reportUnauthorized } from '@/auth/session-events';
import { AmalPreferencesProvider, ToastProvider } from '@workspace/amal-ui';
import { ErrorBoundary } from '@/components/error-boundary';
import { i18n } from './i18n';
import UiKitPage from '@/pages/ui-kit/UiKitPage';
import { ShellRoot } from '@/shell/ShellRoot';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

/** /ui-kit keeps its anonymous P2-00 preferences; every other path is the role-aware shell. */
function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/ui-kit">
          <AmalPreferencesProvider i18n={i18n}>
            <ToastProvider><UiKitPage /></ToastProvider>
          </AmalPreferencesProvider>
        </Route>
        <Route><ShellRoot /></Route>
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

const onError = (e: unknown) => { if (isUnauthorized(e)) reportUnauthorized(); };
/** 401 anywhere ends the session once; auth failures are never retried. */
const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: { queries: { retry: (n, e) => !isAuthFailure(e) && n < 2, refetchOnWindowFocus: false }, mutations: { retry: false } },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Router />
    </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
