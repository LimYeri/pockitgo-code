'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle } from 'lucide-react';
import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { TimelineCard } from '@/components/itinerary/timeline-card';
import { PlanBCPanel } from '@/components/itinerary/plan-bc-panel';
import ItineraryMap from '@/components/itinerary/itinerary-map';
import { CategoryBadge } from '@/components/ui/category-badge';
import type { TravelRoom, Itinerary, ItineraryOrderedPlace, AlternativePlace } from '@/types';
import { replaceItineraryPlace, updateItineraryOrder } from '@/lib/api';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface ItineraryClientProps {
  room: TravelRoom;
  itinerary: Itinerary[];
  hasStay: boolean;
}

export default function ItineraryClient({ room, itinerary, hasStay }: ItineraryClientProps) {
  const [activeDateIdx, setActiveDateIdx] = useState(0);
  const [schedules, setSchedules] = useState<Itinerary[]>(itinerary);
  const [planBCTarget, setPlanBCTarget] = useState<ItineraryOrderedPlace | null>(null);

  const activeDay = schedules[activeDateIdx];

  const handleReplace = async (originalPlaceId: string, newPlace: AlternativePlace) => {
    try {
      const updatedItinerary = await replaceItineraryPlace(room.id, activeDay.date, originalPlaceId, newPlace);
      setSchedules((prev) =>
        prev.map((day) => (day.date === updatedItinerary.date ? updatedItinerary : day))
      );
    } catch (err) {
      console.error('장소 교체 실패:', err);
      toast.error('장소 교체에 실패했습니다.');
    }
    setPlanBCTarget(null);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id || !activeDay) return;

    const oldPlaces = activeDay.ordered_places;
    const oldIdx = oldPlaces.findIndex((p) => p.place_id === String(active.id));
    const newIdx = oldPlaces.findIndex((p) => p.place_id === String(over.id));
    if (oldIdx === -1 || newIdx === -1) return;

    const newOrderedPlaces = arrayMove(oldPlaces, oldIdx, newIdx);

    // 낙관적 업데이트
    setSchedules((prev) =>
      prev.map((day, idx) =>
        idx !== activeDateIdx ? day : { ...day, ordered_places: newOrderedPlaces }
      )
    );

    try {
      const updatedItinerary = await updateItineraryOrder(room.id, activeDay.date, newOrderedPlaces);
      setSchedules((prev) =>
        prev.map((day) => (day.date === updatedItinerary.date ? updatedItinerary : day))
      );
    } catch (err) {
      console.error('순서 변경 실패, 롤백:', err);
      toast.error('순서 변경에 실패했습니다.');
      // 롤백
      setSchedules((prev) =>
        prev.map((day, idx) =>
          idx !== activeDateIdx ? day : { ...day, ordered_places: oldPlaces }
        )
      );
    }
  };

  const planBCAlternatives: AlternativePlace[] | undefined = planBCTarget
    ? activeDay?.alternatives[planBCTarget.place_id]
    : undefined;

  // excluded_places는 모든 날짜에 동일하므로 첫 번째 날짜에서 참조
  const excludedPlaces = schedules[0]?.excluded_places ?? [];

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더 */}
      <div className="flex items-center gap-3">
        <Link
          href={`/room/${room.id}/wishlist`}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />
          위시리스트
        </Link>
        <div className="flex flex-col gap-0.5 ml-auto text-right">
          <h1 className="text-lg font-bold">{room.title}</h1>
          <p className="text-xs text-muted-foreground">
            {room.destination} · {room.start_date} ~ {room.end_date}
          </p>
        </div>
      </div>

      {/* 날짜 탭 */}
      <div className="flex gap-1.5 flex-wrap">
        {schedules.map((day, idx) => (
          <button
            key={day.date}
            onClick={() => setActiveDateIdx(idx)}
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium transition-colors',
              activeDateIdx === idx
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:bg-muted/80'
            )}
          >
            Day {idx + 1} · {day.date}
          </button>
        ))}
      </div>

      {/* 본문: 타임라인 + 지도 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 타임라인 */}
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            {activeDay?.date} 일정 ({activeDay?.ordered_places.length ?? 0}곳)
          </h2>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={activeDay?.ordered_places.map((p) => p.place_id) ?? []}
              strategy={verticalListSortingStrategy}
            >
              {activeDay?.ordered_places.map((place, idx) => (
                <TimelineCard
                  key={place.place_id}
                  place={place}
                  order={idx + 1}
                  travelTimeAfter={place.travel_time_after ?? null}
                  alternatives={activeDay.alternatives[place.place_id]}
                  onOpenPlanBC={setPlanBCTarget}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>

        {/* Kakao 지도 */}
        <ItineraryMap places={activeDay?.ordered_places ?? []} />
      </div>

      {/* 숙소 미등록 힌트 */}
      {!hasStay && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex items-center gap-2">
          <AlertTriangle className="size-4 shrink-0 text-amber-600" />
          <p className="text-sm text-amber-700">
            숙소가 등록되지 않았습니다. 현지 숙소 구역을 직접 검색해 보세요.
          </p>
        </div>
      )}

      {/* 검증 경고 메시지 */}
      {(() => {
        const allWarnings = Array.from(
          new Set(schedules.flatMap((day) => day.validation_warnings ?? []))
        );
        return allWarnings.length > 0 ? (
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2 text-blue-700">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="text-sm font-semibold">일정 검증 알림 ({allWarnings.length}건)</span>
            </div>
            <div className="flex flex-col gap-1.5">
              {allWarnings.map((warning, idx) => (
                <p key={idx} className="text-xs text-blue-600 leading-relaxed">• {warning}</p>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* 방문 불가 장소 */}
      {excludedPlaces.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 text-amber-700">
            <AlertTriangle className="size-4 shrink-0" />
            <span className="text-sm font-semibold">방문 불가 장소 ({excludedPlaces.length}곳)</span>
          </div>
          <p className="text-xs text-amber-600">
            여행 기간 내 운영시간·휴무일 문제로 일정에서 제외된 장소입니다.
          </p>
          <div className="flex flex-col gap-2">
            {excludedPlaces.map((place) => (
              <div key={place.id} className="flex items-center gap-2">
                <CategoryBadge category={place.category as import('@/types').PlaceCategory} />
                <span className="text-sm text-amber-800">{place.name}</span>
                {place.reason && (
                  <span className="text-xs text-amber-600">({place.reason})</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 플랜 B/C 패널 */}
      <PlanBCPanel
        open={planBCTarget !== null}
        originalPlace={planBCTarget}
        alternatives={planBCAlternatives}
        onClose={() => setPlanBCTarget(null)}
        onReplace={handleReplace}
      />
    </div>
  );
}
