'use client'

import { getSupabaseClient } from '@/lib/supabase'

// 싱글턴 인스턴스를 반환하여 중복 GoTrueClient 인스턴스 생성 방지
export function createClient() {
  return getSupabaseClient()
}
