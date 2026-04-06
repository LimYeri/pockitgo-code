import { cn } from '@/lib/utils';

const sizeClasses = {
  sm: 'size-4 border-2',
  md: 'size-8 border-2',
  lg: 'size-12 border-4',
};

interface LoadingSpinnerProps {
  size?: keyof typeof sizeClasses;
  className?: string;
  label?: string;
}

export function LoadingSpinner({ size = 'md', className, label = '로딩 중' }: LoadingSpinnerProps) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        'animate-spin rounded-full border-current border-t-transparent',
        sizeClasses[size],
        className
      )}
    />
  );
}
