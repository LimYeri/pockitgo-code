# PockitGo 개발 로드맵

가고 싶은 곳을 뽁 찍으면, AI가 동선과 일정까지 자동으로 최적화해주는 그룹 여행 플래너 웹앱

## 개요

PockitGo는 2-6인 국내 자차 여행 그룹을 위한 AI 기반 일정 최적화 서비스로 다음 기능을 제공합니다.

- **그룹 위시리스트 수집**: 초대 링크 하나로 멤버 전원의 희망 장소를 한 곳에 모아 Supabase Realtime으로 실시간 동기화
- **LangGraph 3-Agent 일정 자동 생성**: Filter → Planner → Alternative 파이프라인이 운영시간·고정 핀·숙소를 모두 고려해 최적 동선 생성
- **플랜 B/C 대안 제공**: 모든 장소에 대안 2곳을 미리 탐색해 돌발상황 즉시 대응

---

## 개발 워크플로우

1. **작업 계획**

   - 기존 코드베이스를 학습하고 현재 상태를 파악
   - 새로운 작업을 포함하도록 `ROADMAP.md` 업데이트
   - 우선순위 작업은 마지막 완료된 작업 다음에 삽입

2. **작업 생성**

   - 기존 코드베이스를 학습하고 현재 상태를 파악
   - `/tasks` 디렉토리에 새 작업 파일 생성
   - 명명 형식: `XXX-description.md` (예: `001-setup.md`)
   - 고수준 명세서, 관련 파일, 수락 기준, 구현 단계 포함
   - **API/비즈니스 로직 작업 시 "## 테스트 체크리스트" 섹션 필수 포함 (Playwright MCP 테스트 시나리오 작성)**
   - 예시를 위해 `/tasks` 디렉토리의 마지막 완료된 작업 참조
   - 새 작업의 경우 문서에는 빈 박스와 변경 사항 요약이 없어야 함

3. **작업 구현**

   - 작업 파일의 명세서를 따름
   - 기능과 기능성 구현
   - **API 연동 및 비즈니스 로직 구현 시 Playwright MCP로 테스트 수행 필수**
   - 각 단계 후 작업 파일 내 단계 진행 상황 업데이트
   - 구현 완료 후 Playwright MCP를 사용한 E2E 테스트 실행
   - 테스트 통과 확인 후 다음 단계로 진행
   - 각 단계 완료 후 중단하고 추가 지시를 기다림

4. **로드맵 업데이트**

   - 로드맵에서 완료된 작업을 체크 표시로 갱신

---

## 개발 단계

### Phase 1: 애플리케이션 골격 구축 (Sprint 1 기반 세팅)

- **Task 001: 프로젝트 구조 및 공통 타입 정의** ✅ 완료
  - `frontend/` Next.js 16.2 App Router 기반 전체 라우트 구조 생성
    - `/` 랜딩 페이지
    - `/create` 여행방 생성 페이지
    - `/join/[token]` 여행방 참여 페이지
    - `/room/[roomId]` 여행방 메인 페이지
    - `/room/[roomId]/wishlist` 위시리스트 페이지
    - `/room/[roomId]/generate` 일정 생성 페이지
    - `/room/[roomId]/itinerary` 일정 결과 페이지
  - 모든 주요 페이지의 빈 껍데기 파일 생성 (레이아웃 구조만 포함)
  - 공통 레이아웃 컴포넌트 골격 구현 (Header, Footer, PageWrapper)
  - TypeScript 인터페이스 및 타입 정의 파일 생성 (`types/index.ts`)
    - `TravelRoom`, `Place`, `Member`, `SchedulePin`, `Itinerary` 인터페이스
    - API 요청/응답 타입 정의
    - Kakao Maps SDK 타입 정의
  - Tailwind CSS 디자인 토큰 및 기본 스타일 설정

