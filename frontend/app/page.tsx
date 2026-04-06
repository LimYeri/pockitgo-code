import Link from 'next/link';
import { Users, Sparkles, MapPin } from 'lucide-react';
import PageWrapper from '@/components/PageWrapper';
import { Card, CardContent } from '@/components/ui/card';

const FEATURES = [
  {
    icon: Users,
    title: '그룹 위시리스트',
    description: '초대 링크 하나로 멤버 전원의 희망 장소를 한 곳에 모아 실시간 동기화',
  },
  {
    icon: Sparkles,
    title: 'AI 동선 최적화',
    description: '3-Agent AI가 운영시간·고정 핀·숙소를 모두 고려해 최적 동선 자동 생성',
  },
  {
    icon: MapPin,
    title: '플랜 B/C 대안',
    description: '모든 장소에 대안 2곳을 미리 탐색해 돌발상황 즉시 대응',
  },
];

// 랜딩 페이지 (서버 컴포넌트)
export default function Home() {
  return (
    <PageWrapper>
      {/* Hero 섹션 */}
      <div className="flex flex-col items-center justify-center text-center gap-8 py-16">
        <div className="flex flex-col gap-4">
          <h1 className="text-5xl font-bold text-foreground">PockitGo</h1>
          <p className="text-xl text-muted-foreground max-w-lg">
            가고 싶은 곳을 뽁 찍으면, AI가 동선과 일정까지 자동으로 최적화해주는 그룹 여행 플래너
          </p>
        </div>

        {/* CTA 버튼 */}
        <div className="flex flex-col sm:flex-row gap-4">
          <Link
            href="/create"
            className="inline-flex items-center justify-center h-10 px-6 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity text-sm"
          >
            여행방 만들기
          </Link>
          <Link
            href="/join/sample-token"
            className="inline-flex items-center justify-center h-10 px-6 rounded-lg border border-border text-foreground font-medium hover:bg-muted transition-colors text-sm"
          >
            초대 링크로 참여하기
          </Link>
        </div>
      </div>

      {/* 서비스 특징 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        {FEATURES.map(({ icon: Icon, title, description }) => (
          <Card key={title}>
            <CardContent className="flex flex-col items-center text-center gap-3 pt-2">
              <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                <Icon className="size-5 text-primary" />
              </div>
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold text-sm text-foreground">{title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </PageWrapper>
  );
}
