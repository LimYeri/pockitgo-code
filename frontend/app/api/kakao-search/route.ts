import { NextResponse } from 'next/server';

// Kakao REST API 프록시 — 서버에서 API 키를 안전하게 사용
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');

  if (!query?.trim()) {
    return NextResponse.json({ documents: [] });
  }

  const apiKey = process.env.KAKAO_MAP_KEY;
  if (!apiKey) {
    return NextResponse.json({ documents: [] });
  }

  const kakaoUrl = `https://dapi.kakao.com/v2/local/search/keyword.json?query=${encodeURIComponent(query)}&size=8`;

  const origin = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const res = await fetch(kakaoUrl, {
    headers: {
      Authorization: `KakaoAK ${apiKey}`,
      Origin: origin,
      KA: `sdk/1.0 os/web origin/${origin}`,
    },
    next: { revalidate: 0 },
  });

  if (!res.ok) {
    return NextResponse.json({ documents: [] });
  }

  const data = await res.json();
  return NextResponse.json(data);
}