- **Task 002: 백엔드 프로젝트 초기화 및 DB 스키마 설계** ✅ 완료
  - `backend/` FastAPI 프로젝트 초기화 (uv 가상환경, 디렉토리 구조)
  - Railway 배포 설정 (`Procfile`, 환경변수 템플릿 `.env.example`)
  - CORS 설정 및 기본 미들웨어 구성
  - Supabase 프로젝트 생성 및 초기 스키마 마이그레이션 작성
    - `TravelRoom` 테이블: id, title, destination, start_date, end_date, invite_link, created_at
    - `Member` 테이블: id, room_id, nickname, auth_id, joined_at
    - `Place` 테이블: id, room_id, name, lat, lng, category, is_must_visit, memo, added_by, kakao_place_id
    - `SchedulePin` 테이블: id, place_id, type(RESERVATION/STAY), pinned_date, pinned_time, checkout_date
    - `Itinerary` 테이블: id, room_id, date, ordered_places, travel_times, created_at
  - RLS(Row Level Security) 정책 설계 (여행방 멤버만 해당 방 데이터 접근)
  - FastAPI 라우터 파일 골격 생성 (rooms, places, pins, itinerary)

### Phase 2: UI/UX 완성 (더미 데이터 활용)

- **Task 003: 공통 컴포넌트 라이브러리 구현** ✅ 완료
  - shadcn/ui 라이브러리 설치 및 기본 컴포넌트 세팅
  - 공통 UI 컴포넌트 구현
    - Button, Input, Modal, Card, Badge, Toast, Skeleton
    - DatePicker (여행 기간 선택용)
    - CategoryBadge (맛집/카페/관광지/숙소/액티비티)
    - LoadingSpinner (일정 생성 SSE 진행 상태용)
  - 더미 데이터 생성 유틸리티 (`lib/dummy-data.ts`)
    - 샘플 여행방, 멤버, 장소, 고정 핀, 일정 결과 데이터
  - Kakao Maps JavaScript SDK 초기화 스크립트 설정

- **Task 004: 랜딩/여행방 생성·참여 페이지 UI 구현** ✅ 완료
  - 랜딩 페이지: 서비스 소개 카피, "여행방 만들기" / "초대 링크로 참여하기" 버튼
  - 여행방 생성 페이지: 여행 제목·여행지·시작일·종료일 입력 폼 (더미 데이터 활용)
    - Kakao Maps 여행지 자동완성 UI (API 연동 전 목업)
    - 날짜 캘린더 피커
    - 생성 완료 후 초대 링크 복사 버튼 UI
  - 여행방 참여 페이지: 여행방 기본 정보 미리보기, 닉네임 입력창
  - 여행방 메인 페이지: 여행지·기간·멤버 목록·저장된 장소 수 대시보드 (더미 데이터)
  - 모든 페이지 반응형 레이아웃 적용

- **Task 005: 위시리스트·장소 검색 페이지 UI 구현** ✅ 완료
  - 위시리스트 페이지: 카테고리 탭 필터, 장소 카드 목록 (더미 데이터)
    - 장소 카드: 장소명, 카테고리 뱃지, 추가한 멤버 닉네임, 메모, ⭐/📌 버튼
    - 장소 카드 상태 표시: 필수 방문(⭐ 활성화), 고정 핀(📌 날짜/시간 표시), 숙소(체크인/아웃 표시)
  - 장소 검색 모달: 검색창, 결과 목록, 카테고리 선택 드롭다운, 메모 입력창 (더미 데이터)
  - 고정 핀 등록 모달: 날짜·시간 선택 UI
  - 숙소 등록 모달: 체크인·아웃 날짜·시간 입력 UI
  - Realtime 동기화 인디케이터 UI (실제 연동 전 목업)

