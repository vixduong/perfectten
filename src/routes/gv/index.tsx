import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { num, stamp } from '../../lib/format'
import { supabase, unwrap, useMe } from '../../lib/supabase'
import type { Attempt, Exam, Klass, RosterRow } from '../../lib/types'
import { attemptsQuery, classesQuery, examsQuery, friendly, rosterQuery } from '../gv'

const TABS = [
  ['overview', 'Tổng quan'],
  ['classes', 'Lớp học'],
  ['students', 'Học sinh'],
  ['exams', 'Đề thi'],
  ['stats', 'Thống kê'],
] as const
type Tab = (typeof TABS)[number][0]

export const Route = createFileRoute('/gv/')({
  validateSearch: (s: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.find(([t]) => t === s.tab)?.[0],
  }),
  head: () => ({ meta: [{ title: 'Quản lý · Điểm Mười' }] }),
  component: Dashboard,
})

type Data = { classes: Klass[]; roster: RosterRow[]; exams: Exam[]; attempts: Attempt[] }

const ACCESS_LABEL = { private: 'Riêng tư', link: 'Có link', public: 'Công khai' }
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Bỏ dấu để tìm "nguyen" ra "Nguyễn". */
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd')

const rosterSize = (d: Data, classId: string | null) => d.roster.filter((r) => r.class_id === classId).length
/** Số em trong danh sách lớp của đề đã nộp (bỏ khách và bài thử của giáo viên, không đếm trùng lượt làm). */
function submittedCount(d: Data, examId: string) {
  const classId = d.exams.find((e) => e.id === examId)?.class_id
  const members = new Set(d.roster.filter((r) => r.class_id === classId && r.user_id).map((r) => r.user_id))
  return new Set(d.attempts.filter((a) => a.exam_id === examId && a.submitted_at && members.has(a.user_id)).map((a) => a.user_id)).size
}

function latestExam(d: Data, classId: string): Exam | undefined {
  return d.exams.filter((e) => e.class_id === classId && e.status !== 'draft').sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
}

/** Điểm của bài nộp gần nhất trong các đề của lớp; null nếu chưa nộp (hoặc chưa gắn tài khoản). */
function lastScore(d: Data, r: RosterRow): number | null {
  if (!r.user_id) return null
  const ids = new Set(d.exams.filter((e) => e.class_id === r.class_id).map((e) => e.id))
  const a = d.attempts
    .filter((x) => x.submitted_at && x.user_id === r.user_id && ids.has(x.exam_id))
    .sort((x, y) => (y.submitted_at as string).localeCompare(x.submitted_at as string))[0]
  return a ? Number(a.score) : null
}

/** Chưa nộp đề mới nhất (không phải nháp) của lớp. Lớp chưa có đề thì không tính. */
function notSubmitted(d: Data, r: RosterRow): boolean {
  const e = latestExam(d, r.class_id)
  if (!e) return false
  return !(r.user_id && d.attempts.some((a) => a.exam_id === e.id && a.user_id === r.user_id && a.submitted_at))
}

