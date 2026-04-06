import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { MapPin, Users, Calendar, Heart, ChevronRight } from 'lucide-react';
import PageWrapper from '@/components/PageWrapper';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import CopyInviteButton from './copy-invite-button';
import GenerateMenuButton from './generate-menu-button';
import { getRoom, getMembers, getPlaces } from '@/lib/api';

// 항상 동적 렌더링 강제 — Router Cache 및 Data Cache 캐싱 방지
export const dynamic = 'force-dynamic';

// 여행방 메인 페이지 (서버 컴포넌트)
// Next.js 16.2: params는 Promise 타입 — async + await 필수
export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  const room = await getRoom(roomId).catch(() => null);
  if (!room) notFound();

  const [members, places] = await Promise.all([
    getMembers(roomId).catch(() => []),
    getPlaces(roomId).catch(() => []),
  ]);

  // 요청 헤더에서 호스트 추출하여 초대 링크 생성
  const headersList = await headers();
  const host = headersList.get('host') ?? 'localhost:3000';
  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
  const inviteLink = `${protocol}://${host}/join/${room.invite_link}`;

  return (
    <PageWrapper>
      <div className="flex flex-col gap-6">
        {/* 여행 정보 헤더 */}
        <Card>
          <CardHeader className="border-b">
            <div className="flex items-start justify-between gap-4">
              <CardTitle className="text-xl">{room.title}</CardTitle>
              <CopyInviteButton inviteLink={inviteLink} />
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground pt-4">
            <div className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0" />
              <span>{room.destination}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="size-4 shrink-0" />
              <span>{room.start_date} ~ {room.end_date}</span>
            </div>
          </CardContent>
        </Card>

        {/* 멤버 및 장소 정보 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 멤버 목록 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">멤버 {members.length}명</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {members.length === 0 ? (
                  <span className="text-sm text-muted-foreground">아직 참여한 멤버가 없습니다</span>
                ) : (
                  members.map((member) => (
                    <Badge key={member.id} variant="secondary">
                      {member.nickname}
                    </Badge>
                  ))
                )}
              </div>
            </CardContent>
          </Card>

          {/* 저장된 장소 수 */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <MapPin className="size-4 text-muted-foreground" />
                <CardTitle className="text-base">저장된 장소</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-foreground">
                {places.length}
                <span className="text-sm font-normal text-muted-foreground ml-1">개</span>
              </p>
            </CardContent>
          </Card>
        </div>

        {/* 메뉴 카드 */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Link href={`/room/${roomId}/wishlist`}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="flex items-center justify-between pt-2">
                <div className="flex items-center gap-3">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
                    <Heart className="size-5 text-primary" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium text-sm text-foreground">위시리스트 보기</span>
                    <span className="text-xs text-muted-foreground">장소를 추가하고 관리하세요</span>
                  </div>
                </div>
                <ChevronRight className="size-4 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>

          <GenerateMenuButton roomId={roomId} />
        </div>
      </div>
    </PageWrapper>
  );
}
