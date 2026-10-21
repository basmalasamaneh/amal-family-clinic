import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'wouter';
import { AlertTriangle, Building2, Eye, EyeOff, KeyRound, LockKeyhole, MonitorSmartphone, RotateCw, ShieldCheck } from 'lucide-react';
import { getReceptionContext, login, loginPin, setCsrfToken } from '@workspace/api-client-react';
import { AmalLogo, Button, LanguageSwitch, Segmented, ThemeSwitch, TextField } from '@workspace/amal-ui';
import { describeApiError, type DescribedError } from '@/auth/errors';
import { isPlausibleEmail, isValidPin, normalizePin } from '@/auth/digits';

type Mode = 'password' | 'pin';
type Ctx = { status: 'loading' } | { status: 'trusted'; clinic: { id: number; name: string } } | { status: 'untrusted' } | { status: 'error' };
interface Props { notice: 'expired' | null; onAuthenticated: () => Promise<void> }

// Wait for React to commit the localized error descriptions before moving
// focus, so assistive technology reads the invalid field and its explanation.
function focusInvalidField(form: HTMLFormElement) {
  requestAnimationFrame(() => {
    if (form.isConnected) form.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  });
}

/** Real-API login. Credentials live only in component state; nothing is stored, logged or put in URLs. */
export function LoginPage({ notice, onAuthenticated }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useState<Mode>('password');
  const [submitting, setSubmitting] = useState(false);
  return (
    <div className="auth" data-testid="page-login">
      <a href="#auth-main" className="shell-skip">{t('shell.skip')}</a>
      <aside className="auth-brand" aria-hidden="true">
        <div className="auth-brand__arcs" />
        <p className="auth-brand__kicker">{t('auth.brand.kicker')}</p>
        <p className="auth-brand__line">{t('auth.brand.line')}</p>
        <p className="auth-brand__sub">{t('auth.brand.sub')}</p>
      </aside>
      <div className="auth-side">
        <header className="auth-top">
          <AmalLogo />
          <div className="auth-top__prefs"><LanguageSwitch /><ThemeSwitch /></div>
        </header>
        <main id="auth-main" tabIndex={-1} className="auth-main">
          <h1 className="auth-title">{t('auth.title')}</h1>
          <p className="auth-lede">{t('auth.lede')}</p>
          {notice === 'expired' && (
            <p className="auth-notice" role="status" data-testid="status-session-expired"><LockKeyhole size={18} aria-hidden="true" />{t('auth.expired')}</p>
          )}
          <fieldset className="auth-mode" disabled={submitting}>
          <Segmented
            label={t('auth.mode.label')}
            value={mode}
            onChange={(v: Mode) => setMode(v)}
            options={[
              { value: 'password', label: t('auth.mode.password'), icon: <KeyRound size={16} aria-hidden="true" />, testId: 'button-mode-password' },
              { value: 'pin', label: t('auth.mode.pin'), icon: <MonitorSmartphone size={16} aria-hidden="true" />, testId: 'button-mode-pin' },
            ]}
          />
          </fieldset>
          {mode === 'password' ? <PasswordForm onAuthenticated={onAuthenticated} onPending={setSubmitting} /> : <PinForm onAuthenticated={onAuthenticated} onPending={setSubmitting} />}
          <Link href="/data" className="auth-data" data-testid="link-login-data">
            <ShieldCheck size={22} aria-hidden="true" />
            <span><strong>{t('data.title')}</strong><small>{t('auth.dataLink')}</small></span>
          </Link>
        </main>
      </div>
    </div>
  );
}


function useSubmit(onAuthenticated: () => Promise<void>, onPending: (value: boolean) => void) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DescribedError | null>(null);
  const run = async (call: () => Promise<{ csrfToken: string }>) => {
    if (busy.current) return false;
    busy.current = true; setPending(true); onPending(true); setError(null);
    try {
      const id = await call();
      setCsrfToken(id.csrfToken);
      await onAuthenticated();
      return true;
    } catch (e) {
      setError(describeApiError(e));
      return false;
    } finally { busy.current = false; setPending(false); onPending(false); }
  };
  return { pending, error, run };
}

function ErrorBox({ error, mode }: { error: DescribedError; mode: Mode }) {
  const { t } = useTranslation();
  const key = error.key === 'unauthorized' ? `auth.errors.unauthorized.${mode}` : `error.${error.key}`;
  return (
    <div className="auth-error" role="alert" data-testid="status-login-error" data-error={error.key}>
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <p>{t(key)}</p>
        {error.retryMinutes !== null && <p className="auth-error__sub">{t('auth.errors.retryAfter', { count: error.retryMinutes })}</p>}
      </div>
    </div>
  );
}

