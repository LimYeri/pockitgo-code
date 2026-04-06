import PageWrapper from '@/components/PageWrapper';
import JoinForm from './join-form';
import { getRoomByInvite } from '@/lib/api';

// 여행방 참여 페이지 (서버 컴포넌트)
// Next.js 16.2: params는 Promise 타입 — async + await 필수
export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  let room = null;
  try {
    room = await getRoomByInvite(token);
  } catch {
    // 유효하지 않은 초대 링크
  }

  if (!room) {
    return (
      <PageWrapper>
        <div className="max-w-md mx-auto flex flex-col gap-4">
          <h1 className="text-2xl font-bold text-foreground">유효하지 않은 링크입니다</h1>
          <p className="text-sm text-muted-foreground">
            초대 링크가 만료되었거나 올바르지 않습니다. 초대한 멤버에게 링크를 다시 받아보세요.
          </p>
        </div>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <JoinForm token={token} room={room} />
    </PageWrapper>
  );
}
