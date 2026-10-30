import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState, type CSSProperties, type FormEvent } from 'react'
import { TopBar, STUDENT_NAV } from '../components/TopBar'
import { cleanName, num, profileFigures, stamp, submittedOldestFirst } from '../lib/format'
import { meKey, supabase, unwrap, useMe } from '../lib/supabase'
import type { Attempt, Exam, Klass } from '../lib/types'

export const Route = createFileRoute('/hs')({
  head: () => ({ meta: [{ title: 'Của em · Điểm Mười' }] }),
  component: StudentHome,
})

function StudentHome() {
  const me = useMe()
  const user = me.data && !me.data.anonymous ? me.data : null
  return (
    <>
      <TopBar nav={STUDENT_NAV} label="Học sinh" />
      <main className="page stack-lg">
        {me.isPending ? (
          <p className="note">Đang tải…</p>
        ) : user ? (
          <Content userId={user.userId} name={user.profile.full_name} />
        ) : (
          <div className="card stack-sm">
            <h1>Đăng nhập để xem lớp và bài làm của em</h1>
            <p className="sub">Em có thể làm đề công khai mà không cần đăng nhập.</p>
            <div className="row">
              <Link to="/dang-nhap" search={{ next: '/hs' }} className="btn btn--primary">Đăng nhập</Link>
              <Link to="/kho-de" className="btn">Vào kho đề</Link>
            </div>
          </div>
        )}
      </main>
    </>
  )
}

