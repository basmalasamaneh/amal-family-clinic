/**
 * @workspace/amal-ui — Amal Family Clinic Group design foundation.
 * Styles: import '@workspace/amal-ui/styles.css' once at the app entry.
 * Tokens: '@workspace/amal-ui/tokens.json' (canonical DTCG source).
 */
export { createAmalI18n, amalUiResources, directionFor, AMAL_UI_NS, AMAL_LOCALES, DEFAULT_LOCALE, type AmalLocale } from './i18n';
export { AmalPreferencesProvider, useAmalPreferences } from './preferences/PreferencesProvider';
export { browserPreferenceStorage, DEFAULT_DISPLAY, type DisplayPreferences, type DigitPreference, type PreferenceStorage } from './preferences/account-storage';
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
export { AmalIcons, Icon, IconChip, DIRECTIONAL_ICONS, ICON_STROKE, type AmalIconName, type AmalSection, type IconProps } from './icons';
export { PageHeader, Breadcrumbs, SectionCard, InfoCard, StatCard, type PageHeaderProps, type Crumb, type SectionCardProps, type StatCardProps } from './components/Layout';
export { Avatar, avatarHue, initials, ConsentBadge, KeyAlertChip, Phone, Bidi, type ConsentState } from './components/Identity';
export { DataTable, Skeleton, FilterBar, Timeline, type Column, type DataTableProps, type TimelineItem } from './components/Data';
export { Tabs, Stepper, ConfirmDialog, FormField, type TabItem, type StepperProps, type ConfirmDialogProps, type FormFieldProps } from './components/Interaction';
export { DensitySwitch } from './components/DensitySwitch';
export { DENSITIES, type Density } from './preferences/account-storage';
export { applyDocumentDensity } from './preferences/storage';
