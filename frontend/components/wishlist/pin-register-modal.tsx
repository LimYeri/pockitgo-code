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
import type { Place, TravelRoom } from '@/types';

interface PinRegisterModalProps {
  open: boolean;
  targetPlace: Place | null;
  room: TravelRoom;
  onClose: () => void;
  onRegister: (place: Place, date: string, time: string) => void;
}

export function PinRegisterModal({
  open,
  targetPlace,
  room,
  onClose,
  onRegister,
}: PinRegisterModalProps) {
  const [pinDate, setPinDate] = useState(room.start_date);
  const [pinTime, setPinTime] = useState('10:00');

  // 모달 열릴 때 상태 초기화
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPinDate(room.start_date);
      setPinTime('10:00');
    }
  }, [open, room.start_date]);

  const handleRegister = () => {
    if (!targetPlace || !pinDate) return;
    onRegister(targetPlace, pinDate, pinTime);
  };

  return (
    <Dialog open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            고정 핀 등록
            {targetPlace && (
              <span className="ml-2 text-sm font-normal text-muted-foreground">
                — {targetPlace.name}
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <DatePicker
            label="날짜"
            value={pinDate}
            onChange={setPinDate}
            min={room.start_date}
            max={room.end_date}
            required
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              시간 <span className="ml-1 text-destructive">*</span>
            </label>
            <input
              type="time"
              value={pinTime}
              onChange={(e) => setPinTime(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button onClick={handleRegister} disabled={!pinDate}>
            등록
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