- **Task 006: 일정 생성·결과 페이지 UI 구현** ✅ 완료
  - 일정 생성 페이지: 활동 시간 설정, 숙소 모드 선택, 저장 장소 요약, 생성 시작 버튼
    - SSE 진행 상태 애니메이션 UI: Filter Agent → Planner Agent → Alternative Agent 단계 표시
  - 일정 결과 페이지: 날짜 탭, 타임라인 카드 목록, Kakao 지도 영역 (더미 데이터)
    - 타임라인: 방문 순서, 예정 시간, 이동 시간 표시
    - 방문 불가 장소 목록 섹션
    - 드래그 앤 드롭 UI 구조 (실제 기능 전 레이아웃만)
  - 플랜 B/C 슬라이드 패널: 현재 장소 요약, 대안 2곳 카드, "대체" 버튼 (더미 데이터)
  - 전체 사용자 플로우 네비게이션 연결 및 검증

### Phase 3: 핵심 기능 구현 (Sprint 1~2 기반 기능)

- **Task 007: Supabase 연동 및 여행방 생성·참여 기능 구현** ✅ 완료
  - Supabase 스키마 마이그레이션 실행 (TravelRoom, Member 테이블)
  - RLS 정책 적용 및 검증
  - Supabase Auth 익명 세션 로직 구현
  - FastAPI F-01 여행방 생성 API 구현
    - `POST /rooms`: TravelRoom 생성, UUID 기반 invite_link 발급
    - `GET /rooms/{room_id}`: 여행방 정보 조회
  - FastAPI F-02 여행방 참여 API 구현
    - `POST /rooms/{room_id}/members`: 닉네임 중복 확인 후 멤버 등록
  - 프론트엔드 더미 데이터를 실제 API 호출로 교체 (랜딩, 생성, 참여, 메인 페이지)
  - Kakao Maps 자동완성 API 연동 (여행지 입력)
  - Playwright MCP로 여행방 생성/참여 전체 플로우 E2E 테스트 수행

- **Task 008: 위시리스트 API 및 Kakao Maps 장소 검색 연동** ✅ 완료
  - Supabase 스키마 마이그레이션 실행 (Place, SchedulePin 테이블)
  - FastAPI F-03 장소 저장 API 구현
    - `POST /rooms/{room_id}/places`: 장소 추가
    - `PATCH /rooms/{room_id}/places/{place_id}`: 장소 정보 수정
    - `DELETE /rooms/{room_id}/places/{place_id}`: 장소 삭제
  - Kakao Maps Keyword 검색 API 연동 (장소 검색 모달)
  - FastAPI F-04 필수 장소 체크 API 구현 (`is_must_visit` 토글)
  - FastAPI F-05 고정 핀 등록 API 구현
    - `POST /rooms/{room_id}/pins`: SchedulePin(RESERVATION) 생성
    - `DELETE /rooms/{room_id}/pins/{pin_id}`: 고정 핀 삭제
    - 고정 핀 시간 충돌 예외 처리
  - FastAPI F-06 숙소 등록 API 구현 (SchedulePin STAY 타입)
  - Supabase Realtime 구독 구현 (places 테이블 변경 이벤트)
  - 프론트엔드 더미 데이터를 실제 API 호출로 교체 (위시리스트 페이지)
  - Playwright MCP로 장소 추가/수정/삭제, 고정 핀 등록, Realtime 동기화 E2E 테스트 수행

