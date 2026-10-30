import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { supabase, useMe } from '../lib/supabase'

type NavItem = { to: string; label: string; exact?: boolean }

/** Số câu hỏi học sinh chưa trả lời, hiện cạnh mục menu của giáo viên. Khóa 'gv' để được làm mới cùng khu vực. */
export const unansweredQuery = {
  queryKey: ['gv', 'inquiries-unanswered'],
  queryFn: async () => {
    const res = await supabase.from('inquiries').select('id', { count: 'exact', head: true }).is('reply', null)
    if (res.error) throw new Error(res.error.message)
    return res.count ?? 0
  },
}

/** Thanh trên cùng giống prototype: logo, menu theo vai trò, tài khoản. */
export function TopBar({ nav = [], label, children }: { nav?: NavItem[]; label?: string; children?: ReactNode }) {
  const me = useMe().data
  const navigate = useNavigate()
  const isTeacher = me?.profile.role === 'teacher' && !me.anonymous
  const open = useQuery({ ...unansweredQuery, enabled: isTeacher })
  const home = isTeacher ? '/gv' : me && !me.anonymous ? '/hs' : '/'

  return (
    <header className="torn topbar">
      <Link to={home} className="brand">
        <img src="/logo.svg" width={40} height={40} alt="Điểm Mười" className="brand__mark" />
      </Link>
      {nav.length > 0 && (
        <nav aria-label={label} className="nav">
          {nav.map((n) => (
            <Link key={n.to} to={n.to} className="nav-link" activeOptions={{ exact: n.exact }} activeProps={{ 'aria-current': 'page' }}>
              {n.label}
              {n.to === '/gv/hoi-dap' && !!open.data && ` (${open.data})`}
            </Link>
          ))}
        </nav>
      )}
      {children}
      <nav aria-label="Tài khoản" className="roles">
        {me && !me.anonymous ? (
          <>
            <span>{me.profile.full_name || me.email}</span>
            <button
              type="button"
              className="role-link"
              style={{ background: 'none', border: 0, cursor: 'pointer' }}
              onClick={async () => {
                await supabase.auth.signOut()
                navigate({ to: '/' })
              }}
            >
              Đăng xuất
            </button>
          </>
        ) : (
          <>
            <Link to="/kho-de" className="role-link">Kho đề</Link>
            <Link to="/dang-nhap" className="role-link">Đăng nhập</Link>
          </>
        )}
      </nav>
    </header>
  )
}

export const TEACHER_NAV: NavItem[] = [
  { to: '/gv', label: 'Quản lý', exact: true },
  { to: '/gv/hoi-dap', label: 'Câu hỏi học sinh' },
  { to: '/xep-hang', label: 'Bảng xếp hạng' },
]
export const STUDENT_NAV: NavItem[] = [
  { to: '/hs', label: 'Của em', exact: true },
  { to: '/kho-de', label: 'Kho đề' },
  { to: '/xep-hang', label: 'Bảng xếp hạng' },
]
