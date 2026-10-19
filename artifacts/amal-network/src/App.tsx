import { type ReactNode } from 'react';
import { AmalPreferencesProvider, ToastProvider } from '@workspace/amal-ui';
import { ErrorBoundary } from '@/components/error-boundary';
import { i18n } from './i18n';
import UiKitPage from '@/pages/ui-kit/UiKitPage';
import NotFound from '@/pages/not-found';
import { Redirect, Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/"><Redirect to="/ui-kit" replace /></Route>
        <Route path="/ui-kit" component={UiKitPage} />
        <Route component={NotFound} />
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
    <AmalPreferencesProvider i18n={i18n}>
      <ToastProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
      </ToastProvider>
    </AmalPreferencesProvider>
  );
}

export default App;
