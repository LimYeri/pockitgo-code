# PockitGo

AI 기반 그룹 여행 플래너 웹앱. 여행 멤버들이 공유한 위시리스트를 LangGraph 4-Agent가 최적 동선과 일정으로 자동 생성해주는 서비스입니다.

## 주요 기능

- **여행방 생성/참여** — 초대 링크로 멤버 합류, Supabase Realtime으로 위시리스트 실시간 동기화
- **위시리스트** — 멤버별 장소 추가(맛집/카페/관광지/숙소/액티비티), 고정 핀(예약·숙박) 설정
- **AI 일정 자동 생성** — LangGraph 3-Agent가 장소 필터링 → 동선 최적화 → 타임라인 생성
- **플랜 B/C** — 확정 장소마다 동일 카테고리 대안 2개 제공
- **지도 동선 시각화** — Kakao Maps API로 날짜별 방문 경로 표시

## 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | Next.js 16.2, TypeScript, Tailwind CSS |
| Backend | FastAPI (Python 3.13), LangGraph, LangChain |
| DB / 실시간 | Supabase (PostgreSQL + Realtime + Auth) |
| AI | Claude (Anthropic) |
| 지도 | Kakao Maps API, Kakao Mobility API |
| 배포 | Vercel (Frontend), Railway (Backend) |

## LangGraph 4-Agent 구조

```
① Filter Agent      — 운영 불가 장소 분류, 필수 장소 태깅
        ↓
② Planner Agent     — 클러스터링 → TSP 정렬 → 타임라인 생성
        ↓
③ Validator Agent   — 일정 밀도 검증, 시간 충돌 감지, 경고 생성
        ↓
④ Alternative Agent — 장소별 Kakao Maps Nearby Search로 플랜 B/C 탐색
```

## 프로젝트 구조

```
pockit-go/
├── frontend/   # Next.js 프론트엔드
└── backend/    # FastAPI 백엔드
```

## 시작하기

### 환경 변수 설정

**Frontend** (`frontend/.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
NEXT_PUBLIC_KAKAO_MAP_KEY=
NEXT_PUBLIC_BACKEND_URL=
```

**Backend** (`backend/.env`)
```env
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
KAKAO_REST_API_KEY=
LANGSMITH_API_KEY=
```

### Frontend 실행

```bash
cd frontend
npm install
npm run dev       # http://localhost:3000
```

### Backend 실행

```bash
cd backend
source .venv/Scripts/activate   # Windows Git Bash
uvicorn main:app --reload        # http://localhost:8000
```

패키지 설치는 `uv`를 사용합니다.

```bash
uv add <패키지명>
```

## 페이지 흐름

```
랜딩 → 여행방 생성/참여 → 여행방 메인 → 위시리스트 → 일정 생성 → 일정 결과
                                              └── 장소 검색 모달     └── 플랜 B/C 슬라이드
```

## 개발 로드맵

- **MVP** — 여행방 생성/참여, 위시리스트, LangGraph 4-Agent 일정 생성, 플랜 B/C, 지도 동선 시각화
- **v2** — 모바일 반응형, 드래그 앤 드롭 날짜 간 이동, 일정 공유/내보내기, 장소 투표
- **v3** — 자연어 일정 조정 LLM, 숙소 추천 연동, 예산 관리, React Native 앱
