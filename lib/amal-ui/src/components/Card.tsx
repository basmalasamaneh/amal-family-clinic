import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../cx';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  tone?: 'surface' | 'muted';
  as?: 'section' | 'article' | 'div';
}

export function Card({ tone = 'surface', as: Tag = 'section', className, ...rest }: CardProps) {
  return <Tag className={cx('amal-card', tone === 'muted' && 'amal-card--muted', className)} {...rest} />;
}

export interface CardHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Heading level for document outline. */
  level?: 2 | 3 | 4;
  titleId?: string;
}

export function CardHeader({ title, description, actions, level = 3, titleId }: CardHeaderProps) {
  const H = `h${level}` as 'h2' | 'h3' | 'h4';
  return (
    <div className="amal-card__header">
      <div>
        <H id={titleId} className="amal-card__title">{title}</H>
        {description && <p className="amal-card__desc">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

export const CardBody = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('amal-card__body', className)} {...rest} />
);
export const CardFooter = ({ className, ...rest }: HTMLAttributes<HTMLDivElement>) => (
  <div className={cx('amal-card__footer', className)} {...rest} />
);
