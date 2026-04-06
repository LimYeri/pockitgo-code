'use client';

import { Star, Pin, Calendar, Clock, LogIn, LogOut, Trash2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from '@/components/ui/category-badge';
import type { Place, SchedulePin } from '@/types';
import { cn } from '@/lib/utils';

function getDayNumber(targetDate: string, startDate: string): number {
  const diff = new Date(targetDate).getTime() - new Date(startDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

interface PlaceCardProps {
  place: Place;
  pin: SchedulePin | null;
  stay: SchedulePin | null;
  startDate: string;
  memberNickname: string;
  onToggleMustVisit: () => void;
  onOpenPinModal: () => void;
  onOpenStayModal: () => void;
  onDelete: () => void;
}

export function PlaceCard({
  place,
  pin,
  stay,
  startDate,
  memberNickname,
  onToggleMustVisit,
  onOpenPinModal,
  onOpenStayModal,
  onDelete,
}: PlaceCardProps) {
  const isAccommodation = place.category === '숙소';

  return (
    <Card className={cn('transition-colors', place.is_must_visit && 'ring-1 ring-amber-400')}>
      <CardContent className="flex flex-col gap-2 py-3">
        {/* 상단: 카테고리 뱃지 + 장소명 + 필수 방문 버튼 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-col gap-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <CategoryBadge category={place.category} />
              <span className="text-sm font-medium text-foreground truncate">{place.name}</span>
            </div>
            {memberNickname && (
              <span className="text-xs text-muted-foreground">추가: {memberNickname}</span>
            )}
          </div>

          {/* 버튼 영역: 필수 방문 토글 + 삭제 */}
          <div className="flex items-center gap-0.5 shrink-0">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onToggleMustVisit}
              title={place.is_must_visit ? '필수 방문 해제' : '필수 방문 설정'}
            >
              <Star
                className={cn(
                  'size-4',
                  place.is_must_visit ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground'
                )}
              />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={onDelete}
              title="장소 삭제"
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        </div>

        {/* 메모 */}
        {place.memo && (
          <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{place.memo}</p>
        )}

        {/* 하단: 핀/숙소 정보 */}
        <div className="flex items-center justify-between gap-2">
          {isAccommodation ? (
            /* 숙소: 체크인/아웃 정보 또는 등록 버튼 */
            stay ? (
              <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <LogIn className="size-3" />
                  체크인: {stay.pinned_date} ({getDayNumber(stay.pinned_date!, startDate)}일차)
                </span>
                {stay.checkout_date && (
                  <span className="flex items-center gap-1">
                    <LogOut className="size-3" />
                    체크아웃: {stay.checkout_date} ({getDayNumber(stay.checkout_date, startDate)}일차)
                  </span>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <span className="text-xs text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded">
                  날짜 미등록
                </span>
                <Button variant="outline" size="sm" onClick={onOpenStayModal} className="text-xs h-7">
                  숙소 등록
                </Button>
              </div>
            )
          ) : (
            /* 일반 장소: 고정 핀 정보 또는 등록 버튼 */
            pin ? (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Pin className="size-3 fill-primary text-primary" />
                <span className="flex items-center gap-1">
                  <Calendar className="size-3" />
                  {pin.pinned_date}
                </span>
                {pin.pinned_time && (
                  <span className="flex items-center gap-1">
                    <Clock className="size-3" />
                    {pin.pinned_time}
                  </span>
                )}
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={onOpenPinModal}
                title="고정 핀 등록"
                className="text-muted-foreground hover:text-foreground"
              >
                <Pin className="size-4" />
              </Button>
            )
          )}
        </div>
      </CardContent>
    </Card>
  );
}
