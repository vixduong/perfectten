import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { clock, LETTERS } from '../lib/format'
import { supabase, unwrap, useMe } from '../lib/supabase'
import type { Paper } from '../lib/types'

export const Route = createFileRoute('/lam-bai/$attemptId')({
  head: () => ({ meta: [{ title: 'Làm bài · Điểm Mười' }] }),
  component: TakePage,
})

type Save = 'saved' | 'saving' | 'error'
const saveText: Record<Save, string> = {
  saved: 'Đã lưu bài',
  saving: 'Đang lưu…',
  error: 'Chưa lưu được — kiểm tra mạng',
}

function TakePage() {
  const { attemptId } = Route.useParams()
  const meQuery = useMe()
  const paper = useQuery({
    queryKey: ['paper', attemptId, meQuery.data?.userId ?? 'khach'],
    enabled: !meQuery.isPending,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const p = unwrap(await supabase.rpc('attempt_questions', { p_attempt: attemptId })) as Paper | null
      // Chênh lệch đồng hồ máy so với máy chủ, tính tại thời điểm tải.
      return { paper: p, skew: p ? new Date(p.attempt.now).getTime() - Date.now() : 0 }
    },
  })

  const p = paper.data?.paper
  if (!p) {
    return (
      <main className="page page--narrow stack">
        {paper.error && <p role="alert" className="error">{paper.error.message}</p>}
        {paper.data ? (
          <>
            <h1>Không tìm thấy bài làm</h1>
            <Link to="/" className="btn">Về trang chủ</Link>
          </>
        ) : (
          !paper.error && <p className="note">Đang tải…</p>
        )}
      </main>
    )
  }
  if (p.attempt.submitted_at) {
    return (
      <main className="page page--narrow stack">
        <h1>Bài này đã nộp</h1>
        <Link to="/ket-qua/$attemptId" params={{ attemptId }} className="btn btn--primary">Xem kết quả</Link>
      </main>
    )
  }
  return <Take paper={p} skew={paper.data!.skew} />
}

