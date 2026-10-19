import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
  startIcon?: ReactNode;
  endIcon?: ReactNode;
  /** Icon-only square button; requires `aria-label`. */
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, startIcon, endIcon, iconOnly, className, children, disabled, type = 'button', onClick, ...rest },
  ref,
) {
  const { t } = useTranslation(AMAL_UI_NS);
  return (
    <button
      ref={ref}
      type={type}
      className={cx('amal-btn', `amal-btn--${variant}`, size !== 'md' && `amal-btn--${size}`, iconOnly && 'amal-btn--icon', className)}
      disabled={disabled}
      aria-busy={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      {...rest}
    >
      {loading ? <Loader2 size={18} className="amal-spin" aria-hidden="true" /> : startIcon}
      {children}
      {loading && <span className="amal-sr-only">{t('button.loading')}</span>}
      {!loading && endIcon}
    </button>
  );
});
