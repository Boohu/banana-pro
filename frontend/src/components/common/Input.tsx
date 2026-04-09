import React, { InputHTMLAttributes } from 'react';
import { cn } from './Button';

export const Input = React.forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'flex h-11 w-full rounded-2xl border-none bg-surface-tertiary px-4 py-2 text-sm text-fg-primary ring-offset-white placeholder:text-fg-muted focus:outline-none focus:ring-2 focus:ring-primary/20 focus:bg-surface-secondary transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-50',
          className
        )}
        {...props}
      />
    );
  }
);
