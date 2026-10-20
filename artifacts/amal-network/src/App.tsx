import { type ReactNode } from 'react';
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

function App() {
  return (
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <Router />
    </WouterRouter>
  );
}

export default App;
