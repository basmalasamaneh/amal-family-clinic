/**
 * @workspace/amal-ui — Amal Family Clinic Group design foundation.
 * Styles: import '@workspace/amal-ui/styles.css' once at the app entry.
 * Tokens: '@workspace/amal-ui/tokens.json' (canonical DTCG source).
 */
export { createAmalI18n, amalUiResources, directionFor, AMAL_UI_NS, AMAL_LOCALES, DEFAULT_LOCALE, type AmalLocale } from './i18n';
export { AmalPreferencesProvider, useAmalPreferences } from './preferences/PreferencesProvider';
export { applyDocumentPreferences, readStoredLocale, readStoredTheme, LOCALE_KEY, THEME_KEY, type AmalTheme } from './preferences/storage';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './components/Button';
export { TextField, type TextFieldProps } from './components/TextField';
export { Card, CardHeader, CardBody, CardFooter, type CardProps, type CardHeaderProps } from './components/Card';
export { StatusBadge, APPOINTMENT_STATUSES, type AppointmentStatus, type StatusBadgeProps } from './components/StatusBadge';
export { EmptyState, EmptyIllustration, type EmptyStateProps } from './components/EmptyState';
export { ToastProvider, useToast, type ToastInput, type ToastTone } from './components/Toast';
export { LanguageSwitch, ThemeSwitch } from './components/PreferenceControls';
export { Segmented, type SegmentOption } from './components/Segmented';
export { AmalLogo, AmalMark } from './components/Logo';
export { cx } from './cx';
