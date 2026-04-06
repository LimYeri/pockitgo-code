import PageWrapper from '@/components/PageWrapper';
import GenerateClient from './generate-client';
import { getRoom, getPlaces, getPins } from '@/lib/api';

// 일정 생성 페이지
// Next.js 16.2: params는 Promise 타입 — async + await 필수
export default async function GeneratePage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const [room, places, pins] = await Promise.all([
    getRoom(roomId),
    getPlaces(roomId),
    getPins(roomId),
  ]);

  return (
    <PageWrapper>
      <GenerateClient room={room} places={places} pins={pins} />
    </PageWrapper>
  );
}