- **Task 009: LangGraph 4-Agent 파이프라인 구현** ✅ 완료
  - LangGraph StateGraph `filter → planner → validator → alternative → END` 구조 정의
  - Filter Agent 구현 (Claude Haiku LLM + hours_resolver 다단계 Fallback)
    - 운영시간 수집: Google Places → 웹 추출 → UNKNOWN → HEURISTIC 순 폴백
    - 방문 불가 장소 분류 및 이유 반환, UNKNOWN은 soft-pass 처리
  - Planner Agent 구현 (5단계 내부 구조)
    - 날짜 수 기준 2D 그리디 클러스터링 → TSP 최근접 이웃 동선 정렬
    - 고정 핀(RESERVATION)·숙소(STAY) 기준점 배치
    - Kakao Mobility API 연동으로 자차 이동 시간 계산
    - 운영시간 충돌 시 KEEP_WITH_WARNING / MOVED / REMOVED 처리
  - Validator Agent 구현 (순수 규칙 기반, LLM 없음)
    - 하루 8개 초과 장소 경고, HEURISTIC 운영시간 장소 경고
  - Alternative Agent 구현 (순차 실행, 전역 중복 제거)
    - Kakao Maps Nearby Search, 반경 500→1000→2000m 자동 확장
    - 장소별 플랜 B/C 2개 반환 (없을 시 빈 배열)
  - Itinerary 테이블 `alternatives`, `excluded_places` JSONB 컬럼 추가 및 날짜별 upsert API 구현
  - pytest `tests/test_agents.py` 단위 테스트 전체 통과

- **Task 010: SSE 스트리밍 연동 및 일정 생성 기능 완성** ✅ 완료
  - FastAPI SSE 엔드포인트 구현
    - `POST /rooms/{room_id}/itinerary/generate`: 일정 생성 시작
    - `GET /rooms/{room_id}/itinerary/stream`: SSE 진행 상태 스트리밍
    - `GET /rooms/{room_id}/itinerary`: 완성된 일정 결과 조회
  - SSE 이벤트 스키마 정의 (Agent 단계별 진행률, 완료, 오류)
  - 프론트엔드 일정 생성 페이지 SSE 수신 로직 구현
    - Filter Agent 완료 → Planner Agent 완료 → Validator 완료 → Alternative Agent 완료 단계 표시
    - SSE 연결 끊김 시 30초 간격 자동 재연결 로직
    - 재연결 실패 시 오류 메시지 및 재시도 버튼
  - 장소 0개 상태 일정 생성 시도 차단 처리
  - 생성 완료 후 일정 결과 페이지 자동 이동
  - Playwright MCP로 SSE 스트리밍 및 일정 생성 전체 플로우 E2E 테스트 수행

- **Task 011: 일정 결과 조회·플랜 B/C·수동 조정 기능 구현** ✅ 완료
  - Kakao Maps JavaScript SDK 연동으로 지도 렌더링 구현
    - 날짜별 방문 순서 폴리라인 동선 시각화
    - 장소 마커 표시
  - 날짜별 타임라인 UI 실제 데이터 연동 (더미 데이터 제거)
  - 방문 불가 장소 목록 표시 (Filter Agent 제외 장소)
  - F-09 플랜 B/C 교체 API 연동
    - `POST /places/{place_id}/replace`: 장소 교체 후 이동 시간 재계산
    - 대안 없을 시 "주변에 대안 장소가 없습니다" 표시 및 교체 버튼 비활성화
  - F-10 드래그 앤 드롭 수동 조정 기능 구현
    - 같은 날짜 내 방문 순서 변경
    - `PATCH /rooms/{room_id}/itinerary`: 변경된 순서 저장
    - 순서 변경 후 이동 시간 재계산
  - Playwright MCP로 일정 결과 조회, 플랜 B/C 교체, 수동 조정 E2E 테스트 수행

- **Task 012: 전체 예외 처리 및 통합 테스트** ✅ 완료
  - 예외 처리 전체 점검 및 구현
    - 고정 핀 시간 충돌 → 경고 토스트 표시 및 등록 차단
    - 전일 휴무 장소 → Filter Agent 제외 및 결과 화면 별도 표시
    - 숙소 미등록 → 일정 생성 진행, 결과에 추천 숙소 구역 힌트
    - 닉네임 중복 → "이미 사용 중인 닉네임입니다" 오류
    - 세션 만료 → 초대 링크 재진입 유도 및 랜딩 리디렉션
    - SSE 오류 → 재연결 시도 및 재시도 버튼
    - 잘못된 초대 링크 → "유효하지 않은 링크입니다" 안내
    - Kakao Maps API 호출 실패 → 오류 안내 메시지
    - 종료일 < 시작일 → 인라인 오류 메시지
  - Playwright MCP를 사용한 전체 사용자 플로우 통합 테스트
    - 여행방 생성 → 멤버 참여 → 위시리스트 수집 → 일정 생성 → 결과 확인까지 전체 플로우
    - 각 예외 케이스별 시나리오 테스트
  - 성능 지표 확인
    - LangGraph 일정 생성 응답 시간 60초 이내 달성 여부
    - Supabase Realtime 동기화 지연 1초 이내 확인

