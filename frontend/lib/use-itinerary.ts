'use client';

import { useState } from 'react';
import { type DragEndEvent } from '@dnd-kit/core';
import { arrayMove } from '@dnd-kit/sortable';
import { toast } from 'sonner';
import type { TravelRoom, Itinerary, ItineraryOrderedPlace, AlternativePlace } from '@/types';
import { replaceItineraryPlace, updateItineraryOrder, removeItineraryPlace } from '@/lib/api';

export function useItinerarySchedules(initialItinerary: Itinerary[], room: TravelRoom) {
  const [schedules, setSchedules] = useState<Itinerary[]>(initialItinerary);
  const [activeDateIdx, setActiveDateIdx] = useState(0);
  const [planBCTarget, setPlanBCTarget] = useState<ItineraryOrderedPlace | null>(null);
  const [addPlaceDate, setAddPlaceDate] = useState<string | null>(null);

  const activeDay = schedules[activeDateIdx];
  const planBCAlternatives: AlternativePlace[] | undefined = planBCTarget
    ? activeDay?.alternatives[planBCTarget.place_id]
    : undefined;
  // excluded_places는 모든 날짜에 동일하므로 첫 번째 날짜에서 참조
  const excludedPlaces = schedules[0]?.excluded_places ?? [];

  const handleReplace = async (originalPlaceId: string, newPlace: AlternativePlace) => {
    try {
      const updatedItinerary = await replaceItineraryPlace(
        room.id,
        activeDay.date,
        originalPlaceId,
        newPlace,
      );
      setSchedules((prev) =>
        prev.map((day) => (day.date === updatedItinerary.date ? updatedItinerary : day)),
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
        idx !== activeDateIdx ? day : { ...day, ordered_places: newOrderedPlaces },
      ),
    );

    try {
      const updatedItinerary = await updateItineraryOrder(
        room.id,
        activeDay.date,
        newOrderedPlaces,
      );
      setSchedules((prev) =>
        prev.map((day) => (day.date === updatedItinerary.date ? updatedItinerary : day)),
      );
    } catch (err) {
      console.error('순서 변경 실패, 롤백:', err);
      toast.error('순서 변경에 실패했습니다.');
      // 롤백
      setSchedules((prev) =>
        prev.map((day, idx) =>
          idx !== activeDateIdx ? day : { ...day, ordered_places: oldPlaces },
        ),
      );
    }
  };

  const handleAddedPlace = (updatedDay: Itinerary) => {
    setSchedules((prev) => prev.map((d) => (d.date === updatedDay.date ? updatedDay : d)));
    setAddPlaceDate(null);
  };

  const handleRemovePlace = async (date: string, placeId: string) => {
    const targetDay = schedules.find((d) => d.date === date);
    if (!targetDay) return;

    // 낙관적 제거
    const originalPlaces = targetDay.ordered_places;
    setSchedules((prev) =>
      prev.map((d) =>
        d.date === date
          ? { ...d, ordered_places: d.ordered_places.filter((p) => p.place_id !== placeId) }
          : d,
      ),
    );

    try {
      const updatedDay = await removeItineraryPlace(room.id, date, placeId);
      setSchedules((prev) => prev.map((d) => (d.date === updatedDay.date ? updatedDay : d)));
    } catch (err) {
      console.error('장소 제거 실패, 롤백:', err);
      toast.error('장소 제거에 실패했습니다.');
      // 롤백
      setSchedules((prev) =>
        prev.map((d) => (d.date === date ? { ...d, ordered_places: originalPlaces } : d)),
      );
    }
  };

  return {
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
  };
}
