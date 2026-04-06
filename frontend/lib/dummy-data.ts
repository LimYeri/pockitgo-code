import type { TravelRoom, Member, Place, SchedulePin, Itinerary, ItineraryOrderedPlace, AlternativePlace, ExcludedPlace, KakaoPlaceResult } from '@/types';

export const DUMMY_ROOM: TravelRoom = {
  id: 'room-001',
  title: '제주도 봄 여행',
  destination: '제주도',
  start_date: '2026-05-01',
  end_date: '2026-05-03',
  invite_link: 'https://pockit.go/join/abc123',
  created_at: '2026-04-01T00:00:00Z',
};

export const DUMMY_MEMBERS: Member[] = [
  {
    id: 'member-001',
    room_id: 'room-001',
    nickname: '여행대장',
    auth_id: 'auth-001',
    joined_at: '2026-04-01T01:00:00Z',
  },
  {
    id: 'member-002',
    room_id: 'room-001',
    nickname: '맛집탐정',
    auth_id: 'auth-002',
    joined_at: '2026-04-01T02:00:00Z',
  },
  {
    id: 'member-003',
    room_id: 'room-001',
    nickname: '사진작가',
    auth_id: 'auth-003',
    joined_at: '2026-04-01T03:00:00Z',
  },
];

export const DUMMY_PLACES: Place[] = [
  // 맛집
  {
    id: 'place-001',
    room_id: 'room-001',
    name: '흑돼지 거리',
    lat: 33.4996,
    lng: 126.5312,
    category: '맛집',
    is_must_visit: true,
    memo: '제주 흑돼지 필수 코스',
    added_by: 'member-002',
    kakao_place_id: 'kakao-001',
  },
  {
    id: 'place-002',
    room_id: 'room-001',
    name: '자매국수',
    lat: 33.5001,
    lng: 126.5319,
    category: '맛집',
    is_must_visit: false,
    memo: '제주 고기국수 맛집',
    added_by: 'member-001',
    kakao_place_id: 'kakao-002',
  },
  // 카페
  {
    id: 'place-003',
    room_id: 'room-001',
    name: '카페 드 뮤제오',
    lat: 33.5139,
    lng: 126.5222,
    category: '카페',
    is_must_visit: false,
    memo: '오션뷰 카페',
    added_by: 'member-003',
    kakao_place_id: 'kakao-003',
  },
  {
    id: 'place-004',
    room_id: 'room-001',
    name: '이니스프리 제주 하우스',
    lat: 33.3079,
    lng: 126.2976,
    category: '카페',
    is_must_visit: false,
    memo: null,
    added_by: 'member-002',
    kakao_place_id: 'kakao-004',
  },
  // 관광지
  {
    id: 'place-005',
    room_id: 'room-001',
    name: '성산일출봉',
    lat: 33.4586,
    lng: 126.9426,
    category: '관광지',
    is_must_visit: true,
    memo: '일출 보러 이른 아침 방문',
    added_by: 'member-001',
    kakao_place_id: 'kakao-005',
  },
  {
    id: 'place-006',
    room_id: 'room-001',
    name: '한라산 국립공원',
    lat: 33.3617,
    lng: 126.5292,
    category: '관광지',
    is_must_visit: false,
    memo: '어리목 코스 추천',
    added_by: 'member-003',
    kakao_place_id: 'kakao-006',
  },
  // 숙소
  {
    id: 'place-007',
    room_id: 'room-001',
    name: '제주 해비치 호텔',
    lat: 33.4423,
    lng: 126.9213,
    category: '숙소',
    is_must_visit: false,
    memo: '2박 예약 완료',
    added_by: 'member-001',
    kakao_place_id: 'kakao-007',
  },
  // 액티비티
  {
    id: 'place-008',
    room_id: 'room-001',
    name: '한림공원',
    lat: 33.4112,
    lng: 126.2535,
    category: '액티비티',
    is_must_visit: false,
    memo: '재암수 용암동굴 투어',
    added_by: 'member-002',
    kakao_place_id: 'kakao-008',
  },
  // 추가 장소
  {
    id: 'place-009',
    room_id: 'room-001',
    name: '협재 해수욕장',
    lat: 33.3941,
    lng: 126.2390,
    category: '관광지',
    is_must_visit: false,
    memo: '에메랄드빛 바다',
    added_by: 'member-003',
    kakao_place_id: 'kakao-009',
  },
  {
    id: 'place-010',
    room_id: 'room-001',
    name: '제주 동문시장',
    lat: 33.5140,
    lng: 126.5267,
    category: '맛집',
    is_must_visit: false,
    memo: '야시장 꼭 가기',
    added_by: 'member-002',
    kakao_place_id: 'kakao-010',
  },
];

