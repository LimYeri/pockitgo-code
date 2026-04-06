'use client';

import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Copy, Check } from 'lucide-react';
import PageWrapper from '@/components/PageWrapper';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { createRoom, joinRoom } from '@/lib/api';
import { createClient } from '@/lib/supabase/client';
import { searchDestinations, POPULAR_DESTINATIONS } from '@/lib/destinations';
import type { TravelRoom } from '@/types';

// 여행방 생성 페이지
export default function CreatePage() {
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showDestDropdown, setShowDestDropdown] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dateError, setDateError] = useState('');
  const [showSuccessModal, setShowSuccessModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [createdRoom, setCreatedRoom] = useState<TravelRoom | null>(null);
  const [inviteLink, setInviteLink] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [nickname, setNickname] = useState('');
  const [nicknameError, setNicknameError] = useState('');
  const [isJoining, setIsJoining] = useState(false);

  // 여행지 dropdown 외부 클릭 시 닫기
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDestDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, []);

  // 여행지 입력창 포커스 시 인기 여행지 표시
  function handleDestinationFocus() {
    setShowDestDropdown(true);
    if (!destination.trim()) {
      setSuggestions(POPULAR_DESTINATIONS);
    }
  }

  // 여행지 입력 시 초성 포함 실시간 검색
  function handleDestinationChange(value: string) {
    setDestination(value);
    setShowDestDropdown(true);
    if (!value.trim()) {
      setSuggestions(POPULAR_DESTINATIONS);
    } else {
      setSuggestions(searchDestinations(value));
    }
  }

  function handleStartDateChange(value: string) {
    setStartDate(value);
    if (endDate && value && endDate < value) {
      setDateError('종료일은 시작일 이후여야 합니다');
    } else {
      setDateError('');
    }
  }

  function handleEndDateChange(value: string) {
    setEndDate(value);
    if (startDate && value && value < startDate) {
      setDateError('종료일은 시작일 이후여야 합니다');
    } else {
      setDateError('');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !destination || !startDate || !endDate) return;
    if (dateError) return;

    setIsSubmitting(true);
    setSubmitError('');
    try {
      const room = await createRoom({
        title: title.trim(),
        destination,
        start_date: startDate,
        end_date: endDate,
      });
      setCreatedRoom(room);
      setInviteLink(`${window.location.origin}/join/${room.invite_link}`);
      setShowSuccessModal(true);
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : '여행방 생성에 실패했습니다');
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    });
  }

  async function handleEnterRoom() {
    if (!createdRoom) return;
    if (!nickname.trim()) {
      setNicknameError('닉네임을 입력해주세요');
      return;
    }

    setIsJoining(true);
    setNicknameError('');
    try {
      // Supabase 익명 세션 생성
      let authId: string;
      const supabase = createClient();
      const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
      if (authError || !authData.user) {
        authId = crypto.randomUUID();
      } else {
        authId = authData.user.id;
      }

      // 방 생성자를 멤버로 등록
      await joinRoom(createdRoom.id, { nickname: nickname.trim(), auth_id: authId });

      router.push(`/room/${createdRoom.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '입장에 실패했습니다';
      setNicknameError(message);
      setIsJoining(false);
    }
  }

  return (
    <PageWrapper>
      <div className="max-w-md mx-auto flex flex-col gap-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold text-foreground">여행방 만들기</h1>
          <p className="text-sm text-muted-foreground">여행 정보를 입력하고 멤버를 초대하세요</p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {/* 여행 제목 */}
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">
              여행 제목 <span className="text-destructive">*</span>
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 제주도 봄 여행"
              required
            />
          </div>

          {/* 여행지 자동완성 (Kakao API) */}
          <div className="flex flex-col gap-1.5" ref={containerRef}>
            <label className="text-sm font-medium text-foreground">
              여행지 <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Input
                value={destination}
                onChange={(e) => handleDestinationChange(e.target.value)}
                onFocus={handleDestinationFocus}
                placeholder="예: 제주도"
                required
              />
              {showDestDropdown && suggestions.length > 0 && (
                <ul className="absolute top-full left-0 right-0 z-10 mt-1 rounded-lg border border-border bg-background shadow-md max-h-48 overflow-auto">
                  {!destination.trim() && (
                    <li className="px-3 py-1.5 text-xs text-muted-foreground cursor-default select-none">
                      인기 여행지
                    </li>
                  )}
                  {suggestions.map((dest) => (
                    <li
                      key={dest}
                      className="px-3 py-2 text-sm cursor-pointer hover:bg-muted transition-colors"
                      onMouseDown={() => {
                        setDestination(dest);
                        setShowDestDropdown(false);
                      }}
                    >
                      {dest}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* 여행 날짜 */}
          <div className="grid grid-cols-2 gap-3">
            <DatePicker
              label="시작일"
              value={startDate}
              onChange={handleStartDateChange}
              required
            />
            <DatePicker
              label="종료일"
              value={endDate}
              onChange={handleEndDateChange}
              min={startDate}
              error={dateError}
              required
            />
          </div>

          {submitError && (
            <p className="text-sm text-destructive">{submitError}</p>
          )}

          <Button type="submit" size="lg" className="w-full mt-2" disabled={isSubmitting}>
            {isSubmitting ? '생성 중...' : '여행방 만들기'}
          </Button>
        </form>
      </div>

      {/* 생성 완료 모달 */}
      <Dialog open={showSuccessModal} onOpenChange={setShowSuccessModal}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>여행방이 생성되었습니다!</DialogTitle>
            <DialogDescription>
              닉네임을 입력하고 여행방에 입장하세요
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground break-all">
              {inviteLink}
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground">
                내 닉네임 <span className="text-destructive">*</span>
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
              />
              {nicknameError && (
                <p className="text-xs text-destructive">{nicknameError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={handleCopy} className="gap-2">
              {isCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {isCopied ? '복사됨!' : '링크 복사'}
            </Button>
            <Button onClick={handleEnterRoom} disabled={isJoining}>
              {isJoining ? '입장 중...' : '여행방 바로 가기'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
