'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getMemberByAuthId } from '@/lib/api';

// Room 하위 모든 페이지에 멤버십 확인 가드를 적용하는 레이아웃
export default function RoomLayout({ children }: { children: React.ReactNode }) {
  const { roomId } = useParams<{ roomId: string }>();
  const router = useRouter();
  const [isChecking, setIsChecking] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    async function checkAuth() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();

        // 세션 없으면 홈으로 (히스토리 남기지 않음)
        if (!session?.user) {
          router.replace('/');
          return;
        }

        const member = await getMemberByAuthId(roomId, session.user.id);

        if (member) {
          setIsAuthorized(true);
          setIsChecking(false);
        } else {
          // 이 방의 멤버가 아니면 홈으로
          router.replace('/');
        }
      } catch {
        // 오류 발생 시 홈으로
        router.replace('/');
      }
    }

    checkAuth();
  }, [roomId, router]);

  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-muted-foreground">로딩 중...</p>
      </div>
    );
  }

  if (isAuthorized) {
    return <>{children}</>;
  }

  // 리다이렉트 진행 중
  return null;
}