export const DUMMY_PINS: SchedulePin[] = [
  {
    id: 'pin-001',
    place_id: 'place-001',
    type: 'RESERVATION',
    pinned_date: '2026-05-01',
    pinned_time: '18:00',
    checkout_date: null,
  },
  {
    id: 'pin-002',
    place_id: 'place-007',
    type: 'STAY',
    pinned_date: '2026-05-01',
    pinned_time: '15:00',
    checkout_date: '2026-05-03',
  },
];

export const DUMMY_KAKAO_RESULTS: KakaoPlaceResult[] = [
  {
    id: 'k1',
    place_name: '협재해수욕장',
    category_name: '관광,명소',
    address_name: '제주특별자치도 제주시 한림읍 협재리',
    road_address_name: '제주특별자치도 제주시 한림읍 한림로 329',
    x: '126.2390',
    y: '33.3941',
    phone: '',
    place_url: '',
  },
  {
    id: 'k2',
    place_name: '제주 흑돼지 마을',
    category_name: '음식점,한식',
    address_name: '제주특별자치도 제주시 연동',
    road_address_name: '',
    x: '126.4915',
    y: '33.4880',
    phone: '064-742-0000',
    place_url: '',
  },
  {
    id: 'k3',
    place_name: '카페 드 뮤제오',
    category_name: '카페,베이커리',
    address_name: '제주특별자치도 제주시 노형동',
    road_address_name: '',
    x: '126.5222',
    y: '33.5139',
    phone: '',
    place_url: '',
  },
  {
    id: 'k4',
    place_name: '한림공원',
    category_name: '관광,테마파크',
    address_name: '제주특별자치도 제주시 한림읍',
    road_address_name: '',
    x: '126.2535',
    y: '33.4112',
    phone: '064-796-0001',
    place_url: '',
  },
  {
    id: 'k5',
    place_name: '신라모노그램 제주',
    category_name: '숙박,호텔',
    address_name: '제주특별자치도 제주시 애월읍',
    road_address_name: '',
    x: '126.3200',
    y: '33.4600',
    phone: '',
    place_url: '',
  },
];

const toOrderedPlace = (p: Place, travelTimeAfter?: number): ItineraryOrderedPlace => ({
  place_id: p.id,
  name: p.name,
  lat: p.lat,
  lng: p.lng,
  category: p.category,
  travel_time_after: travelTimeAfter,
});

export const DUMMY_ITINERARY: Itinerary[] = [
  {
    date: '2026-05-01',
    ordered_places: [
      toOrderedPlace(DUMMY_PLACES[4], 85),
      toOrderedPlace(DUMMY_PLACES[0], 42),
      toOrderedPlace(DUMMY_PLACES[6]),
    ],
    alternatives: {},
    excluded_places: [],
  },
  {
    date: '2026-05-02',
    ordered_places: [
      toOrderedPlace(DUMMY_PLACES[5], 30),
      toOrderedPlace(DUMMY_PLACES[7], 55),
      toOrderedPlace(DUMMY_PLACES[2], 20),
      toOrderedPlace(DUMMY_PLACES[1]),
    ],
    alternatives: {},
    excluded_places: [],
  },
];

// 플랜 B/C 대안 장소 (place_id → AlternativePlace[] 매핑)
export const DUMMY_ALTERNATIVES: Record<string, AlternativePlace[]> = {
  'place-005': [
    { name: '우도', lat: 33.5030, lng: 126.9520, address: '제주시 우도면', kakao_place_id: 'kakao-alt-001', category: '관광지', distance_m: 1200 },
    { name: '광치기 해변', lat: 33.4612, lng: 126.9280, address: '제주시 성산읍', kakao_place_id: 'kakao-alt-002', category: '관광지', distance_m: 800 },
  ],
  'place-001': [
    { name: '돈사돈', lat: 33.4990, lng: 126.5290, address: '제주시 연동', kakao_place_id: 'kakao-alt-003', category: '맛집', distance_m: 350 },
  ],
  'place-006': [],
  'place-008': [
    { name: '비양도', lat: 33.4284, lng: 126.2401, address: '제주시 한림읍', kakao_place_id: 'kakao-alt-004', category: '액티비티', distance_m: 600 },
    { name: '제주 항공우주박물관', lat: 33.3879, lng: 126.2640, address: '제주시 안덕면', kakao_place_id: 'kakao-alt-005', category: '액티비티', distance_m: 1500 },
  ],
  'place-003': [
    { name: '카페 봄날', lat: 33.5100, lng: 126.5180, address: '제주시 노형동', kakao_place_id: 'kakao-alt-006', category: '카페', distance_m: 400 },
  ],
};

// 방문 불가 장소 (Filter Agent가 제외한 장소)
export const DUMMY_EXCLUDED: ExcludedPlace[] = [
  { id: 'place-004', name: '이니스프리 제주 하우스', category: '카페', reason: '여행 기간 중 임시 휴무' },
  { id: 'place-009', name: '협재 해수욕장', category: '관광지', reason: '운영시간 정보 없음' },
];
