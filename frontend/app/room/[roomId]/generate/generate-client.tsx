'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Circle, MapPin, Clock, BedDouble, ChevronRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { CategoryBadge } from '@/components/ui/category-badge';
import { generateItineraryStream } from '@/lib/api';
import type { TravelRoom, Place, SchedulePin, PlaceCategory } from '@/types';
import { cn } from '@/lib/utils';

interface GenerateClientProps {
  room: TravelRoom;
  places: Place[];
  pins: SchedulePin[];
}

type Phase = 'setup' | 'generating' | 'done';

const AGENT_STEPS = [
  { step: 'filter', label: 'Filter Agent', description: '여행 가능 장소 분류 중...' },
  { step: 'planner', label: 'Planner Agent', description: '최적 동선 생성 중...' },
  { step: 'validator', label: 'Validator', description: '일정 검증 중...' },
  { step: 'alternative', label: 'Alternative Agent', description: '대안 장소 탐색 중...' },
] as const;

const START_HOUR_OPTIONS = ['07:00', '08:00', '09:00', '10:00', '11:00', '12:00'];
const END_HOUR_OPTIONS = ['18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];

const CATEGORY_LABELS: PlaceCategory[] = ['맛집', '카페', '관광지', '숙소', '액티비티'];

export default function GenerateClient({ room, places, pins }: GenerateClientProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('setup');
  const [currentStep, setCurrentStep] = useState(-1);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('21:00');
  // 위시리스트에 숙소가 있으면 포함, 없으면 제외로 자동 설정
  const [includeStay, setIncludeStay] = useState(() => places.some((p) => p.category === '숙소'));
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  // 위시리스트에 숙소 장소가 있는지 여부
  const hasStayPlaces = places.some((p) => p.category === '숙소');

  const nonExcludedPlaces = places.filter((p) => p.category !== '숙소' || includeStay);
  const totalPlaces = places.length;

  // 카테고리별 장소 수
  const categoryCounts = CATEGORY_LABELS.map((cat) => ({
    category: cat,
    count: places.filter((p) => p.category === cat).length,
  })).filter((c) => c.count > 0);

  // 숙소 날짜 등록 여부 (pins 기반)
  const hasStay = pins.some((p) => p.type === 'STAY');

  // hasStayPlaces 변경 시 includeStay 자동 동기화
  useEffect(() => {
    setIncludeStay(hasStayPlaces);
  }, [hasStayPlaces]);

  // done 상태 시 itinerary 페이지로 자동 이동
  useEffect(() => {
    if (phase !== 'done') return;
    const timer = setTimeout(() => {
      router.push(`/room/${room.id}/itinerary`);
    }, 1500);
    return () => clearTimeout(timer);
  }, [phase, room.id, router]);

  const handleGenerate = async () => {
    // 날짜 미등록 숙소 경고 (차단 아님)
    const unregisteredStays = places.filter(
      (p) => p.category === '숙소' && !pins.some((pin) => pin.place_id === p.id && pin.type === 'STAY')
    );
    if (unregisteredStays.length > 0) {
      toast.warning(
        `날짜가 등록되지 않은 숙소(${unregisteredStays.map((p) => p.name).join(', ')})는 일정에서 제외됩니다.`
      );
    }

    setPhase('generating');
    setErrorMsg(null);
    setCurrentStep(-1);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    try {
      const res = await generateItineraryStream(room.id);
      clearTimeout(timeout);

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (event.type === 'progress' && event.status === 'started') {
              const stepIdx = AGENT_STEPS.findIndex((s) => s.step === event.step);
              if (stepIdx !== -1) setCurrentStep(stepIdx);
            } else if (event.type === 'progress' && event.status === 'completed') {
              const stepIdx = AGENT_STEPS.findIndex((s) => s.step === event.step);
              if (stepIdx !== -1) setCurrentStep(stepIdx + 1);
            } else if (event.type === 'done') {
              setCurrentStep(AGENT_STEPS.length);
              setPhase('done');
            } else if (event.type === 'error') {
              setErrorMsg(event.message || '일정 생성 중 오류가 발생했습니다.');
              setPhase('setup');
            }
          } catch {
            // JSON 파싱 오류 무시
          }
        }
      }
    } catch {
      clearTimeout(timeout);
      const nextRetry = retryCount + 1;
      setRetryCount(nextRetry);
      if (nextRetry < 3) {
        setErrorMsg(`연결 오류가 발생했습니다. 재시도 중... (${nextRetry}/3)`);
      } else {
        setErrorMsg('연결 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.');
      }
      setPhase('setup');
    }
  };

  if (phase === 'generating' || phase === 'done') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-8">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-xl font-bold">AI가 최적 일정을 만들고 있어요</h2>
          <p className="text-sm text-muted-foreground">{room.destination} · {room.start_date} ~ {room.end_date}</p>
        </div>

        <div className="flex flex-col gap-4 w-full max-w-sm">
          {AGENT_STEPS.map((step, idx) => {
            const isDone = currentStep > idx;
            const isActive = currentStep === idx;
            return (
              <div
                key={step.step}
                className={cn(
                  'flex items-center gap-4 rounded-xl border p-4 transition-all',
                  isDone && 'border-green-200 bg-green-50',
                  isActive && 'border-primary/30 bg-primary/5',
                  !isDone && !isActive && 'border-muted bg-muted/30 opacity-50'
                )}
              >
                <div className="shrink-0">
                  {isDone ? (
                    <div className="size-8 rounded-full bg-green-500 flex items-center justify-center">
                      <Check className="size-4 text-white" />
                    </div>
                  ) : isActive ? (
                    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Loader2 className="size-4 text-primary animate-spin" />
                    </div>
                  ) : (
                    <div className="size-8 rounded-full bg-muted flex items-center justify-center">
                      <Circle className="size-4 text-muted-foreground" />
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className={cn('text-sm font-semibold', isDone && 'text-green-700', isActive && 'text-primary')}>
                    {step.label}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isDone ? '완료' : isActive ? step.description : '대기 중'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {phase === 'done' && (
          <div className="flex flex-col items-center gap-2 text-green-600 animate-in fade-in">
            <Check className="size-8" />
            <p className="text-sm font-medium">일정 생성 완료! 결과 페이지로 이동 중...</p>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg mx-auto">
      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-bold">일정 생성</h1>
        <p className="text-sm text-muted-foreground">
          {room.destination} · {room.start_date} ~ {room.end_date}
        </p>
      </div>

      {/* 에러 메시지 */}
      {errorMsg && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 flex items-start gap-3">
          <AlertCircle className="size-4 text-destructive shrink-0 mt-0.5" />
          <div className="flex flex-col gap-2 flex-1">
            <p className="text-sm text-destructive">{errorMsg}</p>
            {retryCount < 3 && (
              <Button
                size="sm"
                variant="outline"
                className="w-fit border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={handleGenerate}
              >
                다시 시도
              </Button>
            )}
          </div>
        </div>
      )}

      {/* 저장된 장소 요약 */}
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <MapPin className="size-4 text-primary" />
          <span className="text-sm font-semibold">저장된 장소 요약</span>
          <span className="ml-auto text-sm font-bold text-primary">{totalPlaces}곳</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {categoryCounts.map(({ category, count }) => (
            <div key={category} className="flex items-center gap-1.5">
              <CategoryBadge category={category} />
              <span className="text-xs text-muted-foreground">{count}곳</span>
            </div>
          ))}
        </div>
        {!hasStay && (
          <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2">
            숙소가 등록되지 않았습니다. 일정 생성 후 추천 숙소 구역을 확인하세요.
          </p>
        )}
      </div>

      {/* 활동 시간 설정 */}
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Clock className="size-4 text-primary" />
          <span className="text-sm font-semibold">하루 활동 시간</span>
          <span className="ml-auto text-xs font-medium text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
            추후 개발 예정
          </span>
        </div>
        <div className="flex items-center gap-3 opacity-50 pointer-events-none">
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">시작 시간</label>
            <select
              value={startTime}
              disabled
              className="rounded-lg border bg-muted px-3 py-2 text-sm cursor-not-allowed"
            >
              {START_HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
          <ChevronRight className="size-4 text-muted-foreground mt-4 shrink-0" />
          <div className="flex flex-col gap-1 flex-1">
            <label className="text-xs text-muted-foreground">종료 시간</label>
            <select
              value={endTime}
              disabled
              className="rounded-lg border bg-muted px-3 py-2 text-sm cursor-not-allowed"
            >
              {END_HOUR_OPTIONS.map((h) => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">현재 MVP 버전에서는 활동 시간 설정이 지원되지 않습니다.</p>
      </div>

      {/* 숙소 모드 (위시리스트 숙소 유무에 따라 자동 설정, 변경 불가) */}
      <div className="rounded-xl border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <BedDouble className="size-4 text-primary" />
          <span className="text-sm font-semibold">숙소 일정 포함</span>
        </div>
        <div className="flex gap-2">
          <button
            className={cn(
              'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors cursor-not-allowed opacity-70',
              includeStay
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted bg-muted/30 text-muted-foreground'
            )}
          >
            숙소 포함
          </button>
          <button
            className={cn(
              'flex-1 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors cursor-not-allowed opacity-70',
              !includeStay
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-muted bg-muted/30 text-muted-foreground'
            )}
          >
            숙소 제외
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {hasStayPlaces
            ? '위시리스트에 숙소가 있어 숙소 포함으로 자동 설정되었습니다.'
            : '위시리스트에 숙소가 없어 숙소 제외로 자동 설정되었습니다.'}
        </p>
      </div>

      {/* 생성 버튼 */}
      {nonExcludedPlaces.length === 0 ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center text-sm text-destructive">
          일정을 생성하려면 최소 1개 이상의 장소가 필요합니다.
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          onClick={handleGenerate}
        >
          AI 일정 생성 시작
        </Button>
      )}
    </div>
  );
}