function Content({ userId, name }: { userId: string; name: string }) {
  const qc = useQueryClient()
  const [code, setCode] = useState('')
  const [joined, setJoined] = useState('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [nameError, setNameError] = useState('')
  const [subject, setSubject] = useState('')

  const classes = useQuery({
    queryKey: ['hs', userId, 'classes'],
    queryFn: async () => unwrap(await supabase.from('classes').select('*').order('name')) as Klass[],
  })
  // RLS cũng trả đề công khai đang mở, nên lọc theo lớp của em ở dưới.
  const exams = useQuery({
    queryKey: ['hs', userId, 'exams'],
    queryFn: async () => unwrap(await supabase.from('exams').select('*')) as Exam[],
  })
  const attempts = useQuery({
    queryKey: ['hs', userId, 'attempts'],
    queryFn: async () =>
      unwrap(await supabase.from('attempts').select('*').eq('user_id', userId).order('started_at', { ascending: false })) as Attempt[],
  })

  const join = useMutation({
    mutationFn: async (c: string) => unwrap(await supabase.rpc('join_class', { p_code: c })),
    onSuccess: () => {
      setJoined('Em đã vào lớp.')
      setCode('')
      qc.invalidateQueries({ queryKey: ['hs', userId] })
    },
  })
  const rename = useMutation({
    mutationFn: async (full_name: string) => unwrap(await supabase.from('profiles').update({ full_name }).eq('id', userId)),
    onSuccess: () => {
      setEditing(false)
      qc.invalidateQueries({ queryKey: meKey })
    },
  })
  function saveName(e: FormEvent) {
    e.preventDefault()
    const clean = cleanName(draft)
    if (!clean) return setNameError('Em hãy nhập họ và tên.')
    setNameError('')
    rename.mutate(clean)
  }
  function submit(e: FormEvent) {
    e.preventDefault()
    setJoined('')
    if (code.trim()) join.mutate(code)
  }

  const classList = classes.data ?? []
  const className = new Map(classList.map((c) => [c.id, c.name]))
  const titles = new Map((exams.data ?? []).map((e) => [e.id, e.title]))
  const subjectOf = new Map((exams.data ?? []).map((e) => [e.id, e.subject]))
  const subjectName = (a: Attempt) => subjectOf.get(a.exam_id) ?? 'Khác'
  const allAttempts = attempts.data ?? []
  const subjects = [...new Set(allAttempts.map(subjectName))].sort((a, b) => a.localeCompare(b, 'vi'))
  const shown = subject ? allAttempts.filter((a) => subjectName(a) === subject) : allAttempts
  const garden = submittedOldestFirst(allAttempts)
  const stats = profileFigures(allAttempts)
  const figures = [['Bài đã làm', stats.taken], ['Điểm gần nhất', stats.latest], ['Tiến bộ', stats.progress]]
  const classExams = (exams.data ?? []).filter((e) => e.status === 'open' && e.class_id && className.has(e.class_id))
  const error = classes.error ?? exams.error ?? attempts.error

  return (
    <>
      <div className="page-head">
        <div className="stack-sm grow">
          <h1>Chào {name}</h1>
          <p className="sub">Lớp, đề được giao và các bài em đã làm.</p>
        </div>
        {!editing && (
          <button type="button" className="btn" onClick={() => { setDraft(name); setNameError(''); rename.reset(); setEditing(true) }}>
            Sửa hồ sơ
          </button>
        )}
      </div>
      {error && <p role="alert" className="error">{error.message}</p>}

      {editing && (
        <form className="card stack-sm" onSubmit={saveName} noValidate>
          <div className="field">
            <label htmlFor="ho-ten">Họ và tên</label>
            <input id="ho-ten" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} autoComplete="name" />
          </div>
          {(nameError || rename.error) && <p role="alert" className="error">{nameError || rename.error?.message}</p>}
          <div className="row">
            <button type="submit" className="btn btn--primary" disabled={rename.isPending}>Lưu</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>Huỷ</button>
          </div>
        </form>
      )}

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

      <section className="stack" aria-labelledby="vuon-diem">
        <h2 id="vuon-diem">Vườn điểm</h2>
        {garden.length === 0 ? (
          <div className="well"><p>Vườn còn trống. Nộp bài đầu tiên để gieo cây đầu tiên.</p></div>
        ) : (
          <div
            className="garden"
            role="img"
            aria-label={`Vườn điểm: ${garden.map((a) => `${subjectName(a)} ${num(a.score)} điểm`).join('; ')}`}
          >
            {garden.map((a, i) => (
              <div key={a.id} className="plant" data-tone={i % 4} style={{ '--i': i } as CSSProperties} aria-hidden="true">
                <span className="plant__top">{num(a.score)}</span>
                <span className="plant__stem" style={{ height: `${(a.score / 10) * 120}px` }} />
                <span className="plant__name">{subjectName(a)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card stack-sm" aria-labelledby="vao-lop">
        <h2 id="vao-lop">Vào lớp bằng mã</h2>
        <form className="row" onSubmit={submit}>
          <div className="field grow">
            <label htmlFor="ma-lop">Mã lớp</label>
            <input id="ma-lop" className="input" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
          </div>
          <button type="submit" className="btn btn--primary" disabled={join.isPending}>Vào lớp</button>
        </form>
        {join.error && <p role="alert" className="error">{join.error.message}</p>}
        {joined && <p role="status" className="note">{joined}</p>}
      </section>

      <section className="stack" aria-labelledby="lop-cua-em">
        <h2 id="lop-cua-em">Lớp của em</h2>
        {classList.length === 0 ? (
          <div className="well"><p>Em chưa vào lớp nào. Nhập mã lớp của cô/thầy ở trên.</p></div>
        ) : (
          <ul className="grid-cards">
            {classList.map((c) => (
              <li key={c.id} className="card stack-sm">
                <h3 style={{ fontSize: 'var(--text-lg)' }}>{c.name}</h3>
                <p className="sub">{[c.subject, c.school_year].filter(Boolean).join(' · ')}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" aria-labelledby="de-lop">
        <h2 id="de-lop">Đề của lớp</h2>
        {classExams.length === 0 ? (
          <div className="well"><p>Hiện chưa có đề nào đang mở.</p></div>
        ) : (
          <ul className="grid-cards">
            {classExams.map((e) => (
              <li key={e.id} className="card stack-sm">
                <h3 style={{ fontSize: 'var(--text-lg)' }}>{e.title}</h3>
                <p className="sub grow">{className.get(e.class_id!)}</p>
                <p className="note">{e.closes_at ? `Đóng lúc ${stamp(e.closes_at)}` : 'Không giới hạn thời gian'}</p>
                <Link to="/de/$examId" params={{ examId: e.id }} className="btn">Vào phòng thi</Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="stack" aria-labelledby="bai-da-lam">
        <h2 id="bai-da-lam">Bài đã làm</h2>
        {allAttempts.length > 0 && (
          <div className="row" role="group" aria-label="Lọc theo môn">
            {['', ...subjects].map((s) => (
              <button key={s} type="button" className="pill" aria-pressed={subject === s} onClick={() => setSubject(s)}>
                {s || 'Tất cả'}
              </button>
            ))}
          </div>
        )}
        {allAttempts.length === 0 ? (
          <div className="well"><p>Em chưa làm bài nào.</p></div>
        ) : shown.length === 0 ? (
          <div className="well"><p>Chưa có bài nào môn {subject}.</p></div>
        ) : (
          <ul className="grid-cards">
            {shown.map((a) => (
              <li key={a.id} className="card stack-sm">
                <h3 style={{ fontSize: 'var(--text-lg)' }}>{titles.get(a.exam_id) ?? 'Đề thi'}</h3>
                <p className="note">{stamp(a.started_at)}</p>
                {a.submitted_at ? (
                  <>
                    <p><strong>Điểm {num(a.score ?? 0)}</strong> <span className="note">({a.correct_count} trên {a.total} câu đúng)</span></p>
                    <Link to="/ket-qua/$attemptId" params={{ attemptId: a.id }} className="btn">Xem kết quả</Link>
                  </>
                ) : (
                  <Link to="/lam-bai/$attemptId" params={{ attemptId: a.id }} className="btn btn--primary">Làm tiếp</Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}
