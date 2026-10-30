import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { TopBar, STUDENT_NAV } from '../components/TopBar'
import { duration, num } from '../lib/format'
import { supabase, unwrap, useMe } from '../lib/supabase'
import type { Review } from '../lib/types'

export const Route = createFileRoute('/ket-qua/$attemptId')({
  head: () => ({ meta: [{ title: 'Kết quả · Điểm Mười' }] }),
  component: Result,
})

const comment = (score: number) =>
  score >= 9
    ? 'Giỏi lắm! Em nắm rất chắc phần này.'
    : score >= 7
      ? 'Khá lắm! Làm thêm một đề để chắc hơn nhé.'
      : score >= 5
        ? 'Em cần ôn thêm một chút.'
        : 'Em hãy xem lại các câu sai và hỏi cô nhé.'

function Result() {
  const { attemptId } = Route.useParams()
  const meQuery = useMe()
  const review = useQuery({
    queryKey: ['review', attemptId, meQuery.data?.userId ?? 'khach'],
    enabled: !meQuery.isPending,
    queryFn: async () => unwrap(await supabase.rpc('attempt_review', { p_attempt: attemptId })) as Review | null,
  })
  const r = review.data

  return (
    <>
      <TopBar nav={STUDENT_NAV} label="Học sinh" />
      <main className="page stack">
        {review.error && <p role="alert" className="error">{review.error.message}</p>}
        {!r ? (
          review.isPending || meQuery.isPending ? (
            <p className="note">Đang tải…</p>
          ) : (
            !review.error && (
              <div className="card stack-sm">
                <h1>Chưa có kết quả</h1>
                <p className="sub">Bài này chưa nộp hoặc em không có quyền xem.</p>
                <Link to="/kho-de" className="btn">Vào kho đề</Link>
              </div>
            )
          )
        ) : (
          <Body r={r} anonymous={!!meQuery.data?.anonymous} />
        )}
      </main>
    </>
  )
}

function Body({ r, anonymous }: { r: Review; anonymous: boolean }) {
  const { attempt, exam, questions, reveal } = r
  const seconds = (new Date(attempt.submitted_at).getTime() - new Date(attempt.started_at).getTime()) / 1000
  const wrong = questions.map((q, n) => ({ q, n })).filter(({ q }) => q.is_correct !== true)

  return (
    <div className="split">
      <div className="main stack-lg">
        <section className="paper stack" aria-labelledby="kq">
          <div className="stack-sm">
            <h1 id="kq">{exam.title}</h1>
            <p className="sub">{[attempt.display_name, exam.subject].filter(Boolean).join(' · ')}</p>
          </div>
          <div className="marks">
            <div className="marks__score">
              <span className="marks__label">Điểm</span>
              <div className="grade">{num(attempt.score)}</div>
            </div>
            <div className="marks__comment">
              <span className="marks__label">Lời phê</span>
              <p className="comment">{comment(attempt.score)}</p>
            </div>
          </div>
          <dl className="figures">
            <div>
              <dt className="figure-l">Số câu đúng</dt>
              <dd className="figure-v">{attempt.correct_count} <span className="figure-u">trên {attempt.total}</span></dd>
            </div>
            <div>
              <dt className="figure-l">Thời gian</dt>
              <dd className="figure-v" style={{ fontSize: 'var(--text-xl)' }}>{duration(seconds)}</dd>
            </div>
          </dl>
        </section>

        <section className="stack" aria-labelledby="xem-lai">
          <h2 id="xem-lai">{wrong.length > 0 ? `${wrong.length} câu cần xem lại` : 'Em làm đúng tất cả các câu'}</h2>
          {wrong.length > 0 && !reveal && <p className="note">Đáp án sẽ hiện khi cô cho xem (sau khi đóng đề).</p>}
          {wrong.map(({ q, n }) => (
            <article key={q.id} className="card stack-sm">
              <span className="tag tag--pear">Câu {n + 1}</span>
              <p className="q-text">{q.body}</p>
              <p className="error">{q.chosen === null ? 'Em chưa trả lời' : `Em chọn: ${q.options[q.chosen]}`}</p>
              {reveal && q.correct !== null && (
                <ul className="q-opts">
                  <li className="q-opt is-answer">Đáp án đúng: {q.options[q.correct]}</li>
                </ul>
              )}
            </article>
          ))}
        </section>
      </div>

      <aside className="aside card stack" aria-label="Việc tiếp theo">
        <Link to="/kho-de" className="btn btn--primary">Làm đề khác</Link>
        {anonymous && <p className="note">Kết quả này chỉ được lưu trên trình duyệt này. Em đăng nhập tài khoản để giữ lại lâu dài.</p>}
      </aside>
    </div>
  )
}
