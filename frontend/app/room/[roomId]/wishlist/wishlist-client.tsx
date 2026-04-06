'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, ChevronLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { PlaceCard } from '@/components/wishlist/place-card';
import { PlaceSearchModal } from '@/components/wishlist/place-search-modal';
import { PinRegisterModal } from '@/components/wishlist/pin-register-modal';
import { StayRegisterModal } from '@/components/wishlist/stay-register-modal';
import {
  getRoom,
  getPlaces,
  getPins,
  getMembers,
  updatePlace,
  deletePlace,
  createPin,
} from '@/lib/api';
import { subscribeToPlaces } from '@/lib/supabase';
import type { Place, SchedulePin, PlaceCategory, TravelRoom, Member } from '@/types';
import { cn } from '@/lib/utils';

interface WishlistClientProps {
  roomId: string;
}

const CATEGORIES: Array<{ value: PlaceCategory | 'all'; label: string }> = [
  { value: 'all', label: '전체' },
  { value: '맛집', label: '맛집' },
  { value: '카페', label: '카페' },
  { value: '관광지', label: '관광지' },
  { value: '숙소', label: '숙소' },
  { value: '액티비티', label: '액티비티' },
];

export default function WishlistClient({ roomId }: WishlistClientProps) {
  const [room, setRoom] = useState<TravelRoom | null>(null);
  const [places, setPlaces] = useState<Place[]>([]);
  const [pins, setPins] = useState<SchedulePin[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [activeCategory, setActiveCategory] = useState<PlaceCategory | 'all'>('all');
  const [isLoading, setIsLoading] = useState(true);

  // 모달 상태
  const [searchModalOpen, setSearchModalOpen] = useState(false);
  const [pinModalTarget, setPinModalTarget] = useState<Place | null>(null);
  const [stayModalTarget, setStayModalTarget] = useState<Place | null>(null);
  // 방금 검색 모달로 추가한 숙소 (등록 취소 시 삭제 대상)
  const [pendingStayPlace, setPendingStayPlace] = useState<Place | null>(null);

  // 초기 데이터 로드
  useEffect(() => {
    const controller = new AbortController();
    const signal = controller.signal;

    async function loadData() {
      try {
        const [roomData, placesData, pinsData, membersData] = await Promise.all([
          getRoom(roomId, signal),
          getPlaces(roomId, signal),
          getPins(roomId, signal),
          getMembers(roomId, signal),
        ]);
        setRoom(roomData);
        setPlaces(placesData);
        setPins(pinsData);
        setMembers(membersData);
      } catch (err) {
        // 언마운트로 인한 요청 취소는 무시 (React Strict Mode 이중 실행 대응)
        if (err instanceof Error && err.name === 'AbortError') return;
        console.error('데이터 로드 실패:', err);
        toast.error('데이터를 불러오지 못했습니다.');
      } finally {
        if (!signal.aborted) setIsLoading(false);
      }
    }
    loadData();

    // 컴포넌트 언마운트 시 진행 중인 요청 취소
    return () => controller.abort();
  }, [roomId]);

  // Realtime 구독
  useEffect(() => {
    const unsubscribe = subscribeToPlaces(roomId, ({ eventType, new: newPlace, old: oldPlace }) => {
      if (eventType === 'INSERT') {
        setPlaces((prev) => {
          // 이미 존재하면 중복 추가 방지
          if (prev.some((p) => p.id === newPlace.id)) return prev;
          return [...prev, newPlace];
        });
      } else if (eventType === 'UPDATE') {
        setPlaces((prev) => prev.map((p) => (p.id === newPlace.id ? newPlace : p)));
      } else if (eventType === 'DELETE') {
        setPlaces((prev) => prev.filter((p) => p.id !== (oldPlace as Place).id));
      }
    });

    return unsubscribe;
  }, [roomId]);

  const filteredPlaces =
    activeCategory === 'all'
      ? places
      : places.filter((p) => p.category === activeCategory);

  // 필수 방문 토글
  const handleToggleMustVisit = async (placeId: string) => {
    if (!room) return;
    const place = places.find((p) => p.id === placeId);
    if (!place) return;
    const nextValue = !place.is_must_visit;
    // 낙관적 업데이트
    setPlaces((prev) =>
      prev.map((p) => (p.id === placeId ? { ...p, is_must_visit: nextValue } : p))
    );
    try {
      await updatePlace(roomId, placeId, { is_must_visit: nextValue });
    } catch {
      // 롤백
      setPlaces((prev) =>
        prev.map((p) => (p.id === placeId ? { ...p, is_must_visit: !nextValue } : p))
      );
      toast.error('필수 방문 설정에 실패했습니다.');
    }
  };

  // 장소 추가 (검색 모달에서 이미 API 호출 완료)
  const handleAddPlace = (newPlace: Place) => {
    setPlaces((prev) => {
      if (prev.some((p) => p.id === newPlace.id)) return prev;
      return [...prev, newPlace];
    });
    setSearchModalOpen(false);
    // 숙소 카테고리인 경우 즉시 숙소 등록 모달 표시 (pending 상태로 추적)
    if (newPlace.category === '숙소') {
      setPendingStayPlace(newPlace);
      setStayModalTarget(newPlace);
    }
  };

  // 숙소 등록 모달 닫기 (취소 시 방금 추가한 숙소 삭제)
  const handleStayModalClose = async () => {
    if (pendingStayPlace) {
      try {
        await deletePlace(roomId, pendingStayPlace.id);
      } catch {
        // 삭제 실패해도 로컬 상태는 제거
      }
      setPlaces((prev) => prev.filter((p) => p.id !== pendingStayPlace.id));
      setPendingStayPlace(null);
    }
    setStayModalTarget(null);
  };

  // 장소 삭제
  const handleDeletePlace = async (placeId: string) => {
    const removed = places.find((p) => p.id === placeId);
    setPlaces((prev) => prev.filter((p) => p.id !== placeId));
    try {
      await deletePlace(roomId, placeId);
    } catch {
      if (removed) setPlaces((prev) => [...prev, removed]);
      toast.error('장소 삭제에 실패했습니다.');
    }
  };

  // 고정 핀 등록
  const handlePinRegister = async (place: Place, date: string, time: string) => {
    try {
      const newPin = await createPin(roomId, {
        place_id: place.id,
        type: 'RESERVATION',
        pinned_date: date,
        pinned_time: time,
      });
      setPins((prev) => [
        ...prev.filter((p) => !(p.place_id === place.id && p.type === 'RESERVATION')),
        newPin,
      ]);
      setPinModalTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '고정 핀 등록에 실패했습니다.';
      toast.error(message);
    }
  };

  // 숙소 등록
  const handleStayRegister = async (
    place: Place,
    checkinDate: string,
    checkoutDate: string
  ) => {
    try {
      const newPin = await createPin(roomId, {
        place_id: place.id,
        type: 'STAY',
        pinned_date: checkinDate,
        pinned_time: '00:00',
        checkout_date: checkoutDate,
      });
      setPins((prev) => [
        ...prev.filter((p) => !(p.place_id === place.id && p.type === 'STAY')),
        newPin,
      ]);
      // 등록 성공 시 pending 상태 해제
      setPendingStayPlace(null);
      setStayModalTarget(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : '숙소 등록에 실패했습니다.';
      toast.error(message);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 헤더: 제목 + 실시간 인디케이터 + 장소 추가 버튼 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={`/room/${roomId}`}>
            <Button variant="ghost" size="icon-sm" title="여행방으로 돌아가기">
              <ChevronLeft className="size-5" />
            </Button>
          </Link>
          <div className="flex flex-col gap-0.5">
          <h1 className="text-xl font-bold text-foreground">위시리스트</h1>
          <div className="flex items-center gap-1.5 text-xs text-green-600">
            <span className="size-2 rounded-full bg-green-500 animate-pulse" />
            실시간 동기화 중
          </div>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => setSearchModalOpen(true)}
          className="flex items-center gap-1.5 shrink-0"
        >
          <Plus className="size-4" />
          장소 추가
        </Button>
      </div>

      {/* 카테고리 탭 필터 */}
      <div className="flex gap-1.5 flex-wrap">
        {CATEGORIES.map((cat) => {
          const count =
            cat.value === 'all'
              ? places.length
              : places.filter((p) => p.category === cat.value).length;
          return (
            <button
              key={cat.value}
              onClick={() => setActiveCategory(cat.value)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                activeCategory === cat.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              )}
            >
              {cat.label}
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                  activeCategory === cat.value
                    ? 'bg-primary-foreground/20 text-primary-foreground'
                    : 'bg-background text-foreground'
                )}
              >
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {/* 장소 목록 */}
      {isLoading ? (
        <div className="flex justify-center py-12 text-muted-foreground text-sm">
          불러오는 중...
        </div>
      ) : filteredPlaces.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
          <p className="text-sm">저장된 장소가 없습니다.</p>
          <Button size="sm" variant="outline" onClick={() => setSearchModalOpen(true)}>
            첫 번째 장소 추가하기
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredPlaces.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              pin={pins.find((p) => p.place_id === place.id && p.type === 'RESERVATION') ?? null}
              stay={pins.find((p) => p.place_id === place.id && p.type === 'STAY') ?? null}
              startDate={room?.start_date ?? ''}
              memberNickname={
                members.find((m) => m.id === place.added_by)?.nickname ?? ''
              }
              onToggleMustVisit={() => handleToggleMustVisit(place.id)}
              onOpenPinModal={() => setPinModalTarget(place)}
              onOpenStayModal={() => setStayModalTarget(place)}
              onDelete={() => handleDeletePlace(place.id)}
            />
          ))}
        </div>
      )}

      {/* 장소 검색 모달 */}
      <PlaceSearchModal
        open={searchModalOpen}
        onClose={() => setSearchModalOpen(false)}
        onAddPlace={handleAddPlace}
        roomId={roomId}
      />

      {/* 고정 핀 등록 모달 */}
      {room && (
        <PinRegisterModal
          open={pinModalTarget !== null}
          targetPlace={pinModalTarget}
          room={room}
          onClose={() => setPinModalTarget(null)}
          onRegister={handlePinRegister}
        />
      )}

      {/* 숙소 등록 모달 */}
      {room && (
        <StayRegisterModal
          open={stayModalTarget !== null}
          targetPlace={stayModalTarget}
          room={room}
          pins={pins}
          onClose={handleStayModalClose}
          onRegister={handleStayRegister}
        />
      )}
    </div>
  );
}