function PasswordForm({ onAuthenticated, onPending }: { onAuthenticated: () => Promise<void>; onPending: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const { pending, error, run } = useSubmit(onAuthenticated, onPending);
  const emailErr = touched && !isPlausibleEmail(email.trim()) ? t('auth.validation.email') : undefined;
  const pwErr = touched && (password.length < 1 || password.length > 72) ? t('auth.validation.password') : undefined;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setTouched(true);
    if (!isPlausibleEmail(email.trim()) || password.length < 1 || password.length > 72) {
      focusInvalidField(e.currentTarget); return;
    }
    const ok = await run(() => login({ email: email.trim(), password }));
    if (!ok) setPassword('');
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={pending} data-testid="form-password">
      <p className="auth-form__hint">{t('auth.password.hint')}</p>
      <TextField label={t('auth.email')} type="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr} data-testid="input-email" />
      <div className="auth-pw">
        <TextField label={t('auth.password.label')} type={show ? 'text' : 'password'} autoComplete="current-password" dir="ltr" required maxLength={72} value={password} onChange={(e) => setPassword(e.target.value)} error={pwErr} data-testid="input-password" id="auth-password" />
        <button type="button" className="auth-pw__toggle" aria-pressed={show} aria-controls="auth-password" onClick={() => setShow(!show)} data-testid="button-toggle-password">
          {show ? <EyeOff size={16} aria-hidden="true" /> : <Eye size={16} aria-hidden="true" />}{show ? t('auth.password.hide') : t('auth.password.show')}
        </button>
      </div>
      {error && <ErrorBox error={error} mode="password" />}
      <Button type="submit" size="lg" loading={pending} disabled={pending} data-testid="button-submit-password">{pending ? t('auth.pending') : t('auth.submit')}</Button>
    </form>
  );
}

function PinForm({ onAuthenticated, onPending }: { onAuthenticated: () => Promise<void>; onPending: (value: boolean) => void }) {
  const { t } = useTranslation();
  const [ctx, setCtx] = useState<Ctx>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [email, setEmail] = useState('');
  const [pin, setPin] = useState('');
  const [touched, setTouched] = useState(false);
  const { pending, error, run } = useSubmit(onAuthenticated, onPending);

  useEffect(() => {
    let live = true;
    setCtx({ status: 'loading' });
    getReceptionContext().then(
      (r) => { if (live) setCtx(r?.clinic && Number.isSafeInteger(r.clinic.id) && typeof r.clinic.name === 'string' ? { status: 'trusted', clinic: r.clinic } : { status: 'error' }); },
      (e) => { if (!live) return; const d = describeApiError(e); setCtx(d.key === 'deviceUntrusted' || d.status === 403 ? { status: 'untrusted' } : { status: 'error' }); },
    );
    return () => { live = false; };
  }, [attempt]);

  if (ctx.status === 'loading') {
    return <div className="auth-ctx auth-ctx--loading" role="status" data-testid="status-device-loading"><span className="shell-sr">{t('auth.pin.checking')}</span><span className="shell-skel auth-skel" aria-hidden="true" /><span className="shell-skel auth-skel auth-skel--short" aria-hidden="true" /></div>;
  }
  if (ctx.status !== 'trusted') {
    const k = ctx.status === 'untrusted' ? 'untrusted' : 'ctxError';
    return (
      <div className="auth-ctx auth-ctx--warn" role="alert" data-testid={ctx.status === 'untrusted' ? 'status-device-untrusted' : 'status-device-error'}>
        <MonitorSmartphone size={24} aria-hidden="true" />
        <div>
          <p className="auth-ctx__title">{t(`auth.pin.${k}.title`)}</p>
          <p>{t(`auth.pin.${k}.desc`)}</p>
          <Button variant="secondary" size="sm" onClick={() => setAttempt((a) => a + 1)} startIcon={<RotateCw size={16} aria-hidden="true" />} data-testid="button-device-retry">{t('auth.pin.recheck')}</Button>
        </div>
      </div>
    );
  }

  const emailErr = touched && !isPlausibleEmail(email.trim()) ? t('auth.validation.email') : undefined;
  const pinErr = touched && !isValidPin(pin) ? t('auth.validation.pin') : undefined;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setTouched(true);
    if (!isPlausibleEmail(email.trim()) || !isValidPin(pin)) {
      focusInvalidField(e.currentTarget); return;
    }
    const ok = await run(() => loginPin({ email: email.trim(), pin }));
    if (!ok) setPin('');
  };
  return (
    <form className="auth-form" onSubmit={submit} noValidate aria-busy={pending} data-testid="form-pin">
      <div className="auth-ctx" data-testid="text-trusted-clinic">
        <Building2 size={22} aria-hidden="true" />
        <div>
          <p className="auth-ctx__label">{t('auth.pin.clinicLabel')}</p>
          <p className="auth-ctx__title"><bdi>{ctx.clinic.name}</bdi></p>
          <p className="auth-ctx__note">{t('auth.pin.clinicNote')}</p>
        </div>
      </div>
      <TextField label={t('auth.email')} type="email" autoComplete="username" dir="ltr" required value={email} onChange={(e) => setEmail(e.target.value)} error={emailErr} hint={t('auth.pin.emailHint')} data-testid="input-pin-email" />
      <TextField
        label={t('auth.pin.label')} type="password" inputMode="numeric" autoComplete="off" dir="ltr" required maxLength={8}
        className="auth-pin" value={pin} onChange={(e) => setPin(normalizePin(e.target.value))} error={pinErr} hint={t('auth.pin.hint')} data-testid="input-pin"
      />
      {error && <ErrorBox error={error} mode="pin" />}
      <Button type="submit" size="lg" loading={pending} disabled={pending} data-testid="button-submit-pin">{pending ? t('auth.pending') : t('auth.submit')}</Button>
    </form>
  );
}
