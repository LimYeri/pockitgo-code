import { createBrowserClient } from '@supabase/ssr';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import type { Place } from '@/types';

// 브라우저 컨텍스트에서 단일 인스턴스를 보장하는 싱글턴
let _supabase: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseClient() {
  if (!_supabase) {
    _supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
  }
  return _supabase;
}

// 하위 호환성을 위한 named export (기존 코드 변경 최소화)
export const supabase = getSupabaseClient();

// places 테이블 Realtime 구독 헬퍼
export function subscribeToPlaces(
  roomId: string,
  callback: (payload: { eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Place; old: Partial<Place> }) => void
) {
  const channel = supabase
    .channel(`places:room_id=eq.${roomId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'places',
        filter: `room_id=eq.${roomId}`,
      },
      (payload: RealtimePostgresChangesPayload<Place>) => {
        callback({
          eventType: payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
          new: payload.new as Place,
          old: payload.old as Partial<Place>,
        });
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
