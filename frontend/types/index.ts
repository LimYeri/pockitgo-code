// 장소 카테고리 유니온 타입
export type PlaceCategory = '맛집' | '카페' | '관광지' | '숙소' | '액티비티';

// 고정 핀 타입 유니온
export type SchedulePinType = 'RESERVATION' | 'STAY';

// 여행방 엔티티
export interface TravelRoom {
  id: string;
  title: string;
  destination: string;
  start_date: string;
  end_date: string;
  invite_link: string;
  created_at: string;
}

// 멤버 엔티티
export interface Member {
  id: string;
  room_id: string;
  nickname: string;
  auth_id: string;
  joined_at: string;
}

// 장소 엔티티
export interface Place {
  id: string;
  room_id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  is_must_visit: boolean;
  memo: string | null;
  added_by: string;
  kakao_place_id: string;
}

// 고정 핀 엔티티 (예약 또는 숙소)
export interface SchedulePin {
  id: string;
  place_id: string;
  type: SchedulePinType;
  pinned_date: string | null;
  pinned_time: string | null;
  checkout_date: string | null;
}

// 일정 내 방문 장소 (백엔드 Planner Agent 출력 구조)
export interface ItineraryOrderedPlace {
  place_id: string;
  name: string;
  lat: number;
  lng: number;
  category: PlaceCategory;
  scheduled_time?: string;
  travel_time_after?: number;
}

// 플랜 B/C 대안 장소 (백엔드 AlternativePlace 구조)
export interface AlternativePlace {
  name: string;
  lat: number;
  lng: number;
  address: string;
  kakao_place_id: string;
  category: string;
  distance_m: number;
}

// Filter Agent가 제외한 장소
export interface ExcludedPlace {
  id: string;
  name: string;
  category: string;
  reason: string;
}

// 일정 엔티티 (백엔드 ItineraryDayResponse 구조)
export interface Itinerary {
  date: string;
  ordered_places: ItineraryOrderedPlace[];
  alternatives: Record<string, AlternativePlace[]>;
  excluded_places: ExcludedPlace[];
  validation_warnings?: string[];
}

// API 응답 공통 래퍼
export interface ApiResponse<T> {
  data: T;
  error: string | null;
}

// Kakao Maps SDK 최소 타입 정의
interface KakaoMapsServices {
  Places: new () => {
    keywordSearch: (
      keyword: string,
      callback: (result: KakaoPlaceResult[], status: string) => void
    ) => void;
  };
  Status: {
    OK: string;
    ZERO_RESULT: string;
    ERROR: string;
  };
}

interface KakaoMapsLatLng {
  new (lat: number, lng: number): KakaoMapsLatLngInstance;
}

interface KakaoMapsLatLngInstance {
  getLat: () => number;
  getLng: () => number;
}

interface KakaoMaps {
  load: (callback: () => void) => void;
  services: KakaoMapsServices;
  LatLng: KakaoMapsLatLng;
  Map: new (
    container: HTMLElement,
    options: { center: KakaoMapsLatLngInstance; level: number }
  ) => KakaoMapInstance;
  Marker: new (options: { position: KakaoMapsLatLngInstance }) => KakaoMarkerInstance;
  Polyline: new (options: {
    path: KakaoMapsLatLngInstance[];
    strokeWeight?: number;
    strokeColor?: string;
    strokeOpacity?: number;
  }) => KakaoPolylineInstance;
}

interface KakaoMapInstance {
  setCenter: (latlng: KakaoMapsLatLngInstance) => void;
  setLevel: (level: number) => void;
}

interface KakaoMarkerInstance {
  setMap: (map: KakaoMapInstance | null) => void;
}

interface KakaoPolylineInstance {
  setMap: (map: KakaoMapInstance | null) => void;
}

// 카카오 장소 검색 결과
export interface KakaoPlaceResult {
  id: string;
  place_name: string;
  category_name: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  phone: string;
  place_url: string;
}

// Window 인터페이스에 kakao SDK 글로벌 선언
declare global {
  interface Window {
    kakao: {
      maps: KakaoMaps;
    };
  }
}
