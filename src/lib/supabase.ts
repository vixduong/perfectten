import { createClient } from '@supabase/supabase-js'
import { useQuery } from '@tanstack/react-query'
import type { Profile } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) throw new Error('Thiếu VITE_SUPABASE_URL hoặc VITE_SUPABASE_ANON_KEY (xem .env.example)')

// Mọi truy vấn chạy ở trình duyệt; quyền truy cập do RLS và RPC trong Postgres quyết định.
export const supabase = createClient(url, key)

/** Ném lỗi Supabase thành Error để TanStack Query hiển thị được thông báo (thông báo RPC đã là tiếng Việt). */
export function unwrap<T>(res: { data: T; error: null } | { data: unknown; error: { message: string } }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data as T
}

export type Me = { userId: string; email: string | undefined; anonymous: boolean; profile: Profile }

export const meKey = ['me'] as const

export async function fetchMe(): Promise<Me | null> {
  const { data } = await supabase.auth.getSession()
  const user = data.session?.user
  if (!user) return null
  const profile = unwrap(await supabase.from('profiles').select('id, full_name, role').eq('id', user.id).single())
  return { userId: user.id, email: user.email, anonymous: !!user.is_anonymous, profile: profile as Profile }
}

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: Infinity })
}
