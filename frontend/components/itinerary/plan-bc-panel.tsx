'use client';

import { useState } from 'react';
import { X, ArrowLeftRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from '@/components/ui/category-badge';
import type { ItineraryOrderedPlace, AlternativePlace } from '@/types';
import { cn } from '@/lib/utils';

interface PlanBCPanelProps {
  open: boolean;
  originalPlace: ItineraryOrderedPlace | null;
  alternatives: AlternativePlace[] | undefined;
  onClose: () => void;
  onReplace: (originalPlaceId: string, newPlace: AlternativePlace) => Promise<void>;
}

const PLAN_LABELS = ['플랜 B', '플랜 C'];

export function PlanBCPanel({ open, originalPlace, alternatives, onClose, onReplace }: PlanBCPanelProps) {
  const [isReplacing, setIsReplacing] = useState(false);

  const handleReplace = async (originalPlaceId: string, alt: AlternativePlace) => {
    setIsReplacing(true);
    try {
      await onReplace(originalPlaceId, alt);
    } finally {
      setIsReplacing(false);
    }
  };

  return (
    <>
      {/* 오버레이 */}
      {open && (
        <div
          className="fixed inset-0 bg-black/30 z-40"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* 슬라이드 패널 */}
      <div
        className={cn(
          'fixed top-0 right-0 h-full w-80 max-w-full bg-background border-l shadow-xl z-50',
          'flex flex-col transition-transform duration-300 ease-in-out',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        {/* 헤더 */}
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <h2 className="text-sm font-bold">대안 장소</h2>
          <Button variant="ghost" size="icon" onClick={onClose} className="size-8">
            <X className="size-4" />
          </Button>
        </div>

        {originalPlace && (
          <div className="flex flex-col gap-4 p-4 overflow-y-auto flex-1">
            {/* 현재 장소 */}
            <div className="flex flex-col gap-1.5">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">현재 장소</p>
              <div className="rounded-lg border bg-muted/30 p-3 flex flex-col gap-1">
                <span className="text-sm font-semibold">{originalPlace.name}</span>
                <CategoryBadge category={originalPlace.category} />
              </div>
            </div>

            {/* 대안 목록 */}
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">대안 장소</p>

              {!alternatives || alternatives.length === 0 ? (
                <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
                  주변에 대안 장소가 없습니다
                </div>
              ) : (
                alternatives.map((alt, idx) => (
                  <div key={alt.kakao_place_id} className="rounded-lg border bg-card p-3 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1 flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-bold text-muted-foreground bg-muted rounded px-1.5 py-0.5">
                            {PLAN_LABELS[idx] ?? `플랜 ${idx + 2}`}
                          </span>
                        </div>
                        <span className="text-sm font-semibold truncate">{alt.name}</span>
                        <CategoryBadge category={alt.category as import('@/types').PlaceCategory} />
                        {alt.address && (
                          <p className="text-xs text-muted-foreground">{alt.address}</p>
                        )}
                        <p className="text-xs text-muted-foreground">{alt.distance_m}m 이내</p>
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="w-full"
                      disabled={isReplacing}
                      onClick={() => handleReplace(originalPlace.place_id, alt)}
                    >
                      <ArrowLeftRight className="size-3 mr-1.5" />
                      {isReplacing ? '대체 중...' : '대체하기'}
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
