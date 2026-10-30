import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { TopBar, STUDENT_NAV } from '../components/TopBar'
import { duration, num, stamp } from '../lib/format'
import { supabase, unwrap, useMe } from '../lib/supabase'
import { useState } from 'react'
import type { Inquiry, Leaderboard, Review } from '../lib/types'

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
          <Body r={r} anonymous={!!meQuery.data?.anonymous} isTeacher={meQuery.data?.profile.role === 'teacher'} />
        )}
      </main>
    </>
  )
}

function Body({ r, anonymous, isTeacher }: { r: Review; anonymous: boolean; isTeacher: boolean }) {
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
            <MyRank examId={attempt.exam_id} />
          </dl>
        </section>
        {!isTeacher && <Rating examId={attempt.exam_id} />}
        {!isTeacher && !anonymous && <AskTeacher attemptId={attempt.id} questions={questions} />}

        {!reveal ? (
          // Đúng/sai từng câu cũng là đáp án, nên chỉ hiện cùng lúc với đáp án.
          <div className="well">
            <p>Chi tiết từng câu sẽ hiện khi giáo viên cho xem đáp án, sau khi đề đóng và cả lớp đã nộp bài.</p>
          </div>
        ) : (
        <section className="stack" aria-labelledby="xem-lai">
          <h2 id="xem-lai">{wrong.length > 0 ? `${wrong.length} câu cần xem lại` : 'Em làm đúng tất cả các câu'}</h2>
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
        )}
      </div>

      <aside className="aside card stack" aria-label="Việc tiếp theo">
        <Link to="/kho-de" className="btn btn--primary">Làm đề khác</Link>
        {anonymous && <p className="note">Kết quả này chỉ được lưu trên trình duyệt này. Em đăng nhập tài khoản để giữ lại lâu dài.</p>}
      </aside>
    </div>
  )
}

function MyRank({ examId }: { examId: string }) {
  const board = useQuery({
    queryKey: ['leaderboard', examId],
    queryFn: async () => unwrap(await supabase.rpc('leaderboard', { p_exam: examId })) as Leaderboard | null,
  })
  const mine = board.data?.rows.find((r) => r.me)
  if (!mine) return null // giáo viên tắt bảng xếp hạng, hoặc người xem là giáo viên
  return (
    <div>
      <dt className="figure-l">Xếp hạng</dt>
      <dd className="figure-v" style={{ fontSize: 'var(--text-xl)' }}>
        <Link to="/xep-hang" search={{ board: 'students', exam: examId, crit: 0 }}>Hạng {mine.rank} trên {board.data!.rows.length}</Link>
      </dd>
    </div>
  )
}

function Rating({ examId }: { examId: string }) {
  const qc = useQueryClient()
  const mine = useQuery({
    queryKey: ['my-rating', examId],
    queryFn: async () =>
      (unwrap(await supabase.from('exam_ratings').select('rating').eq('exam_id', examId).maybeSingle()) as { rating: number } | null)?.rating ?? 0,
  })
  const rate = useMutation({
    mutationFn: async (n: number) => unwrap(await supabase.rpc('rate_exam', { p_exam: examId, p_rating: n })),
    onSuccess: (_, n) => {
      qc.setQueryData(['my-rating', examId], n)
      qc.invalidateQueries({ queryKey: ['public-exams'] })
    },
  })
  const value = rate.isPending ? rate.variables : mine.data
  return (
    <section aria-labelledby="danhgia" className="card stack-sm">
      <h2 id="danhgia">Em thấy đề này thế nào?</h2>
      <div role="group" aria-label="Chấm điểm đề từ 1 đến 5" className="row">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} type="button" className="pill" aria-pressed={value === n} disabled={rate.isPending} onClick={() => rate.mutate(n)}>
            {n}
          </button>
        ))}
      </div>
      {rate.error ? (
        <p role="alert" className="error">{rate.error.message}</p>
      ) : (
        <p aria-live="polite" className="note">
          {value ? `Em chấm đề ${value} trên 5. Cảm ơn em đã góp ý.` : 'Đánh giá của em được tính vào chất lượng đề.'}
        </p>
      )}
    </section>
  )
}

function AskTeacher({ attemptId, questions }: { attemptId: string; questions: Review['questions'] }) {
  const qc = useQueryClient()
  const [question, setQuestion] = useState(questions[0]?.id ?? '')
  const [text, setText] = useState('')
  // RLS chỉ trả câu hỏi của chính em.
  const key = ['inquiries', attemptId]
  const mine = useQuery({
    queryKey: key,
    queryFn: async () => unwrap(await supabase.from('inquiries').select('*').eq('attempt_id', attemptId).order('created_at', { ascending: false })) as Inquiry[],
  })
  const ask = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('ask_teacher', { p_attempt: attemptId, p_question: question, p_body: text })),
    onSuccess: () => {
      setText('')
      qc.invalidateQueries({ queryKey: key })
    },
  })
  const number = (id: string | null) => questions.findIndex((q) => q.id === id) + 1
  return (
    <section aria-labelledby="hoi-co" className="card stack">
      <h2 id="hoi-co">Hỏi cô/thầy</h2>
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault()
          ask.mutate()
        }}
      >
        <div className="field">
          <label htmlFor="hoi-cau">Em hỏi về câu</label>
          <select id="hoi-cau" className="input" value={question} onChange={(e) => setQuestion(e.target.value)}>
            {questions.map((q, n) => <option key={q.id} value={q.id}>Câu {n + 1}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="hoi-noidung">Câu hỏi của em</label>
          <textarea id="hoi-noidung" className="input" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {ask.error && <p role="alert" className="error">{ask.error.message}</p>}
        <button type="submit" className="btn" disabled={ask.isPending || !text.trim()}>Gửi câu hỏi</button>
      </form>
      {mine.error && <p role="alert" className="error">{mine.error.message}</p>}
      {mine.data?.map((i) => (
        <article key={i.id} className="stack-sm">
          <span className="tag tag--pear">Câu {number(i.question_id)}</span>
          <div className="log">
            <p className="bubble bubble--me">{i.body}</p>
            {i.reply ? <p className="bubble">{i.reply}</p> : <p className="note">Đang chờ trả lời</p>}
          </div>
          {i.replied_at && <p className="note">Trả lời lúc {stamp(i.replied_at)}</p>}
        </article>
      ))}
    </section>
  )
}
