import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { AMAL_UI_NS } from '../i18n';
import { cx } from '../cx';

export interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'children'> {
  /** Visible, localized label (always rendered — never placeholder-only). */
  label: ReactNode;
  hint?: ReactNode;
  /** Error message; sets aria-invalid and is announced via aria-describedby. */
  error?: ReactNode;
  showOptional?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, required, showOptional, id, className, ...rest },
  ref,
) {
  const { t } = useTranslation(AMAL_UI_NS);
  const auto = useId();
  const inputId = id ?? `amal-field-${auto}`;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errId = error ? `${inputId}-error` : undefined;
  return (
    <div className={cx('amal-field', className)}>
      <label className="amal-field__label" htmlFor={inputId}>
        {label}
        {required && (
          <span className="amal-field__req">
            <span aria-hidden="true">*</span>
            <span className="amal-sr-only">{t('field.required')}</span>
          </span>
        )}
        {!required && showOptional && <span className="amal-field__opt">({t('field.optional')})</span>}
      </label>
      <input
        ref={ref}
        id={inputId}
        className="amal-input"
        dir={rest.type === 'email' || rest.type === 'tel' || rest.type === 'time' ? 'ltr' : undefined}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={[hintId, errId].filter(Boolean).join(' ') || undefined}
        {...rest}
      />
      {hint && <p id={hintId} className="amal-field__hint">{hint}</p>}
      {error && (
        <p id={errId} className="amal-field__error">
          <AlertTriangle size={16} aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  );
});
