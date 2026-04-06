import { type PlaceCategory } from '@/types';
import { cn } from '@/lib/utils';

const categoryConfig: Record<PlaceCategory, { label: string; className: string }> = {
  '맛집': { label: '맛집', className: 'bg-red-100 text-red-700' },
  '카페': { label: '카페', className: 'bg-amber-100 text-amber-700' },
  '관광지': { label: '관광지', className: 'bg-blue-100 text-blue-700' },
  '숙소': { label: '숙소', className: 'bg-purple-100 text-purple-700' },
  '액티비티': { label: '액티비티', className: 'bg-green-100 text-green-700' },
};

interface CategoryBadgeProps {
  category: PlaceCategory;
  className?: string;
}

export function CategoryBadge({ category, className }: CategoryBadgeProps) {
  const config = categoryConfig[category];
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