function Take({ paper, skew }: { paper: Paper; skew: number }) {
  const { attempt, exam, questions } = paper
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [answers, setAnswers] = useState<Record<string, number>>(attempt.answers ?? {})
  const [idx, setIdx] = useState(0)
  const [flags, setFlags] = useState<Set<string>>(new Set())
  const [save, setSave] = useState<Save>('saved')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [ticks, tick] = useState(0)

  const deadline = new Date(attempt.deadline).getTime()
  const secondsLeft = (deadline - (Date.now() + skew)) / 1000
  const total = useRef(Math.max(1, secondsLeft)).current
  const queue = useRef<Promise<void>>(Promise.resolve())
  const failed = useRef(new Map<string, number>())
  const pending = useRef(0)
  const done = useRef(false)

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [])

  // Lưu tuần tự để lệnh nộp bài luôn chạy sau các câu trả lời trước đó.
  function persist(qid: string, choice: number) {
    pending.current++
    setSave('saving')
    queue.current = queue.current.then(async () => {
      const { error } = await supabase.rpc('save_answer', { p_attempt: attempt.id, p_question: qid, p_choice: choice })
      if (error) failed.current.set(qid, choice)
      else failed.current.delete(qid)
      pending.current--
      setSave(failed.current.size ? 'error' : pending.current ? 'saving' : 'saved')
    })
    return queue.current
  }

  function pick(qid: string, choice: number) {
    setAnswers((a) => ({ ...a, [qid]: choice }))
    persist(qid, choice)
  }

  async function submit() {
    if (done.current) return
    done.current = true
    setSubmitting(true)
    setSubmitError('')
    try {
      for (const [qid, choice] of [...failed.current]) persist(qid, choice) // thử lưu lại các câu đã lỗi
      await queue.current
      unwrap(await supabase.rpc('submit_attempt', { p_attempt: attempt.id }))
      qc.invalidateQueries({ queryKey: ['hs'] })
      qc.invalidateQueries({ queryKey: ['exam-info'] })
      navigate({ to: '/ket-qua/$attemptId', params: { attemptId: attempt.id }, replace: true })
    } catch (e) {
      done.current = false
      setSubmitting(false)
      setSubmitError((e as Error).message)
    }
  }

  const expired = secondsLeft <= 0
  useEffect(() => {
    if (expired) submit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expired, ticks]) // thử lại mỗi giây nếu nộp tự động bị lỗi mạng

  const q = questions[idx]
  const answered = questions.filter((x) => answers[x.id] !== undefined).length
  const left = questions.length - answered

  return (
    <>
      <header className="torn topbar">
        <div className="grow stack-sm">
          <h1 style={{ fontSize: 'var(--text-md)' }}>{exam.title}</h1>
          <ul className="meta">
            <li>{attempt.display_name}</li>
            <li role="status">{saveText[save]}</li>
          </ul>
        </div>
        <span className="strip" aria-hidden="true">
          <span style={{ transform: `scaleX(${Math.min(1, Math.max(0, secondsLeft / total))})` }} />
        </span>
        <div role="timer" aria-label="Thời gian còn lại" className={'timer ' + (secondsLeft < 300 ? 'is-low' : '')}>
          {clock(secondsLeft)}
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setConfirming(true)} disabled={submitting}>
          Nộp bài
        </button>
      </header>

      <main className="page stack">
        {confirming && (
          <div role="alertdialog" aria-label="Xác nhận nộp bài" className="well well--coral row between">
            <p>
              {left > 0 ? `Em còn ${left} câu chưa trả lời. ` : ''}Em chắc chắn muốn nộp bài?
            </p>
            <div className="row">
              <button type="button" className="btn" autoFocus onClick={() => setConfirming(false)}>Làm tiếp</button>
              <button type="button" className="btn btn--primary" disabled={submitting} onClick={submit}>Nộp bài</button>
            </div>
          </div>
        )}
        {submitError && <p role="alert" className="error">{submitError}</p>}

        <div className="split">
          <div className="main">
            <div className="mat">
              <section className="paper stack" aria-label={`Câu ${idx + 1}`}>
                <fieldset className="bare stack">
                  <legend>
                    <span className="note">Câu {idx + 1} trên {questions.length}</span>
                    <span className="paper-q">{q.body}</span>
                  </legend>
                  {q.options.map((o, k) => (
                    <label key={o.i} className="choice">
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        value={o.i}
                        checked={answers[q.id] === o.i}
                        onChange={() => pick(q.id, o.i)}
                      />
                      <span><strong>{LETTERS[k]}.</strong> <span>{o.t}</span></span>
                    </label>
                  ))}
                </fieldset>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={flags.has(q.id)}
                    onChange={() =>
                      setFlags((f) => {
                        const n = new Set(f)
                        if (!n.delete(q.id)) n.add(q.id)
                        return n
                      })
                    }
                  />
                  <span>Đánh dấu xem lại</span>
                </label>
                <div className="row between">
                  <button type="button" className="btn" disabled={idx === 0} onClick={() => setIdx(idx - 1)}>Câu trước</button>
                  <button type="button" className="btn" disabled={idx === questions.length - 1} onClick={() => setIdx(idx + 1)}>Câu tiếp</button>
                </div>
              </section>
            </div>
          </div>

          <aside className="aside card stack" aria-labelledby="ds-cau">
            <h2 id="ds-cau" style={{ fontSize: 'var(--text-lg)' }}>Danh sách câu</h2>
            <p className="note">Đã trả lời {answered} trên {questions.length} câu</p>
            <div className="palette">
              {questions.map((x, n) => (
                <button
                  key={x.id}
                  type="button"
                  className="qnum"
                  aria-label={`Câu ${n + 1}`}
                  aria-current={n === idx ? 'true' : undefined}
                  data-done={answers[x.id] !== undefined}
                  data-flag={flags.has(x.id)}
                  onClick={() => setIdx(n)}
                >
                  {n + 1}
                </button>
              ))}
            </div>
            <ul className="meta" aria-label="Chú thích">
              <li><span className="swatch swatch--done" aria-hidden="true" /> Đã trả lời</li>
              <li><span className="swatch swatch--flag" aria-hidden="true" /> Xem lại</li>
              <li><span className="swatch" aria-hidden="true" /> Chưa làm</li>
            </ul>
            <p className="note">Trợ lý AI tạm tắt trong lúc làm bài.</p>
          </aside>
        </div>
      </main>
    </>
  )
}
