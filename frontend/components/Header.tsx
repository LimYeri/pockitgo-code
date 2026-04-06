import Link from 'next/link';

// 공통 헤더 컴포넌트 (서버 컴포넌트)
export default function Header() {
  return (
    <header className="fixed top-0 w-full bg-white border-b border-border z-50">
      <div className="mx-auto max-w-4xl w-full px-4 h-14 flex items-center justify-between">
        {/* 로고 */}
        <Link href="/" className="text-xl font-bold text-primary">
          PockitGo
        </Link>

        {/* 네비게이션 (추후 구현) */}
        <nav aria-label="주요 네비게이션" />
      </div>
    </header>
  );
}
