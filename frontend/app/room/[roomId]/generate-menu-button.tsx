'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles, ChevronRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { getItinerary } from '@/lib/api';

interface GenerateMenuButtonProps {
  roomId: string;
}

// 일정 생성하기 메뉴 버튼
// 이미 생성된 일정이 있으면 확인 다이얼로그를 표시하고, 없으면 바로 이동
export default function GenerateMenuButton({ roomId }: GenerateMenuButtonProps) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const handleClick = async () => {
    setIsLoading(true);
    try {
      const itinerary = await getItinerary(roomId);
      if (itinerary.length > 0) {
        // 이미 생성된 일정이 있으면 확인 다이얼로그 표시
        setDialogOpen(true);
      } else {
        // 일정이 없으면 바로 일정 생성 페이지로 이동
        router.push(`/room/${roomId}/generate`);
      }
    } catch {
      // API 오류 시 그냥 생성 페이지로 이동
      router.push(`/room/${roomId}/generate`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Card
        className="hover:bg-muted/50 transition-colors cursor-pointer"
        onClick={handleClick}
      >
        <CardContent className="flex items-center justify-between pt-2">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-primary/10">
              <Sparkles className="size-5 text-primary" />
            </div>
            <div className="flex flex-col gap-0.5">
              <span className="font-medium text-sm text-foreground">
                {isLoading ? '확인 중...' : '일정 생성하기'}
              </span>
              <span className="text-xs text-muted-foreground">
                AI가 최적 동선을 만들어드려요
              </span>
            </div>
          </div>
          <ChevronRight className="size-4 text-muted-foreground" />
        </CardContent>
      </Card>

      {/* 이미 생성된 일정 존재 시 확인 다이얼로그 */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>이미 생성된 일정이 있습니다</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            보러가시겠습니까? 새로 생성하면 기존 일정이 대체됩니다.
          </p>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                router.push(`/room/${roomId}/generate`);
              }}
            >
              새로 생성하기
            </Button>
            <Button
              onClick={() => {
                setDialogOpen(false);
                router.push(`/room/${roomId}/itinerary`);
              }}
            >
              보러가기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
