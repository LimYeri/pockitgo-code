'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import type { TravelRoom, Itinerary, ExcludedPlace } from '@/types';

const BTN_CLASS =
  'inline-flex items-center justify-center gap-1.5 rounded-md border border-input bg-background px-3 h-9 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

// 윈도우 파일명 금지 문자 제거
function sanitizeFileName(name: string) {
  return name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
}

interface PdfDownloadButtonProps {
  room: TravelRoom;
  schedules: Itinerary[];
  excludedPlaces: ExcludedPlace[];
}

export function PdfDownloadButton({ room, schedules, excludedPlaces }: PdfDownloadButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const safeTitle = sanitizeFileName(room.title || 'itinerary');
  const fileName = `${safeTitle}_${today}.pdf`;

  const handleDownload = async () => {
    setIsGenerating(true);
    setError(null);

    try {
      // SSR 충돌 방지를 위해 런타임에 동적 import
      const { pdf, Font } = await import('@react-pdf/renderer');

      // public/fonts/ 기준 절대 경로 — 브라우저가 fetch 시 안정적
      Font.register({
        family: 'NotoSansKR',
        fonts: [
          { src: '/fonts/NotoSansKR-Regular.ttf', fontWeight: 'normal' },
          { src: '/fonts/NotoSansKR-Medium.ttf', fontWeight: 500 },
          { src: '/fonts/NotoSansKR-Bold.ttf', fontWeight: 'bold' },
        ],
      });

      const { ItineraryPDF } = await import('@/components/pdf/ItineraryPDF');
      const blob = await pdf(
        <ItineraryPDF room={room} schedules={schedules} excludedPlaces={excludedPlaces} />
      ).toBlob();

      // blob에 MIME 타입 명시 후 다운로드
      const pdfBlob = new Blob([blob], { type: 'application/pdf' });
      const url = URL.createObjectURL(pdfBlob);

      // a.click() 으로 직접 다운로드 — download 속성에 파일명 완전 제어
      const a = document.createElement('a');
      a.setAttribute('href', url);
      a.setAttribute('download', fileName);
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error('PDF 생성 오류:', e);
      setError(
        e instanceof Error ? `PDF 생성 실패: ${e.message}` : 'PDF 생성 중 오류가 발생했습니다.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleDownload}
        disabled={isGenerating}
        className={BTN_CLASS}
        type="button"
      >
        <Download className="size-4" />
        {isGenerating ? '생성 중...' : 'PDF 저장'}
      </button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
