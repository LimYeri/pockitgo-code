// 공통 푸터 컴포넌트 (서버 컴포넌트)
export default function Footer() {
  return (
    <footer className="mt-auto py-6 border-t border-border">
      <div className="mx-auto max-w-4xl w-full px-4 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} PockitGo. All rights reserved.
      </div>
    </footer>
  );
}
