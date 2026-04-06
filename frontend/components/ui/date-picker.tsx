'use client';

import { cn } from '@/lib/utils';

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  min?: string;
  max?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  className?: string;
}

export function DatePicker({
  value,
  onChange,
  label,
  min,
  max,
  error,
  required,
  disabled,
  className,
}: DatePickerProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label && (
        <label className="text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </label>
      )}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        aria-invalid={!!error}
        className={cn(
          'h-9 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm text-foreground',
          'focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          error && 'border-destructive focus:ring-destructive/20'
        )}
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
