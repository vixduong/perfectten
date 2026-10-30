import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { duration, num, stamp } from '../../lib/format'
import { supabase, unwrap } from '../../lib/supabase'
import type { Attempt, Exam, Question } from '../../lib/types'
import { classesQuery, rosterQuery } from '../gv'

export const Route = createFileRoute('/gv/ket-qua/$examId')({
  head: () => ({ meta: [{ title: 'Kết quả · Điểm Mười' }] }),
  component: ExamResults,
})

function ExamResults() {
  const { examId } = Route.useParams()
  const exam = useQuery({
    queryKey: ['gv', 'exam', examId],
    queryFn: async () => unwrap(await supabase.from('exams').select('*').eq('id', examId).maybeSingle()) as Exam | null,
  })
  const questions = useQuery({
    queryKey: ['gv', 'questions', examId],
    queryFn: async () =>
      unwrap(await supabase.from('questions').select('*').eq('exam_id', examId).order('position').order('created_at')) as Question[],
  })
  const attempts = useQuery({
    queryKey: ['gv', 'exam-attempts', examId],
    queryFn: async () => unwrap(await supabase.from('attempts').select('*').eq('exam_id', examId).order('submitted_at')) as Attempt[],
  })
  const classes = useQuery(classesQuery)
  const roster = useQuery(rosterQuery)
  const ratings = useQuery({
    queryKey: ['gv', 'ratings', examId],
    queryFn: async () => unwrap(await supabase.from('exam_ratings').select('rating').eq('exam_id', examId)) as { rating: number }[],
  })
  const qc = useQueryClient()
  const finalize = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) unwrap(await supabase.rpc('submit_attempt', { p_attempt: id }))
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['gv'] }),
  })

  const error = exam.error ?? questions.error ?? attempts.error ?? classes.error ?? roster.error
  if (error) return <main className="page"><p role="alert" className="error">{error.message}</p></main>
  if (!exam.data || !questions.data || !attempts.data || !classes.data || !roster.data) {
    return (
      <main className="page">
        {exam.isSuccess && !exam.data ? <div className="well"><p>Không tìm thấy đề này.</p></div> : <p className="note" role="status">Đang tải…</p>}
      </main>
    )
  }

  const e = exam.data
  const done = attempts.data.filter((a) => a.submitted_at)
  const running = attempts.data.filter((a) => !a.submitted_at)
  const scores = done.map((a) => Number(a.score))
  const classRoster = roster.data.filter((r) => r.class_id === e.class_id)
  // Đếm số em trong danh sách đã nộp (không đếm lượt làm, khách, hay bài thử của giáo viên).
  const turnedIn = new Set(done.map((a) => a.user_id).filter((u) => classRoster.some((r) => r.user_id === u))).size
  const expired = running.filter((a) => new Date(a.deadline).getTime() + 30_000 < Date.now())
  const className = classes.data.find((c) => c.id === e.class_id)?.name
  const figures = [
    ['Đã nộp', e.class_id ? `${turnedIn}/${classRoster.length}` : `${done.length} bài`],
    ['Điểm trung bình', scores.length ? num(scores.reduce((s, x) => s + x, 0) / scores.length, 1) : '—'],
    ['Cao nhất', scores.length ? num(Math.max(...scores)) : '—'],
    ['Thấp nhất', scores.length ? num(Math.min(...scores)) : '—'],
    ['Đánh giá', ratings.data?.length ? `${num(ratings.data.reduce((s, r) => s + r.rating, 0) / ratings.data.length, 1)}/5 (${ratings.data.length})` : '—'],
  ]
  // Tỉ lệ làm đúng từng câu, câu khó nhất lên đầu.
  const hardest = questions.data
    .map((q, i) => ({ q, n: i + 1, pct: done.length ? (done.filter((a) => a.answers[q.id] === q.correct).length / done.length) * 100 : 0 }))
    .sort((a, b) => a.pct - b.pct)

  return (
    <main className="page">
      <Link to="/gv" search={{ tab: 'exams' }} className="back">← Đề thi</Link>
      <div className="page-head">
        <div className="stack-sm grow">
          <h1>{e.title}</h1>
          <p className="sub">{className ?? 'Không giới hạn lớp'}</p>
        </div>
        <Link to="/gv/de/$examId" params={{ examId: e.id }} className="btn">Soạn đề</Link>
        {e.leaderboard && (
          <Link to="/xep-hang" search={{ board: 'students', exam: e.id, crit: 0 }} className="btn">Bảng xếp hạng</Link>
        )}
      </div>
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

      <div className="split" style={{ marginTop: 'var(--space-lg)' }}>
        <section className="main stack" aria-labelledby="bn">
          <h2 id="bn">Bài đã nộp</h2>
          {done.length === 0 ? (
            <div className="well"><p>Chưa có bài nộp nào.</p></div>
          ) : (
            <div className="scroll-x">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Họ tên</th>
                    <th scope="col">Điểm</th>
                    <th scope="col">Đúng</th>
                    <th scope="col">Thời gian làm</th>
                    <th scope="col">Nộp lúc</th>
                    <th scope="col">Chi tiết</th>
                  </tr>
                </thead>
                <tbody>
                  {done.map((a) => (
                    <tr key={a.id}>
                      <th scope="row">{a.display_name}</th>
                      <td className="num">{num(Number(a.score))}</td>
                      <td className="num">{a.correct_count}/{a.total}</td>
                      <td>{duration((new Date(a.submitted_at as string).getTime() - new Date(a.started_at).getTime()) / 1000)}</td>
                      <td>{stamp(a.submitted_at)}</td>
                      <td><Link to="/ket-qua/$attemptId" params={{ attemptId: a.id }} aria-label={`Xem bài của ${a.display_name}`}>Xem bài</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {running.length > 0 && (
            <>
              <h2 id="dl">Đang làm</h2>
              <ul className="stack-sm" aria-labelledby="dl">
                {running.map((a) => (
                  <li key={a.id} className="row between">
                    <span>{a.display_name}</span>
                    <span className="note">
                      {expired.includes(a) ? `Hết giờ lúc ${stamp(a.deadline)}, chưa nộp` : `Bắt đầu ${stamp(a.started_at)}`}
                    </span>
                  </li>
                ))}
              </ul>
              {expired.length > 0 && (
                <div className="stack-sm">
                  <button type="button" className="btn" disabled={finalize.isPending} onClick={() => finalize.mutate(expired.map((a) => a.id))}>
                    Chấm {expired.length} bài hết giờ
                  </button>
                  <p className="note">Chấm theo các câu em đã lưu trước khi hết giờ.</p>
                  {finalize.error && <p role="alert" className="error">{finalize.error.message}</p>}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="aside card stack" aria-labelledby="kn">
          <h2 id="kn">Câu hỏi khó nhất</h2>
          {done.length === 0 || hardest.length === 0 ? (
            <p className="note">Cần có bài nộp để thống kê từng câu.</p>
          ) : (
            <ul className="stack-sm">
              {hardest.map(({ q, n, pct }) => (
                <li key={q.id} className="stack-sm">
                  <span className="note">Câu {n}: {q.body.length > 70 ? `${q.body.slice(0, 70)}…` : q.body}</span>
                  <div className="bar-row" style={{ gridTemplateColumns: 'minmax(0, 1fr) 44px' }}>
                    <span className="meter" role="img" aria-label={`Câu ${n}: ${Math.round(pct)}% làm đúng`}><span style={{ width: `${pct}%` }} /></span>
                    <span>{Math.round(pct)}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </main>
  )
}