- **Task 013: 세션 기반 재방문 인식, 방 접근 권한 가드, 닉네임 중복 UX 개선** ✅ 완료
  - 백엔드: `GET /rooms/{room_id}/members/me?auth_id=` 엔드포인트 추가
  - DB: `members(room_id, auth_id)` 복합 인덱스 추가
  - 프론트엔드: 초대링크 재방문 시 세션 확인 → 기존 멤버면 자동 입장
  - 프론트엔드: 닉네임 중복 오류 시 "이미 참여한 계정" 안내 및 자동 입장
  - 프론트엔드: `room/[roomId]/layout.tsx` 접근 가드 생성 — 비멤버 접근 시 홈으로 리다이렉트

- **Task 014: 여행지 입력 자동완성 개선 (초성 검색·인기 검색어)** ✅ 완료
  - `frontend/lib/destinations.ts` 신규 생성
    - 한국 주요 여행지 50개 정적 목록 (`DESTINATIONS`)
    - 인기 여행지 8개 목록 (`POPULAR_DESTINATIONS`: 제주도, 부산, 경주, 강릉, 여수, 전주, 속초, 서울)
    - 초성 검색 유틸 `searchDestinations()` — 자음 전용 입력 시 초성 추출 비교, 일반 입력 시 포함 검색
  - `frontend/app/create/page.tsx` 수정
    - Kakao 키워드 API 디바운스 `useEffect` 제거 → 동기 필터링으로 교체
    - 입력창 클릭 시 값이 비어있으면 인기 여행지 드롭다운 자동 표시 ("인기 여행지" 라벨 포함)
    - 초성 검색 지원: "ㅈㅈ" 입력 시 제주도·전주·진주 등 매칭
    - 목록에 없는 여행지 직접 입력 허용 (드롭다운 미선택 가능)

### Phase 4: 배포 및 마무리 (Sprint 4 마무리)

- **최종 Task: 배포 환경 구성 및 최종 점검** ✅ 완료
  - Vercel 배포 설정 최종 확인
    - Next.js 16.2 빌드 설정 최적화
    - 환경변수 설정 (Supabase URL/Key, Kakao API Key, FastAPI URL)
    - 빌드 오류 및 ESLint 경고 해소
  - Railway 배포 설정 최종 확인
    - FastAPI 프로덕션 설정 (`uvicorn` 운영 모드)
    - 환경변수 설정 (Supabase Key, Kakao API Key, LangGraph 관련)
    - CORS 허용 도메인 최종 설정 (Vercel 도메인)
  - Supabase 프로덕션 설정 확인
    - RLS 정책 최종 점검
    - 자동 백업 설정 확인
  - 전체 스택 연동 최종 확인 (Vercel + Railway + Supabase)
  - 성능·보안 최종 점검

### Phase 5: 일정 결과 페이지 고도화

