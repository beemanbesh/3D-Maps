import { type ButtonHTMLAttributes } from 'react';
import { clsx } from 'clsx';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The text label displayed inside the button */
  label: string;
  /** Visual style variant */
  variant?: 'primary' | 'secondary';
  /** Render at a larger size */
  size?: 'default' | 'large';
}

export function Button({
  label,
  variant = 'primary',
  size = 'default',
  className,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        variant === 'primary' ? 'btn-primary' : 'btn-secondary',
        size === 'large' && 'px-6 py-3 text-base',
        className,
      )}
      disabled={disabled}
      {...rest}
    >
      {label}
    </button>
  );
}
