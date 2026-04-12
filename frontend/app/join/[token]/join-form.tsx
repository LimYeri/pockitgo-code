'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, Calendar } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from '@/components/ui/card';
import { createClient } from '@/lib/supabase/client';
import { joinRoom, getMemberByAuthId } from '@/lib/api';
import type { TravelRoom } from '@/types';

// 여행방 참여 폼 클라이언트 컴포넌트
export default function JoinForm({ token, room }: { token: string; room: TravelRoom }) {
  const router = useRouter();
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // 기존 세션 확인 — 이미 이 방의 멤버면 자동 입장
  useEffect(() => {
    async function checkExistingSession() {
      try {
        const supabase = createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          const member = await getMemberByAuthId(room.id, session.user.id);
          if (member) {
            localStorage.setItem('memberId', member.id);
            toast.success('이미 참여한 여행방입니다. 입장합니다...');
            router.push(`/room/${room.id}`);
            return;
          }
        }
      } catch {
        // 세션 확인 실패 시 폼 표시로 폴백
      }
      setIsChecking(false);
    }
    checkExistingSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nickname.trim()) {
      setNicknameError('닉네임을 입력해주세요');
      return;
    }

    setIsSubmitting(true);
    setNicknameError('');

    try {
      // Supabase 익명 세션 생성 (실패 시 랜덤 UUID fallback)
      let authId: string;
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
      if (authError || !authData.user) {
        // 익명 로그인 비활성화 환경에서의 fallback
        authId = crypto.randomUUID();
      } else {
        authId = authData.user.id;
      }

      // 멤버 등록 API 호출
      const member = await joinRoom(room.id, { nickname: nickname.trim(), auth_id: authId });
      localStorage.setItem('memberId', member.id);

      router.push(`/room/${room.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '참여에 실패했습니다';

      // 닉네임 중복 오류 시 이미 참여한 계정인지 추가 확인
      if (message === '이미 사용 중인 닉네임입니다') {
        try {
          const supabase = createClient();
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            const member = await getMemberByAuthId(room.id, session.user.id);
            if (member) {
              toast.success('이미 이 여행방에 참여하신 계정입니다. 입장합니다...');
              router.push(`/room/${room.id}`);
              return;
            }
          }
        } catch {
          // 확인 실패 시 원래 오류 메시지 표시
        }
      }

      setNicknameError(message);
      setIsSubmitting(false);
    }
  }

  // 세션 확인 중 로딩 UI
  if (isChecking) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <p className="text-sm text-muted-foreground">확인 중...</p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-foreground">여행방 참여하기</h1>
        <p className="text-sm text-muted-foreground">닉네임을 입력하고 여행방에 참여하세요</p>
      </div>

      {/* 여행방 정보 미리보기 */}
      <Card>
        <CardHeader>
          <CardTitle>{room.title}</CardTitle>
          <CardDescription>초대 코드: {token}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
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

      {/* 닉네임 입력 폼 */}
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-foreground">
            닉네임 <span className="text-destructive">*</span>
          </label>
          <Input
            value={nickname}
            onChange={(e) => {
              setNickname(e.target.value);
              if (nicknameError) setNicknameError('');
            }}
            placeholder="최대 10자"
            maxLength={10}
            aria-invalid={!!nicknameError}
            required
          />
          {nicknameError && (
            <p className="text-xs text-destructive">{nicknameError}</p>
          )}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting ? '참여 중...' : '참여하기'}
        </Button>
      </form>
    </div>
  );
}