- **Task 015: 이동 시간 실시간 표시 개선** ✅ 완료
  - 일정 결과 페이지 최초 로드 시 모든 목적지 간 이동 시간 즉시 표시
    - 현재: 드래그 앤 드롭 또는 장소 대체 이후에만 이동 시간 표시됨
    - 개선: `GET /rooms/{room_id}/itinerary` 응답의 `travel_times` 데이터를 초기 렌더링 시점부터 타임라인에 표시
  - 장소 대체(플랜 B/C 교체) 시 이동 시간 즉시 재계산 및 UI 반영
    - `POST /places/{place_id}/replace` 응답에 재계산된 `travel_times` 포함
    - 교체 완료 즉시 해당 날짜 타임라인의 이동 시간 전체 갱신
  - 드래그 앤 드롭 순서 변경 시 이동 시간 즉시 재계산 및 UI 반영
    - `PATCH /rooms/{room_id}/itinerary` 응답에 재계산된 `travel_times` 포함
    - 순서 저장 완료 즉시 해당 날짜 타임라인의 이동 시간 전체 갱신
  - 이동 시간 렌더링 로직을 공통 훅/유틸로 모듈화 (대체·드래그·초기 로드 모두 재사용)
  - Playwright MCP로 초기 로드·장소 대체·드래그 순서 변경 후 이동 시간 표시 E2E 테스트 수행

- **Task 016: 일정 결과 페이지에서 장소 직접 추가 기능 구현** ✅ 완료
  - 프론트엔드 일정 결과 페이지에 "장소 추가" 버튼 및 흐름 구현
    - 날짜 탭별 타임라인 하단에 "+ 장소 추가" 버튼 표시
    - 버튼 클릭 시 기존 위시리스트 장소 검색 모달(`components/PlaceSearchModal`) 재사용
    - 검색 결과 선택 시 해당 날짜 타임라인 맨 끝에 장소 추가
  - 추가된 장소를 드래그 앤 드롭으로 원하는 위치에 끼워넣기
    - 기존 드래그 앤 드롭 로직 재사용 — 새로 추가된 장소도 동일한 DnD 컨텍스트 내에서 처리
    - 장소 추가·위치 변경 완료 시 이동 시간 즉시 재계산 (Task 015 모듈 재사용)
  - 백엔드 API 확장
    - `POST /rooms/{room_id}/itinerary/{date}/places`: 일정 결과에 장소 직접 추가 및 이동 시간 재계산
    - 추가 시 Kakao Maps 좌표 검증 및 Kakao Mobility 이동 시간 계산 로직 기존 함수 재사용
  - 추가된 장소 제거 기능
    - 타임라인 카드에 "제거" 버튼 표시 (AI 생성 장소 및 직접 추가 장소 모두 적용)
    - `DELETE /rooms/{room_id}/itinerary/{date}/places/{place_id}`: 장소 제거 및 이동 시간 재계산
  - 장소 추가/제거 후 지도 폴리라인·마커 자동 업데이트 (기존 지도 렌더링 함수 재사용)
  - Playwright MCP로 장소 추가·위치 조정·제거 후 이동 시간 및 지도 갱신 E2E 테스트 수행

- **Task 017: 일정 결과 PDF 내보내기 기능 구현**
  - `@react-pdf/renderer` 라이브러리 설치 및 한글 폰트(Noto Sans KR) 설정
  - PDF 전용 레이아웃 컴포넌트 구현 (`components/pdf/ItineraryPDF.tsx`)
    - **지도는 PDF에 포함하지 않음** (카카오 지도 캡처 불가 및 CORS 이슈로 제외)
    - 표지: 여행 제목, 여행지, 기간, 멤버 목록
    - 날짜별 섹션: 날짜 헤더, 방문 순서 번호, 장소명, 카테고리 뱃지, 예정 시간, 이동 시간
    - 방문 불가 장소 목록 섹션 (있을 경우에만 표시)
    - 푸터: PockitGo 브랜딩
  - 일정 결과 페이지 상단에 "PDF 저장" 버튼 추가
    - 클릭 시 `파일명: {여행제목}_{날짜}.pdf` 형식으로 자동 다운로드
    - 버튼 클릭 후 생성 중 로딩 상태 표시
  - PDF 스타일링
    - Tailwind 대신 `@react-pdf/renderer` StyleSheet API로 디자인 재구현
    - 카테고리별 색상 구분 (맛집/카페/관광지/숙소/액티비티)
    - 타임라인 구분선 및 이동 시간 화살표 표시
