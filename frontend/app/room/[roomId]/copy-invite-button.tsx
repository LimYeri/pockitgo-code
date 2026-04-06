'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';

// 초대 링크 복사 버튼 클라이언트 컴포넌트
export default function CopyInviteButton({ inviteLink }: { inviteLink: string }) {
  const [isCopied, setIsCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(inviteLink).then(() => {
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 1500);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCopy} className="gap-1.5">
      {isCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {isCopied ? '복사됨!' : '초대 링크 복사'}
    </Button>
  );
}
