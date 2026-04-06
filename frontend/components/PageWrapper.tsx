// 페이지 콘텐츠 공통 래퍼 컴포넌트 (서버 컴포넌트)
// 최대 너비 제한 및 수평 패딩 공통화
export default function PageWrapper({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-4xl w-full px-4 pt-20 pb-8 flex-1">
      {children}
    </main>
  );
}
