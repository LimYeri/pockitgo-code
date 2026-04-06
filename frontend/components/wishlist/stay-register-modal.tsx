'use client';

import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import { toast } from 'sonner';
import type { Place, TravelRoom, SchedulePin } from '@/types';

function getDayNumber(targetDate: string, startDate: string): number {
  const diff = new Date(targetDate).getTime() - new Date(startDate).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
}

function getDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start);
  const endDate = new Date(end);
  while (cur < endDate) {
    dates.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

interface StayRegisterModalProps {
  open: boolean;
  targetPlace: Place | null;
  room: TravelRoom;
  pins: SchedulePin[];
  onClose: () => void;
  onRegister: (
    place: Place,
    checkinDate: string,
    checkoutDate: string
  ) => void;
}

export function StayRegisterModal({
  open,
  targetPlace,
  room,
  pins,
  onClose,
  onRegister,
}: StayRegisterModalProps) {
  const [checkinDate, setCheckinDate] = useState(room.start_date);
  const [checkoutDate, setCheckoutDate] = useState(room.end_date);

  // 모달 열릴 때 상태 초기화
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCheckinDate(room.start_date);
      setCheckoutDate(room.end_date);
    }
  }, [open, room.start_date, room.end_date]);

  // 체크인 날짜 변경 시 체크아웃이 앞서면 체크아웃도 조정
  const handleCheckinDateChange = (date: string) => {
    setCheckinDate(date);
    if (checkoutDate < date) {
      setCheckoutDate(date);
    }
  };

  const existingStayDateRanges = pins
    .filter((p) => p.type === 'STAY')
    .flatMap((p) => getDateRange(p.pinned_date ?? '', p.checkout_date ?? p.pinned_date ?? ''));

  const handleRegister = () => {
    if (!targetPlace || !checkinDate || !checkoutDate) return;
    const newDates = getDateRange(checkinDate, checkoutDate);
    const conflict = newDates.find((d) => existingStayDateRanges.includes(d));
    if (conflict) {
      toast.error(`${conflict} 날짜에 이미 숙소가 등록되어 있습니다.`);
      return;
    }
    onRegister(targetPlace, checkinDate, checkoutDate);
  };

  const checkinDay = checkinDate ? getDayNumber(checkinDate, room.start_date) : null;
  const checkoutDay = checkoutDate ? getDayNumber(checkoutDate, room.start_date) : null;
  const stayNights = checkinDay !== null && checkoutDay !== null ? checkoutDay - checkinDay : null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            숙소 등록
            {targetPlace && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {targetPlace.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <DatePicker
            label="체크인 날짜"
            value={checkinDate}
            onChange={handleCheckinDateChange}
            min={room.start_date}
            max={room.end_date}
            required
          />

          <DatePicker
            label="체크아웃 날짜"
            value={checkoutDate}
            onChange={setCheckoutDate}
            min={checkinDate}
            max={room.end_date}
            required
          />

          {checkinDay !== null && checkoutDay !== null && stayNights !== null && stayNights > 0 && (
            <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
              {checkinDay}일차(체크인) ~ {checkoutDay}일차(퇴실) · {stayNights}박
              <br />
              {checkinDay}일차 ~ {checkoutDay - 1}일차 일정 마지막에 고정 배치됩니다.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleRegister} disabled={!checkinDate || !checkoutDate}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