function Dashboard() {
  const me = useMe().data
  const { tab = 'overview' } = Route.useSearch()
  const navigate = Route.useNavigate()
  const classes = useQuery(classesQuery)
  const roster = useQuery(rosterQuery)
  const exams = useQuery(examsQuery)
  const attempts = useQuery(attemptsQuery)
  const [classId, setClassId] = useState('')
  const [pending, setPending] = useState(false)

  const error = classes.error ?? roster.error ?? exams.error ?? attempts.error
  const d: Data | null =
    classes.data && roster.data && exams.data && attempts.data
      ? { classes: classes.data, roster: roster.data, exams: exams.data, attempts: attempts.data }
      : null

  function showStudents(id: string, onlyPending: boolean) {
    setClassId(id)
    setPending(onlyPending)
    navigate({ search: { tab: 'students' } })
  }

  return (
    <main className="page">
      <div className="page-head">
        <div className="stack-sm grow">
          <h1>Chào {me?.profile.full_name}</h1>
          <p className="sub">Lớp học, đề thi và kết quả của em ở một chỗ.</p>
        </div>
      </div>
      <div className="tabs" role="group" aria-label="Mục quản lý">
        {TABS.map(([t, label]) => (
          <button key={t} type="button" className="pill" aria-pressed={tab === t} onClick={() => navigate({ search: { tab: t } })}>
            {label}
          </button>
        ))}
      </div>
      {error && <p role="alert" className="error">{error.message}</p>}
      {!d ? (
        !error && <p className="note" role="status">Đang tải…</p>
      ) : tab === 'overview' ? (
        <Overview d={d} showStudents={showStudents} />
      ) : tab === 'classes' ? (
        <ClassesTab d={d} showStudents={showStudents} />
      ) : tab === 'students' ? (
        <StudentsTab d={d} classId={classId} setClassId={setClassId} pending={pending} setPending={setPending} />
      ) : tab === 'exams' ? (
        <ExamsTab d={d} />
      ) : (
        <StatsTab d={d} />
      )}
    </main>
  )
}

