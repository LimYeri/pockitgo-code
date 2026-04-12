import type { TravelRoom, Member, Place, SchedulePin, PlaceCategory, Itinerary } from '@/types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(BASE_URL + path, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    ...options,
  });
  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      window.location.href = '/';
    }
    throw new Error('세션이 만료되었습니다. 다시 참여해주세요.');
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || '요청 실패');
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export interface CreateRoomInput {
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
}

export interface JoinRoomInput {
  nickname: string;
  auth_id: string;
}

export async function createRoom(data: CreateRoomInput): Promise<TravelRoom> {
  return apiFetch('/rooms/', { method: 'POST', body: JSON.stringify(data) });
}

export async function getRoom(roomId: string, signal?: AbortSignal): Promise<TravelRoom> {
  return apiFetch(`/rooms/${roomId}`, { signal });
}

export async function getRoomByInvite(token: string): Promise<TravelRoom> {
  return apiFetch(`/rooms/by-invite/${token}`);
}

export async function joinRoom(roomId: string, data: JoinRoomInput): Promise<Member> {
  return apiFetch(`/rooms/${roomId}/members`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function getMembers(roomId: string, signal?: AbortSignal): Promise<Member[]> {
  return apiFetch(`/rooms/${roomId}/members`, { signal });
}

export async function getMemberByAuthId(roomId: string, authId: string): Promise<Member | null> {
  try {
    return await apiFetch<Member>(`/rooms/${roomId}/members/me?auth_id=${encodeURIComponent(authId)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : '';
    if (message.includes('멤버를 찾을 수 없습니다')) return null;
    throw err;
  }
}

// Places API
export interface AddPlaceInput {
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  kakao_place_id: string;
  added_by: string;
  memo?: string | null;
  is_must_visit?: boolean;
}

export interface UpdatePlaceInput {
  is_must_visit?: boolean;
  memo?: string | null;
}

export async function getPlaces(roomId: string, signal?: AbortSignal): Promise<Place[]> {
  return apiFetch(`/rooms/${roomId}/places`, { signal });
}

export async function addPlace(roomId: string, data: AddPlaceInput): Promise<Place> {
  return apiFetch(`/rooms/${roomId}/places`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updatePlace(
  roomId: string,
  placeId: string,
  data: UpdatePlaceInput
): Promise<Place> {
  return apiFetch(`/rooms/${roomId}/places/${placeId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function deletePlace(roomId: string, placeId: string): Promise<void> {
  return apiFetch(`/rooms/${roomId}/places/${placeId}`, { method: 'DELETE' });
}

// Pins API
export interface CreatePinInput {
  place_id: string;
  type: 'RESERVATION' | 'STAY';
  pinned_date?: string | null;
  pinned_time?: string | null;
  checkout_date?: string | null;
}

export async function getPins(roomId: string, signal?: AbortSignal): Promise<SchedulePin[]> {
  return apiFetch(`/rooms/${roomId}/pins`, { signal });
}

export async function createPin(roomId: string, data: CreatePinInput): Promise<SchedulePin> {
  return apiFetch(`/rooms/${roomId}/pins`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function deletePin(roomId: string, pinId: string): Promise<void> {
  return apiFetch(`/rooms/${roomId}/pins/${pinId}`, { method: 'DELETE' });
}

// Itinerary API

/**
 * 일정 생성 SSE 스트림을 시작한다.
 * EventSource는 POST를 지원하지 않으므로 fetch Response를 직접 반환한다.
 */
export async function generateItineraryStream(roomId: string): Promise<Response> {
  const res = await fetch(`${BASE_URL}/rooms/${roomId}/itinerary/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { detail?: string }).detail || '일정 생성 시작 실패');
  }
  return res;
}

/** 저장된 일정 결과를 조회한다. */
export async function getItinerary(roomId: string): Promise<Itinerary[]> {
  return apiFetch<Itinerary[]>(`/rooms/${roomId}/itinerary`);
}

/** 플랜B/C 대안 장소로 교체한다. */
export async function replaceItineraryPlace(
  roomId: string,
  date: string,
  originalPlaceId: string,
  newPlace: import('@/types').AlternativePlace
): Promise<Itinerary> {
  return apiFetch<Itinerary>(`/rooms/${roomId}/itinerary/replace`, {
    method: 'POST',
    body: JSON.stringify({
      date,
      original_place_id: originalPlaceId,
      new_place: newPlace,
    }),
  });
}

/** 일정 내 장소 방문 순서를 변경한다. */
export async function updateItineraryOrder(
  roomId: string,
  date: string,
  orderedPlaces: import('@/types').ItineraryOrderedPlace[]
): Promise<Itinerary> {
  return apiFetch<Itinerary>(`/rooms/${roomId}/itinerary`, {
    method: 'PATCH',
    body: JSON.stringify({ date, ordered_places: orderedPlaces }),
  });
}

/** 일정 결과의 특정 날짜 타임라인에 장소를 직접 추가한다. */
export interface AddItineraryPlaceInput {
  kakao_place_id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
}

export async function addItineraryPlace(
  roomId: string,
  date: string,
  data: AddItineraryPlaceInput
): Promise<Itinerary> {
  return apiFetch<Itinerary>(`/rooms/${roomId}/itinerary/${date}/places`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

/** 일정 결과의 특정 날짜 타임라인에서 장소를 제거한다. */
export async function removeItineraryPlace(
  roomId: string,
  date: string,
  placeId: string
): Promise<Itinerary> {
  return apiFetch<Itinerary>(`/rooms/${roomId}/itinerary/${date}/places/${placeId}`, {
    method: 'DELETE',
  });
}
