import { GripVertical, BookOpen } from 'lucide-react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Button } from '@/components/ui/button';
import type { ItineraryOrderedPlace, AlternativePlace } from '@/types';
import { cn } from '@/lib/utils';

interface TimelineCardProps {
  place: ItineraryOrderedPlace;
  order: number;
  travelTimeAfter: number | null; // 다음 장소까지 이동 시간(분), 마지막 장소는 null
  alternatives: AlternativePlace[] | undefined;
  onOpenPlanBC: (place: ItineraryOrderedPlace) => void;
}

export function TimelineCard({
  place,
  order,
  travelTimeAfter,
  alternatives,
  onOpenPlanBC,
}: TimelineCardProps) {
  const hasAlternatives = alternatives && alternatives.length > 0;
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: place.place_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} className="flex flex-col">
      {/* 장소 카드 */}
      <div className="flex items-start gap-3 rounded-xl border bg-card p-3">
        {/* 드래그 핸들 */}
        <div className="mt-1 cursor-grab text-muted-foreground/40 shrink-0" {...listeners}>
          <GripVertical className="size-4" />
        </div>

        {/* 순서 번호 */}
        <div className="size-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold shrink-0 mt-0.5">
          {order}
        </div>

        {/* 장소 정보 */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <span className="text-sm font-semibold truncate">{place.name}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onOpenPlanBC(place)}
              className={cn(
                'h-7 px-2 text-xs shrink-0',
                hasAlternatives ? 'text-primary' : 'text-muted-foreground'
              )}
              title="대안 장소 보기"
            >
              <BookOpen className="size-3 mr-1" />
              대안
            </Button>
          </div>
          <CategoryBadge category={place.category} />
          {place.scheduled_time && (
            <p className="text-xs text-muted-foreground">{place.scheduled_time}</p>
          )}
        </div>
      </div>

      {/* 이동 시간 표시 */}
      {travelTimeAfter !== null && (
        <div className="flex items-center gap-2 pl-14 py-1.5">
          <div className="w-px h-4 bg-border" />
          <span className="text-xs text-muted-foreground">약 {travelTimeAfter}분 이동</span>
        </div>
      )}
    </div>
  );
}