function Overview({ d, showStudents }: { d: Data; showStudents: (id: string, onlyPending: boolean) => void }) {
  const open = d.exams.filter((e) => e.status === 'open')
  const due = open.filter((e) => e.closes_at).sort((a, b) => (a.closes_at as string).localeCompare(b.closes_at as string))
  const todo = d.roster.filter((r) => notSubmitted(d, r)).length
  const figures = [
    ['Lớp đang dạy', d.classes.length],
    ['Học sinh', d.roster.length],
    ['Đề đang mở', open.length],
    ['Bài đã nộp', d.attempts.filter((a) => a.submitted_at).length],
  ]
  return (
    <div className="stack-lg">
      <div className="pearfield">
        <dl className="figures">
          {figures.map(([l, v]) => (
            <div key={l}>
              <dt className="figure-l">{l}</dt>
              <dd className="figure-v">{v}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="split">
        <section className="main stack" aria-labelledby="sdh">
          <h2 id="sdh">Sắp đến hạn</h2>
          {due.length === 0 ? (
            <div className="well"><p>Chưa có đề nào đang mở kèm hạn nộp.</p></div>
          ) : (
            <ul className="stack">
              {due.map((e) => {
                const size = rosterSize(d, e.class_id)
                const n = submittedCount(d, e.id)
                return (
                  <li key={e.id} className="card stack-sm">
                    <div className="row between">
                      <Link to="/gv/de/$examId" params={{ examId: e.id }}><strong>{e.title}</strong></Link>
                      <span className="note">Hạn {stamp(e.closes_at)}</span>
                    </div>
                    <span className="meter" role="img" aria-label={`Đã nộp ${n}${size ? ` trên ${size}` : ''}`}>
                      <span style={{ width: `${size ? Math.min(100, (n / size) * 100) : 0}%` }} />
                    </span>
                    <span className="note">Đã nộp {n}{size ? `/${size}` : ''}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <aside className="aside card stack" aria-labelledby="vcl">
          <h2 id="vcl">Việc cần làm</h2>
          {todo === 0 ? (
            <p className="note">Chưa có em nào cần nhắc nộp bài.</p>
          ) : (
            <button type="button" className="btn" onClick={() => showStudents('', true)}>
              {todo} em chưa nộp bài
            </button>
          )}
        </aside>
      </div>
    </div>
  )
}

function ClassesTab({ d, showStudents }: { d: Data; showStudents: (id: string, onlyPending: boolean) => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [subject, setSubject] = useState('')
  const [year, setYear] = useState('2026–2027')
  const [err, setErr] = useState('')

  const create = useMutation({
    mutationFn: async () =>
      unwrap(await supabase.from('classes').insert({ name: name.trim(), subject: subject.trim(), school_year: year.trim() })),
    onSuccess: () => {
      setName('')
      setSubject('')
      qc.invalidateQueries({ queryKey: ['gv'] })
    },
    onError: (e) => setErr(/classes_teacher_id_name_key|duplicate/i.test(e.message) ? `Lớp ${name.trim()} đã có rồi.` : friendly(e.message)),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('classes').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gv'] }),
    onError: (e) =>
      setErr(/exams_private_class_check/.test(e.message) ? 'Lớp còn đề riêng tư đã xuất bản nên chưa xóa được. Hãy xóa các đề đó trước.' : friendly(e.message)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setErr('')
    if (!name.trim()) return setErr('Vui lòng nhập tên lớp.')
    create.mutate()
  }

  return (
    <div className="split">
      <section className="main stack" aria-labelledby="dsl">
        <h2 id="dsl">Lớp học</h2>
        {d.classes.length === 0 ? (
          <div className="well"><p>Chưa có lớp nào. Hãy tạo lớp đầu tiên ở bên phải.</p></div>
        ) : (
          <ul className="grid-cards">
            {d.classes.map((c) => (
              <li key={c.id} className="card stack-sm">
                <h3 style={{ fontSize: 'var(--text-lg)' }}>{c.name}</h3>
                <p className="sub">{[c.subject, c.school_year && `Năm học ${c.school_year}`].filter(Boolean).join(' · ')}</p>
                <ul className="meta">
                  <li>{rosterSize(d, c.id)} học sinh</li>
                  <li>Mã lớp <span className="code">{c.code}</span></li>
                </ul>
                <div className="row">
                  <button type="button" className="btn" onClick={() => showStudents(c.id, false)}>Xem học sinh</button>
                  <button
                    type="button"
                    className="btn btn--link"
                    onClick={() => {
                      setErr('')
                      if (window.confirm(`Xóa lớp ${c.name}? Danh sách học sinh của lớp cũng sẽ bị xóa.`)) remove.mutate(c.id)
                    }}
                  >
                    Xóa lớp
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <aside className="aside card stack" aria-labelledby="tl">
        <h2 id="tl">Tạo lớp</h2>
        <form onSubmit={submit} noValidate className="stack">
          <div className="field">
            <label htmlFor="lop-ten">Tên lớp</label>
            <input id="lop-ten" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="8A2" />
          </div>
          <div className="field">
            <label htmlFor="lop-mon">Môn</label>
            <input id="lop-mon" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Toán" />
          </div>
          <div className="field">
            <label htmlFor="lop-nam">Năm học</label>
            <input id="lop-nam" className="input" value={year} onChange={(e) => setYear(e.target.value)} />
          </div>
          {err && <p role="alert" className="error">{err}</p>}
          <button type="submit" className="btn btn--primary" disabled={create.isPending}>Tạo lớp</button>
        </form>
      </aside>
    </div>
  )
}

function StudentsTab({
  d, classId, setClassId, pending, setPending,
}: { d: Data; classId: string; setClassId: (v: string) => void; pending: boolean; setPending: (v: boolean) => void }) {
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [target, setTarget] = useState('')
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [paste, setPaste] = useState('')
  const [err, setErr] = useState('')
  const [pasteErr, setPasteErr] = useState('')

  const className = (id: string) => d.classes.find((c) => c.id === id)?.name ?? ''
  const rows = d.roster.filter(
    (r) =>
      (!classId || r.class_id === classId) &&
      (!pending || notSubmitted(d, r)) &&
      (!q.trim() || fold(`${r.full_name} ${r.email ?? ''}`).includes(fold(q.trim()))),
  )
  const to = target || classId || d.classes[0]?.id || ''
  const toClass = d.classes.find((c) => c.id === to)

  const insert = useMutation({
    mutationFn: async (list: { full_name: string; email: string | null }[]) =>
      unwrap(await supabase.from('class_students').insert(list.map((r) => ({ ...r, class_id: to })))),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gv'] }),
  })
  const remove = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('class_students').delete().eq('id', id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gv'] }),
  })

  function addOne(e: FormEvent) {
    e.preventDefault()
    setErr('')
    const mail = email.trim().toLowerCase()
    if (!to) return setErr('Hãy tạo lớp trước.')
    if (!fullName.trim()) return setErr('Vui lòng nhập họ tên.')
    if (!mail) return setErr('Vui lòng nhập email.')
    if (!EMAIL.test(mail)) return setErr('Email chưa đúng định dạng.')
    insert.mutate([{ full_name: fullName.trim(), email: mail }], {
      onSuccess: () => {
        setFullName('')
        setEmail('')
      },
      onError: (x) => setErr(friendly(x.message)),
    })
  }

  function addMany(e: FormEvent) {
    e.preventDefault()
    setPasteErr('')
    if (!to) return setPasteErr('Hãy tạo lớp trước.')
    const list: { full_name: string; email: string | null }[] = []
    const lines = paste.split('\n').map((l) => l.trim()).filter(Boolean)
    for (const [i, line] of lines.entries()) {
      const [n, m = ''] = line.split(',').map((s) => s.trim())
      const mail = m.toLowerCase()
      if (!n) return setPasteErr(`Dòng ${i + 1}: thiếu họ tên.`)
      if (mail && !EMAIL.test(mail)) return setPasteErr(`Dòng ${i + 1}: email chưa đúng định dạng.`)
      list.push({ full_name: n, email: mail || null })
    }
    if (!list.length) return setPasteErr('Vui lòng dán danh sách học sinh.')
    insert.mutate(list, { onSuccess: () => setPaste(''), onError: (x) => setPasteErr(friendly(x.message)) })
  }

  return (
    <div className="split">
      <section className="main stack" aria-labelledby="dshs">
        <h2 id="dshs">Học sinh</h2>
        <div className="row">
          <div className="field">
            <label htmlFor="hs-lop">Lớp</label>
            <select id="hs-lop" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Tất cả lớp</option>
              {d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="field grow">
            <label htmlFor="hs-tim">Tìm theo tên hoặc email</label>
            <input id="hs-tim" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="pill" aria-pressed={pending} onClick={() => setPending(!pending)}>Chưa nộp bài</button>
        </div>
        {remove.error && <p role="alert" className="error">{remove.error.message}</p>}
        {rows.length === 0 ? (
          <div className="well"><p>Không có học sinh nào khớp.</p></div>
        ) : (
          <div className="scroll-x">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Họ tên</th>
                  <th scope="col">Email</th>
                  <th scope="col">Lớp</th>
                  <th scope="col">Điểm đề gần nhất</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = lastScore(d, r)
                  return (
                    <tr key={r.id}>
                      <th scope="row">{r.full_name}</th>
                      <td>{r.email ?? '—'}</td>
                      <td>{className(r.class_id)}</td>
                      <td className="num">{s === null ? <span className="tag tag--pear">Chưa nộp bài</span> : num(s)}</td>
                      <td>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={`Xóa ${r.full_name} khỏi lớp`}
                          onClick={() => window.confirm(`Xóa ${r.full_name} khỏi lớp ${className(r.class_id)}?`) && remove.mutate(r.id)}
                        >
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <aside className="aside card stack" aria-label="Thêm học sinh">
        {d.classes.length === 0 ? (
          <p className="note">Hãy tạo lớp trước khi thêm học sinh.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="them-lop">Thêm vào lớp</label>
              <select id="them-lop" className="input" value={to} onChange={(e) => setTarget(e.target.value)}>
                {d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {toClass && (
              <p className="note">
                Mã lớp <span className="code">{toClass.code}</span>. Học sinh có thể tự vào lớp bằng mã này.
              </p>
            )}
            <form onSubmit={addOne} noValidate className="stack">
              <h2 style={{ fontSize: 'var(--text-lg)' }}>Thêm một học sinh</h2>
              <div className="field">
                <label htmlFor="them-ten">Họ tên</label>
                <input id="them-ten" className="input" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="them-email">Email</label>
                <input id="them-email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              {err && <p role="alert" className="error">{err}</p>}
              <button type="submit" className="btn btn--primary" disabled={insert.isPending}>Thêm học sinh</button>
            </form>
            <form onSubmit={addMany} noValidate className="stack">
              <h2 style={{ fontSize: 'var(--text-lg)' }}>Dán danh sách</h2>
              <div className="field">
                <label htmlFor="dan-ds">Mỗi dòng một em: “Họ tên” hoặc “Họ tên, email”</label>
                <textarea id="dan-ds" className="input" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} />
              </div>
              {pasteErr && <p role="alert" className="error">{pasteErr}</p>}
              <button type="submit" className="btn" disabled={insert.isPending}>Thêm danh sách</button>
            </form>
          </>
        )}
      </aside>
    </div>
  )
}

function ExamsTab({ d }: { d: Data }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | Exam['status']>('all')
  const FILTERS = [['all', 'Tất cả'], ['open', 'Đang mở'], ['closed', 'Đã đóng'], ['draft', 'Nháp']] as const

  const create = useMutation({
    mutationFn: async () => unwrap(await supabase.from('exams').insert({ title: 'Đề mới' }).select('id').single()) as { id: string },
    onSuccess: (row) => {
      qc.invalidateQueries({ queryKey: ['gv'] })
      navigate({ to: '/gv/de/$examId', params: { examId: row.id } })
    },
  })
  const toggle = useMutation({
    mutationFn: async (e: Exam) =>
      unwrap(await supabase.from('exams').update({ status: e.status === 'open' ? 'closed' : 'open' }).eq('id', e.id)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gv'] }),
  })

  const rows = d.exams.filter((e) => filter === 'all' || e.status === filter)
  const className = (id: string | null) => d.classes.find((c) => c.id === id)?.name ?? '—'

  return (
    <section className="stack" aria-labelledby="dsd">
      <div className="row between">
        <h2 id="dsd">Đề thi</h2>
        <button type="button" className="btn btn--primary" disabled={create.isPending} onClick={() => create.mutate()}>Tạo đề mới</button>
      </div>
      <div className="tabs" role="group" aria-label="Lọc đề">
        {FILTERS.map(([v, label]) => (
          <button key={v} type="button" className="pill" aria-pressed={filter === v} onClick={() => setFilter(v)}>{label}</button>
        ))}
      </div>
      {(create.error ?? toggle.error) && <p role="alert" className="error">{friendly((create.error ?? toggle.error)!.message)}</p>}
      {rows.length === 0 ? (
        <div className="well"><p>Chưa có đề nào ở mục này.</p></div>
      ) : (
        <div className="scroll-x">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Đề</th>
                <th scope="col">Lớp</th>
                <th scope="col">Trạng thái</th>
                <th scope="col">Thời gian</th>
                <th scope="col">Mở / hạn</th>
                <th scope="col">Đã nộp</th>
                <th scope="col">Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const size = rosterSize(d, e.class_id)
                return (
                  <tr key={e.id}>
                    <th scope="row">
                      {e.title}
                      <br />
                      <span className="note">{ACCESS_LABEL[e.access]}</span>
                    </th>
                    <td>{className(e.class_id)}</td>
                    <td>
                      <span className={`tag ${e.status === 'open' ? 'tag--mint' : e.status === 'draft' ? 'tag--pear' : ''}`}>
                        {e.status === 'open' ? 'Đang mở' : e.status === 'closed' ? 'Đã đóng' : 'Nháp'}
                      </span>
                    </td>
                    <td className="num">{e.duration_min} phút</td>
                    <td>{e.opens_at ? stamp(e.opens_at) : '—'} / {e.closes_at ? stamp(e.closes_at) : '—'}</td>
                    <td className="num">{submittedCount(d, e.id)}{e.class_id ? `/${size}` : ''}</td>
                    <td>
                      <div className="row">
                        <Link to="/gv/de/$examId" params={{ examId: e.id }} className="btn">Soạn</Link>
                        <Link to="/gv/ket-qua/$examId" params={{ examId: e.id }} className="btn">Kết quả</Link>
                        {e.status !== 'draft' && (
                          <button type="button" className="btn btn--link" disabled={toggle.isPending} onClick={() => toggle.mutate(e)}>
                            {e.status === 'open' ? 'Đóng đề' : 'Mở lại'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function StatsTab({ d }: { d: Data }) {
  const [classId, setClassId] = useState('')
  const exams = d.exams.filter((e) => e.status !== 'draft' && (!classId || e.class_id === classId))
  const ids = new Set(exams.map((e) => e.id))
  const done = d.attempts.filter((a) => a.submitted_at && ids.has(a.exam_id))
  const avg = (list: Attempt[]) => list.reduce((s, a) => s + Number(a.score), 0) / list.length

  const slots = exams.filter((e) => e.class_id).reduce((s, e) => s + rosterSize(d, e.class_id), 0)
  const turnedIn = exams.filter((e) => e.class_id).reduce((s, e) => s + submittedCount(d, e.id), 0)
  const figures = [
    ['Điểm trung bình', done.length ? num(avg(done), 1) : '—', ''],
    ['Tỉ lệ nộp bài', slots ? Math.round((turnedIn / slots) * 100) : '—', slots ? '%' : ''],
    ['Số đề đã giao', exams.length, ''],
  ]
  const bars = exams
    .map((e) => ({ e, list: done.filter((a) => a.exam_id === e.id) }))
    .filter((x) => x.list.length)
    .map((x) => ({ e: x.e, avg: avg(x.list) }))

  const worry = d.roster
    .filter((r) => !classId || r.class_id === classId)
    .map((r) => ({ r, s: lastScore(d, r) }))
    .filter((x) => (x.s === null ? notSubmitted(d, x.r) : x.s < 5))

  return (
    <div className="stack-lg">
      <div className="field" style={{ maxWidth: 280 }}>
        <label htmlFor="tk-lop">Lớp</label>
        <select id="tk-lop" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Tất cả lớp</option>
          {d.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <div className="pearfield">
        <dl className="figures">
          {figures.map(([l, v, u]) => (
            <div key={l}>
              <dt className="figure-l">{l}</dt>
              <dd className="figure-v">{v}{u && <span className="figure-u">{u}</span>}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="split">
        <section className="main stack" aria-labelledby="dtb">
          <h2 id="dtb">Điểm trung bình từng đề</h2>
          {bars.length === 0 ? (
            <div className="well"><p>Chưa có bài nộp nào để thống kê.</p></div>
          ) : (
            <div className="stack-sm">
              {bars.map(({ e, avg: v }) => (
                <div key={e.id} className="bar-row">
                  <span title={e.title} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.title}</span>
                  <span className="meter" role="img" aria-label={`${e.title}: ${num(v, 1)} điểm`}><span style={{ width: `${v * 10}%` }} /></span>
                  <span>{num(v, 1)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
        <aside className="aside card stack" aria-labelledby="qt">
          <h2 id="qt">Em cần cô quan tâm</h2>
          {worry.length === 0 ? (
            <p className="note">Chưa có em nào cần chú ý.</p>
          ) : (
            <ul className="stack-sm">
              {worry.map(({ r, s }) => (
                <li key={r.id} className="row between">
                  <span>{r.full_name}</span>
                  <span className={`tag ${s === null ? 'tag--pear' : 'tag--coral'}`}>{s === null ? 'Chưa nộp bài' : `Gần nhất ${num(s, 1)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  )
}
