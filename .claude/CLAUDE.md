# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

**PockitGo** — AI 기반 그룹 여행 플래너 웹앱. 멤버들이 공유한 위시리스트를 LangGraph 3-Agent가 최적 동선과 일정으로 자동 생성해주는 서비스.

> 현재 저장소는 기획 단계이며 `basefile.md`가 핵심 사양 문서입니다. 구현 시 이 문서를 참고하세요.

---

## 기술 스택

### Frontend
- **Next.js 16.2** + TypeScript + Tailwind CSS
- **Vercel** 배포
- SSE(Server-Sent Events)로 일정 생성 진행 상태 실시간 수신

### Backend
- **FastAPI** (Python)
- **LangGraph** — AI Agent 엔진
- **Railway** 배포

### 데이터베이스 & 실시간
- **Supabase** (PostgreSQL + Realtime WebSocket + Auth)
  - Realtime: 멤버 간 위시리스트 실시간 동기화
  - Auth: JWT 기반 닉네임 익명 세션

### 외부 API
- **Kakao Maps API** — 장소 검색, 좌표 변환, 지도 렌더링
- **Kakao Mobility API** — 자차 이동 시간·거리 계산

---

## 시스템 아키텍처

```
브라우저 (Next.js)
    │
    ├─ REST API / SSE ──▶ FastAPI (Python)
    │                         │
    │                    LangGraph Engine
    │                    ① Filter Agent
    │                         ↓
    │                    ② Planner Agent
    │                         ↓
    │                    ③ Validator Agent
    │                         ↓ (병렬)
    │                    ④ Alternative Agent
    │                         │
    │               ┌─────────┴──────────┐
    │          Kakao Maps API   Kakao Mobility API
    │
    └─ Realtime 구독 ──▶ Supabase
                           ├── PostgreSQL
                           ├── Realtime (WebSocket)
                           └── Auth (JWT 세션)
```

---

## LangGraph 4-Agent 구조

| Agent | 입력 | 동작 | 출력 |
|-------|------|------|------|
| **① Filter Agent** | 전체 장소 목록 + 여행 날짜 | 운영 불가 장소 분류, 필수 장소 태깅 | 유효 장소 목록 |
| **② Planner Agent** | 유효 장소 + 고정 핀 + 숙소 | 클러스터링 → TSP 정렬 → 타임라인 생성 | 날짜별 일정 |
| **③ Validator Agent** | Planner 출력 일정 | 일정 사후 검증, 사용자 경고 생성 | 경고 메시지 목록 |
| **④ Alternative Agent** | 확정된 일정의 각 장소 | Kakao Maps Nearby Search로 동일 카테고리 대안 탐색 (병렬 실행) | 장소별 플랜 B/C 2개 |

---

## 핵심 데이터 모델

| 엔티티 | 주요 필드 |
|--------|-----------|
| **TravelRoom** | id, title, destination, start_date, end_date, invite_link |
| **Place** | id, room_id, name, lat, lng, category(맛집/카페/관광지/숙소/액티비티), is_must_visit, memo |
| **Member** | id, room_id, nickname |
| **SchedulePin** | id, place_id, type(RESERVATION/STAY), pinned_date, pinned_time |
| **Itinerary** | id, room_id, date, ordered_places, travel_times |

---

## 페이지 구성

```
랜딩 → 여행방 생성/참여 → 여행방 메인 → 위시리스트 → 일정 생성 → 일정 결과
                                              └── 장소 검색 모달     └── 플랜 B/C 슬라이드
```

---

## 프로젝트 구조

```
pockit-go/
├── frontend/   # Next.js 프론트엔드
└── backend/    # FastAPI 백엔드
```

## 개발 명령어

### Frontend (`frontend/` 폴더)
```bash
npm run dev      # 개발 서버 실행 (http://localhost:3000)
npm run build    # 프로덕션 빌드
npm run lint     # ESLint 검사
```

### Backend (`backend/` 폴더)

FastAPI 백엔드는 **uv**로 가상환경을 관리합니다.
패키지 설치나 테스트 실행 전에 반드시 가상환경을 먼저 활성화해야 합니다.

```bash
# 가상환경 활성화 (Windows Git Bash / 작업 전 필수)
source .venv/Scripts/activate

# 개발 서버 실행 (http://localhost:8000)
uvicorn main:app --reload

# 테스트 실행
pytest

# 특정 테스트 실행
pytest tests/test_agents.py

# 패키지 설치
uv add <패키지명>
```

---

## 주요 예외 처리 규칙

- 고정 핀 시간 충돌 → "해당 시간대에 이미 고정된 일정이 있습니다" 경고
- 여행 기간 내 전일 휴무 장소 → Filter Agent 제외 후 결과 화면에 "방문 불가 장소" 목록 별도 표시
- 숙소 미등록 → 일정 생성 가능, 결과에 날짜별 추천 숙소 구역 힌트 표시
- 플랜 B/C 없는 장소 → "주변에 대안 장소가 없습니다" 표시, 교체 버튼 비활성화

---

## 개발 로드맵

- **MVP (현재)** — 해커톤 제출 기준: 여행방 생성/참여, 위시리스트, LangGraph 4-Agent 일정 생성, 플랜 B/C, 지도 동선 시각화
- **v2** — 모바일 반응형, 드래그 앤 드롭 날짜 간 이동, 일정 공유/내보내기, 장소 투표
- **v3** — 자연어 일정 조정 LLM, 숙소 추천 연동, 예산 관리, React Native 앱
