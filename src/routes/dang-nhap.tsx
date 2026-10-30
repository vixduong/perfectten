import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { TopBar } from '../components/TopBar'
import { fetchMe, meKey, supabase, unwrap } from '../lib/supabase'
import type { Role } from '../lib/types'

export const Route = createFileRoute('/dang-nhap')({
  validateSearch: (s: Record<string, unknown>): { next?: string } => ({
    // Chỉ cho chuyển tiếp trong cùng trang web.
    next: typeof s.next === 'string' && s.next.startsWith('/') && !s.next.startsWith('//') ? s.next : undefined,
  }),
  head: () => ({ meta: [{ title: 'Đăng nhập · Điểm Mười' }] }),
  component: Login,
})

function Login() {
  const { next } = Route.useSearch()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [role, setRole] = useState<Role>('student')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [pass, setPass] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setInfo('')
    if (mode === 'up' && !name.trim()) return setError('Vui lòng nhập họ tên.')
    if (!email.trim() || pass.length < 6) return setError('Vui lòng nhập email và mật khẩu từ 6 ký tự.')
    setBusy(true)
    try {
      if (mode === 'up') {
        const data = unwrap(
          await supabase.auth.signUp({
            email: email.trim(),
            password: pass,
            options: { data: { full_name: name.trim(), role } },
          }),
        )
        if (!data.session) {
          setInfo('Đã tạo tài khoản. Hãy mở email để xác nhận rồi đăng nhập.')
          setMode('in')
          return
        }
      } else {
        unwrap(await supabase.auth.signInWithPassword({ email: email.trim(), password: pass }))
      }
      const me = await qc.fetchQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: 0 })
      navigate({ to: next ?? (me?.profile.role === 'teacher' ? '/gv' : '/hs') })
    } catch (err) {
      setError(err instanceof Error ? translate(err.message) : 'Có lỗi, vui lòng thử lại.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <TopBar />
      <main className="page page--narrow">
        <section aria-labelledby="dn" className="card stack" style={{ maxWidth: 480, marginInline: 'auto' }}>
          <h1 id="dn">{mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}</h1>
          <div role="group" aria-label="Chọn" className="row">
            <button type="button" className="pill" aria-pressed={mode === 'in'} onClick={() => setMode('in')}>Đăng nhập</button>
            <button type="button" className="pill" aria-pressed={mode === 'up'} onClick={() => setMode('up')}>Tạo tài khoản</button>
          </div>
          <form onSubmit={submit} noValidate className="stack">
            {mode === 'up' && (
              <>
                <fieldset className="bare stack-sm">
                  <legend className="note">Tôi là</legend>
                  <div className="row">
                    <label className="check"><input type="radio" name="role" checked={role === 'student'} onChange={() => setRole('student')} /> <span>Học sinh</span></label>
                    <label className="check"><input type="radio" name="role" checked={role === 'teacher'} onChange={() => setRole('teacher')} /> <span>Giáo viên</span></label>
                  </div>
                </fieldset>
                <div className="field">
                  <label htmlFor="hoten">Họ tên</label>
                  <input id="hoten" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
                </div>
              </>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            </div>
            <div className="field">
              <label htmlFor="matkhau">Mật khẩu</label>
              <input id="matkhau" type="password" className="input" value={pass} onChange={(e) => setPass(e.target.value)} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} />
            </div>
            {error && <p role="alert" className="error">{error}</p>}
            {info && <p role="status" className="well well--mint">{info}</p>}
            <button type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
              {busy ? 'Đang xử lý…' : mode === 'in' ? 'Đăng nhập' : 'Tạo tài khoản'}
            </button>
          </form>
        </section>
      </main>
    </>
  )
}

function translate(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Email hoặc mật khẩu chưa đúng.'
  if (/already registered/i.test(msg)) return 'Email này đã có tài khoản. Hãy đăng nhập.'
  if (/email not confirmed/i.test(msg)) return 'Email chưa được xác nhận. Hãy mở hộp thư để xác nhận.'
  return msg
}