---

## v2 계획 (MVP 이후 1-2개월)

### 기능 추가 (우선순위 순)

- **일정 공유 및 내보내기** (High): 완성된 일정을 이미지 또는 링크로 공유, 카카오톡 공유 연동
- **드래그 앤 드롭 날짜 간 이동** (High): MVP에서는 순서 변경만, v2에서 날짜 간 장소 이동까지 지원
- **장소 투표 기능** (Mid): 같은 카테고리 중 어디 갈지 멤버들이 투표로 결정
- **소셜 로그인** (Mid): 카카오 OAuth로 여행방 히스토리 저장 기능 활성화
- **여행방 히스토리** (Mid): 지난 여행방 목록 조회 및 재사용
- **날씨 정보 연동** (Low): 여행 날짜 기준 날씨 예보 표시 (기상청 API)

### UX 개선

- **모바일 반응형 최적화** (High): MVP는 웹 기준, v2에서 모바일 UX 전면 개선
- **일정 생성 로딩 UX** (High): Agent 단계별 진행 애니메이션으로 대기 시간 체감 감소
- **장소 카드 디자인 개선** (Mid): 장소 이미지·카카오맵 평점 표시
- **온보딩 튜토리얼** (Mid): 첫 방문 사용자에게 핵심 기능 안내

---

## v3 계획 (3개월 이후)

### AI 고도화

- **LLM 기반 자연어 일정 조정**: "오전은 여유롭게, 저녁은 맛집 위주로" 자연어로 일정 수정 요청
- **Planner Agent LLM 통합**: 규칙 기반에서 LLM 판단으로 더 자연스러운 동선 생성
- **여행 스타일 분석**: 멤버들의 저장 패턴을 분석해 여행 스타일 자동 파악 후 일정 반영

### 서비스 확장

- **숙소 추천 연동**: 숙소 미정 시 추천 구역 기반으로 숙박 플랫폼 딥링크 연결
- **예산 관리**: 장소별 예상 비용 입력 후 여행 총 예산 자동 계산
- **후기 작성**: 여행 후 방문한 장소별 후기 작성 및 공유
- **React Native 모바일 앱**: iOS / Android 앱 출시

---

## 개발 일정 요약

```
[현재: 2026-04-02] 기획 단계
    │
    ▼
[해커톤 MVP] Phase 1~4 완료
    - 여행방 생성/참여
    - 위시리스트 수집 (Realtime 동기화)
    - LangGraph 3-Agent 일정 자동 생성
    - 플랜 B/C 대안 추천
    - 일정 결과 타임라인 + 지도 동선 시각화
    │
    ▼
[+1개월] v2 1단계
    - 모바일 반응형 최적화
    - 일정 공유 및 내보내기
    - 드래그 앤 드롭 날짜 간 이동
    │
    ▼
[+2개월] v2 2단계
    - 장소 투표 기능
    - 소셜 로그인 (카카오 OAuth)
    - 여행방 히스토리
    │
    ▼
[+3개월~] v3
    - LLM 기반 자연어 일정 조정
    - 숙소 추천 연동
    - 예산 관리
    - React Native 앱
```

---

## 기술 스택 참조

| 영역 | 기술 |
|------|------|
| Frontend | Next.js 16.2 (App Router) + TypeScript + Tailwind CSS |
| Backend | FastAPI (Python) + LangGraph + httpx |
| DB / 인증 | Supabase (PostgreSQL + Realtime WebSocket + Auth JWT) |
| 지도 / 이동 | Kakao Maps REST API + Kakao Maps JavaScript SDK + Kakao Mobility API |
| 배포 | Vercel (Frontend) + Railway (Backend) |
| 테스트 | Playwright MCP (E2E 및 API 통합 테스트) |
