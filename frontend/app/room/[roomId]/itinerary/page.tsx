import { notFound } from 'next/navigation';
import PageWrapper from '@/components/PageWrapper';
import ItineraryClient from './itinerary-client';
import { getRoom, getItinerary, getPins } from '@/lib/api';

// 일정 결과 페이지
// Next.js 16.2: params는 Promise 타입 — async + await 필수
export default async function ItineraryPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  const room = await getRoom(roomId).catch(() => null);
  if (!room) notFound();

  const [itinerary, pins] = await Promise.all([
    getItinerary(roomId).catch(() => []),
    getPins(roomId).catch(() => []),
  ]);
  const hasStay = pins.some((p) => p.type === 'STAY');

  return (
    <PageWrapper>
      <ItineraryClient room={room} itinerary={itinerary} hasStay={hasStay} />
    </PageWrapper>
  );
}
