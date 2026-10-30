import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { stamp } from '../../lib/format'
import { supabase, unwrap } from '../../lib/supabase'
import type { Inquiry } from '../../lib/types'
import { attemptsQuery, examsQuery } from '../gv'

export const Route = createFileRoute('/gv/hoi-dap')({
  head: () => ({ meta: [{ title: 'Câu hỏi học sinh · Điểm Mười' }] }),
  component: Inquiries,
})

function Inquiries() {
  const inquiries = useQuery({
    queryKey: ['gv', 'inquiries'],
    queryFn: async () => unwrap(await supabase.from('inquiries').select('*').order('created_at', { ascending: false })) as Inquiry[],
  })
  // Chỉ lấy id và nội dung câu hỏi, không lấy đáp án.
  const questions = useQuery({
    queryKey: ['gv', 'question-bodies'],
    queryFn: async () => unwrap(await supabase.from('questions').select('id, body')) as { id: string; body: string }[],
  })
  const attempts = useQuery(attemptsQuery)
  const exams = useQuery(examsQuery)
  const [picked, setPicked] = useState<string | null>(null)

  const error = inquiries.error ?? questions.error ?? attempts.error ?? exams.error
  if (error) return <main className="page"><p role="alert" className="error">{error.message}</p></main>
  if (!inquiries.data || !questions.data || !attempts.data || !exams.data) {
    return <main className="page"><p className="note" role="status">Đang tải…</p></main>
  }

  const list = inquiries.data
  const selected = list.find((i) => i.id === picked) ?? list[0]
  const context = (i: Inquiry) => {
    const attempt = attempts.data.find((a) => a.id === i.attempt_id)
    const n = i.question_id ? (attempt?.question_order.indexOf(i.question_id) ?? -1) + 1 : 0
    return {
      student: attempt?.display_name ?? 'Học sinh',
      exam: exams.data.find((e) => e.id === i.exam_id)?.title ?? '',
      number: n > 0 ? `Câu ${n}` : 'Câu đã bị xóa khỏi đề',
      question: questions.data.find((q) => q.id === i.question_id)?.body ?? '',
    }
  }

  return (
    <main className="page stack">
      <h1>Câu hỏi học sinh</h1>
      {list.length === 0 ? (
        <div className="well"><p>Chưa có học sinh nào hỏi. Học sinh hỏi từ trang kết quả sau khi nộp bài.</p></div>
      ) : (
        <div className="split">
          <nav className="aside stack-sm" aria-label="Danh sách câu hỏi">
            {list.map((i) => {
              const c = context(i)
              return (
                <button key={i.id} type="button" className="thread stack-sm" aria-current={i.id === selected.id} onClick={() => setPicked(i.id)}>
                  <span className={i.reply ? 'tag tag--mint' : 'tag tag--coral'}>{i.reply ? 'Đã trả lời' : 'Chờ trả lời'}</span>
                  <strong>{c.student} · {c.number}</strong>
                  <span className="note">{c.exam} · {stamp(i.created_at)}</span>
                </button>
              )
            })}
          </nav>
          <Thread key={selected.id} inquiry={selected} {...context(selected)} />
        </div>
      )}
    </main>
  )
}

function Thread({ inquiry, student, exam, number, question }: { inquiry: Inquiry; student: string; exam: string; number: string; question: string }) {
  const qc = useQueryClient()
  const [text, setText] = useState(inquiry.reply ?? '')
  const send = useMutation({
    mutationFn: async () => unwrap(await supabase.rpc('reply_inquiry', { p_inquiry: inquiry.id, p_body: text })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['gv'] }),
  })
  return (
    <section className="main card stack" aria-labelledby="hd-tieude">
      <div className="stack-sm">
        <h2 id="hd-tieude">{student}</h2>
        <p className="sub">{exam} · {number} · {stamp(inquiry.created_at)}</p>
      </div>
      {question && <p className="q-text">{question}</p>}
      <div className="log">
        <p className="bubble">{inquiry.body}</p>
        {inquiry.reply && <p className="bubble bubble--me">{inquiry.reply}</p>}
      </div>
      {inquiry.replied_at && <p className="note">Đã gửi lúc {stamp(inquiry.replied_at)}</p>}
      <form
        className="stack-sm"
        onSubmit={(e) => {
          e.preventDefault()
          send.mutate()
        }}
      >
        <div className="field">
          <label htmlFor="tra-loi">{inquiry.reply ? 'Sửa câu trả lời' : 'Trả lời học sinh'}</label>
          <textarea id="tra-loi" className="input" rows={4} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {send.error && <p role="alert" className="error">{send.error.message}</p>}
        <button type="submit" className="btn btn--primary" disabled={send.isPending || !text.trim()}>Gửi cho học sinh</button>
      </form>
    </section>
  )
}
