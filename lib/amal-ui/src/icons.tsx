import type { LucideIcon, LucideProps } from 'lucide-react';
import { cx } from './cx';
import { AmalIcons, DIRECTIONAL_ICONS, type AmalIconName, type AmalSection } from './icon-map';
export { AmalIcons, DIRECTIONAL_ICONS, type AmalIconName, type AmalSection };

export const ICON_STROKE = 1.75;

export interface IconProps extends Omit<LucideProps, 'ref'> { name: AmalIconName }
export function Icon({ name, size = 18, className, ...rest }: IconProps) {
  const C = AmalIcons[name];
  return <C size={size} strokeWidth={ICON_STROKE} aria-hidden="true" className={cx(DIRECTIONAL_ICONS.has(name) && 'amal-icon--mirror', className)} {...rest} />;
}

/** Colored icon chip; section accent is used only for chips and small highlights, never status. */
export function IconChip({ icon, section = 'reception', size = 'md', className }: { icon: LucideIcon | AmalIconName; section?: AmalSection; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const C = typeof icon === 'string' ? AmalIcons[icon] : icon;
  const px = size === 'sm' ? 15 : size === 'lg' ? 22 : 18;
  return <span className={cx('amal-chip', `amal-chip--${size}`, className)} data-section={section} aria-hidden="true"><C size={px} strokeWidth={ICON_STROKE} /></span>;
}
