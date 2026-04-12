'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { ArrowLeft, AlertTriangle, Plus, ChevronDown } from 'lucide-react';
import { DndContext, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { TimelineCard } from '@/components/itinerary/timeline-card';
import { ItineraryAddPlaceModal } from '@/components/itinerary/itinerary-add-place-modal';
import { PlanBCPanel } from '@/components/itinerary/plan-bc-panel';
import ItineraryMap from '@/components/itinerary/itinerary-map';
import { CategoryBadge } from '@/components/ui/category-badge';
import { Button } from '@/components/ui/button';
import type { TravelRoom, Itinerary } from '@/types';
import { useItinerarySchedules } from '@/lib/use-itinerary';
import { cn } from '@/lib/utils';

// SSR 충돌 방지를 위해 동적 임포트
const PdfDownloadButton = dynamic(
  () => import('@/components/pdf/PdfDownloadButton').then((m) => m.PdfDownloadButton),
  { ssr: false, loading: () => <span className="text-xs text-muted-foreground">로딩 중...</span> },
);

interface ItineraryClientProps {
  room: TravelRoom;
  itinerary: Itinerary[];
  hasStay: boolean;
}

export default function ItineraryClient({ room, itinerary, hasStay }: ItineraryClientProps) {
  const {
    schedules,
    activeDateIdx,
    setActiveDateIdx,
    planBCTarget,
    setPlanBCTarget,
    activeDay,
    planBCAlternatives,
    excludedPlaces,
    handleReplace,
    handleDragEnd,
    addPlaceDate,
    setAddPlaceDate,
    handleAddedPlace,
    handleRemovePlace,
  } = useItinerarySchedules(itinerary, room);

  const allWarnings = Array.from(
    new Set(schedules.flatMap((day) => day.validation_warnings ?? []))
  );
  const [isWarningOpen, setIsWarningOpen] = useState(false);

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
        <div className="flex items-center gap-2 ml-auto">
          <PdfDownloadButton
            room={room}
            schedules={schedules}
            excludedPlaces={excludedPlaces}
          />
          <div className="flex flex-col gap-0.5 text-right">
            <h1 className="text-lg font-bold">{room.title}</h1>
            <p className="text-xs text-muted-foreground">
              {room.destination} · {room.start_date} ~ {room.end_date}
            </p>
          </div>
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
          <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
            <span>{activeDay?.date} 일정 ({activeDay?.ordered_places.length ?? 0}곳)</span>
            {(() => {
              const totalMin = activeDay?.ordered_places.reduce(
                (sum, p) => sum + (p.travel_time_after ?? 0),
                0,
              ) ?? 0;
              if (totalMin <= 0) return null;
              const h = Math.floor(totalMin / 60);
              const m = totalMin % 60;
              const label = h > 0 ? (m > 0 ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
              return (
                <span className="text-xs font-normal text-muted-foreground/70">
                  총 이동 {label}
                </span>
              );
            })()}
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
                  onRemove={() => handleRemovePlace(activeDay.date, place.place_id)}
                />
              ))}
            </SortableContext>
          </DndContext>

          {/* 장소 추가 버튼 */}
          {activeDay && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddPlaceDate(activeDay.date)}
              className="mt-2 w-full border-dashed text-muted-foreground hover:text-foreground"
            >
              <Plus className="size-4 mr-1.5" />
              장소 추가
            </Button>
          )}
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

      {/* 검증 알림 + 방문 불가 장소 (클릭 시 펼침) */}
      {(allWarnings.length > 0 || excludedPlaces.length > 0) && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
          <button
            onClick={() => setIsWarningOpen((prev) => !prev)}
            className="w-full flex items-center justify-between p-4 text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <div className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span className="text-sm font-semibold">
                일정 검증 알림
                {allWarnings.length > 0 && ` (${allWarnings.length}건)`}
                {excludedPlaces.length > 0 && ` · 방문 불가 (${excludedPlaces.length}곳)`}
              </span>
            </div>
            <ChevronDown
              className={cn('size-4 shrink-0 transition-transform duration-200', isWarningOpen && 'rotate-180')}
            />
          </button>
          {isWarningOpen && (
            <div className="px-4 pb-4 flex flex-col gap-3">
              {allWarnings.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {allWarnings.map((warning, idx) => (
                    <p key={idx} className="text-xs text-blue-600 leading-relaxed">• {warning}</p>
                  ))}
                </div>
              )}
              {excludedPlaces.length > 0 && (
                <div className="flex flex-col gap-2">
                  {allWarnings.length > 0 && <hr className="border-blue-200" />}
                  <p className="text-xs font-semibold text-blue-700">
                    방문 불가 장소 ({excludedPlaces.length}곳)
                  </p>
                  <p className="text-xs text-blue-500">
                    여행 기간 내 운영시간·휴무일 문제로 일정에서 제외된 장소입니다.
                  </p>
                  <div className="flex flex-col gap-1.5">
                    {excludedPlaces.map((place) => (
                      <div key={place.id} className="flex items-center gap-2">
                        <CategoryBadge category={place.category as import('@/types').PlaceCategory} />
                        <span className="text-sm text-blue-700">{place.name}</span>
                        {place.reason && (
                          <span className="text-xs text-blue-500">({place.reason})</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
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

      {/* 장소 추가 모달 */}
      {addPlaceDate && (
        <ItineraryAddPlaceModal
          open={addPlaceDate !== null}
          onClose={() => setAddPlaceDate(null)}
          onAdded={handleAddedPlace}
          roomId={room.id}
          date={addPlaceDate}
        />
      )}
    </div>
  );
}
