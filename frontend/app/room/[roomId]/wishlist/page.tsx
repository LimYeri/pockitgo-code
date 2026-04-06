import PageWrapper from '@/components/PageWrapper';
import WishlistClient from './wishlist-client';

// 위시리스트 페이지 (서버 컴포넌트)
// Next.js 16.2: params는 Promise 타입 — async + await 필수
export default async function WishlistPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;

  return (
    <PageWrapper>
      <WishlistClient roomId={roomId} />
    </PageWrapper>
  );
}
