import React, { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export { cn } from '@/lib/utils';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', ...props }, ref) => {
    const variants = {
      primary: 'bg-primary text-white hover:bg-primary/90 shadow-md shadow-primary active:scale-95',
      secondary: 'bg-surface-tertiary text-fg-secondary hover:bg-surface-tertiary active:scale-95',
      danger: 'bg-error/100 text-white hover:bg-error/90 active:scale-95',
      ghost: 'bg-transparent hover:bg-surface-tertiary text-fg-secondary active:scale-95',
    };

    const sizes = {
      sm: 'px-4 py-2 text-xs',
      md: 'px-5 py-2.5 text-sm',
      lg: 'px-8 py-4 text-base font-semibold',
    };

    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center rounded-2xl font-bold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50 disabled:pointer-events-none',
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      />
    );
  }
);
