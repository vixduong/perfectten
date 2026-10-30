import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { LETTERS, fromLocalInput, toLocalInput } from '../../lib/format'
import { supabase, unwrap } from '../../lib/supabase'
import type { Access, Exam, Question } from '../../lib/types'
import { classesQuery, friendly } from '../gv'

export const Route = createFileRoute('/gv/de/$examId')({
  head: () => ({ meta: [{ title: 'Soạn đề · Điểm Mười' }] }),
  component: ExamEditor,
})

const LEVELS = ['Nhận biết', 'Thông hiểu', 'Vận dụng', 'Vận dụng cao']
const ACCESS: [Access, string, string][] = [
  ['private', 'Riêng tư theo link', 'Học sinh đăng nhập, chỉ danh sách lớp được vào.'],
  ['link', 'Bất kỳ ai có link', 'Không cần tài khoản, chỉ nhập họ tên.'],
  ['public', 'Công khai trong kho đề', 'Mọi người thấy đề trong kho đề và làm được.'],
]

function ExamEditor() {
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
  const classes = useQuery(classesQuery)

  const error = exam.error ?? questions.error ?? classes.error
  return (
    <main className="page">
      <Link to="/gv" search={{ tab: 'exams' }} className="back">← Đề thi</Link>
      {error && <p role="alert" className="error">{error.message}</p>}
      {exam.isPending || questions.isPending || classes.isPending ? (
        !error && <p className="note" role="status">Đang tải…</p>
      ) : !exam.data ? (
        <div className="well"><p>Không tìm thấy đề này.</p></div>
      ) : (
        <Editor key={exam.data.id} exam={exam.data} questions={questions.data ?? []} classes={classes.data ?? []} />
      )}
    </main>
  )
}

function Editor({ exam, questions, classes }: { exam: Exam; questions: Question[]; classes: { id: string; name: string }[] }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [title, setTitle] = useState(exam.title)
  const [subject, setSubject] = useState(exam.subject)
  const [grade, setGrade] = useState(exam.grade ? String(exam.grade) : '')
  const [classId, setClassId] = useState(exam.class_id ?? '')
  const [access, setAccess] = useState<Access>(exam.access)
  const [opens, setOpens] = useState(toLocalInput(exam.opens_at))
  const [closes, setCloses] = useState(toLocalInput(exam.closes_at))
  const [mins, setMins] = useState(String(exam.duration_min))
  const [maxAttempts, setMaxAttempts] = useState(String(exam.max_attempts))
  const [shuffleQ, setShuffleQ] = useState(exam.shuffle_questions)
  const [shuffleO, setShuffleO] = useState(exam.shuffle_options)
  const [showAnswers, setShowAnswers] = useState(exam.show_answers)
  const [leaderboard, setLeaderboard] = useState(exam.leaderboard)
  const [err, setErr] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState<string | null>(null) // 'new' hoặc id câu hỏi
  // Chỉ có một khung soạn; đổi sang câu khác thì hỏi trước để không mất nội dung đang gõ.
  const switchEditing = (id: string) =>
    (editing === null || window.confirm('Bỏ nội dung chưa lưu của câu đang soạn?')) && setEditing(id)

  const refresh = () => qc.invalidateQueries({ queryKey: ['gv'] })
  const link = `${location.origin}/de/${exam.id}`

  const save = useMutation({
    mutationFn: async (status: Exam['status']) => {
      return unwrap(
        await supabase
          .from('exams')
          .update({
            title: title.trim(),
            subject: subject.trim(),
            grade: grade ? Number(grade) : null,
            class_id: classId || null,
            access,
            status,
            duration_min: Number(mins),
            opens_at: fromLocalInput(opens),
            closes_at: fromLocalInput(closes),
            max_attempts: Number(maxAttempts),
            shuffle_questions: shuffleQ,
            shuffle_options: shuffleO,
            show_answers: showAnswers,
            leaderboard,
          })
          .eq('id', exam.id),
      )
    },
    onSuccess: () => {
      setSaved(true)
      refresh()
    },
    onError: (e) => setErr(friendly(e.message)),
  })
  const setStatus = useMutation({
    mutationFn: async (status: Exam['status']) => unwrap(await supabase.from('exams').update({ status }).eq('id', exam.id)),
    onSuccess: refresh,
    onError: (e) => setErr(friendly(e.message)),
  })
  const remove = useMutation({
    mutationFn: async () => unwrap(await supabase.from('exams').delete().eq('id', exam.id)),
    onSuccess: () => {
      refresh()
      navigate({ to: '/gv', search: { tab: 'exams' } })
    },
    onError: (e) => setErr(friendly(e.message)),
  })
  const swap = useMutation({
    mutationFn: async ([a, b]: [Question, Question]) => {
      unwrap(await supabase.from('questions').update({ position: b.position }).eq('id', a.id))
      unwrap(await supabase.from('questions').update({ position: a.position }).eq('id', b.id))
    },
    onSuccess: refresh,
    onError: (e) => setErr(friendly(e.message)),
  })
  const removeQuestion = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('questions').delete().eq('id', id)),
    onSuccess: refresh,
    onError: (e) => setErr(friendly(e.message)),
  })

  /** Kiểm tra trước khi gửi lên; trả về thông báo lỗi hoặc ''. */
  function check(publish: boolean): string {
    if (!title.trim()) return 'Vui lòng nhập tên đề.'
    if (grade && !(Number.isInteger(Number(grade)) && Number(grade) >= 1 && Number(grade) <= 12)) return 'Khối lớp phải từ 1 đến 12.'
    const m = Number(mins)
    if (!Number.isInteger(m) || m < 1 || m > 600) return 'Thời gian làm bài phải từ 1 đến 600 phút.'
    const n = Number(maxAttempts)
    if (!Number.isInteger(n) || n < 1 || n > 100) return 'Số lần làm tối đa phải từ 1 đến 100.'
    if (opens && closes && new Date(closes) <= new Date(opens)) return 'Giờ đóng đề phải sau giờ mở đề.'
    if (publish && questions.length === 0) return 'Đề cần có ít nhất một câu hỏi trước khi xuất bản.'
    if ((publish || exam.status !== 'draft') && access === 'private' && !classId) return 'Đề riêng tư cần chọn lớp.'
    return ''
  }

  function submit(status: Exam['status'], publish = false) {
    const msg = check(publish)
    setErr(msg)
    setSaved(false)
    if (!msg) save.mutate(status)
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
    } catch {
      setErr('Không chép được, hãy chọn link và sao chép thủ công.')
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="stack-sm grow">
          <div className="field">
            <label htmlFor="de-ten">Tên đề</label>
            <input id="de-ten" className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="row">
            <div className="field grow">
              <label htmlFor="de-mon">Môn</label>
              <input id="de-mon" className="input" value={subject} onChange={(e) => setSubject(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="de-khoi">Khối lớp</label>
              <select id="de-khoi" className="input" value={grade} onChange={(e) => setGrade(e.target.value)}>
                <option value="">Chưa chọn</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>Lớp {i + 1}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="de-lop">Lớp</label>
              <select id="de-lop" className="input" value={classId} onChange={(e) => setClassId(e.target.value)}>
                <option value="">Không giới hạn lớp</option>
                {classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        </div>
      </div>

      <div className="split">
        <section className="main stack" aria-labelledby="ch">
          <h2 id="ch">Câu hỏi ({questions.length})</h2>
          {questions.map((q, i) =>
            editing === q.id ? (
              <QuestionForm key={q.id} examId={exam.id} question={q} position={q.position} onDone={() => setEditing(null)} />
            ) : (
              <article key={q.id} className="card stack-sm">
                <div className="row">
                  <span className="tag tag--pear">Câu {i + 1}</span>
                  {q.level && <span className="tag tag--blue">{q.level}</span>}
                </div>
                <p className="q-text">{q.body}</p>
                <ul className="q-opts">
                  {q.options.map((o, k) => (
                    <li key={k} className={`q-opt ${k === q.correct ? 'is-answer' : ''}`}>{LETTERS[k]}. {o}</li>
                  ))}
                </ul>
                <div className="row">
                  <button type="button" className="btn" onClick={() => switchEditing(q.id)}>Sửa</button>
                  <button
                    type="button"
                    className="btn btn--link"
                    onClick={() => window.confirm(`Xóa câu ${i + 1}?`) && removeQuestion.mutate(q.id)}
                  >
                    Xóa
                  </button>
                  <button type="button" className="btn" aria-label={`Chuyển câu ${i + 1} lên`} disabled={i === 0 || swap.isPending} onClick={() => swap.mutate([q, questions[i - 1]])}>↑</button>
                  <button type="button" className="btn" aria-label={`Chuyển câu ${i + 1} xuống`} disabled={i === questions.length - 1 || swap.isPending} onClick={() => swap.mutate([q, questions[i + 1]])}>↓</button>
                </div>
              </article>
            ),
          )}
          {questions.length === 0 && editing !== 'new' && (
            <div className="well"><p>Đề chưa có câu hỏi nào.</p></div>
          )}
          {editing === 'new' ? (
            <QuestionForm
              examId={exam.id}
              position={questions.reduce((m, q) => Math.max(m, q.position), 0) + 1}
              onDone={() => setEditing(null)}
            />
          ) : (
            <button type="button" className="btn btn--primary" onClick={() => switchEditing('new')}>Thêm câu hỏi</button>
          )}
        </section>

        <aside className="aside card stack" aria-labelledby="xb">
          <h2 id="xb">Xuất bản</h2>
          <fieldset className="bare stack-sm">
            <legend className="note">Ai làm được đề này</legend>
            {ACCESS.map(([v, t, desc]) => (
              <label key={v} className="choice">
                <input type="radio" name="quyen" checked={access === v} onChange={() => setAccess(v)} />
                <span>
                  <span className="choice__title">{t}</span>
                  <span className="choice__desc">{desc}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <div className="field">
            <label htmlFor="de-mo">Mở đề</label>
            <input id="de-mo" type="datetime-local" className="input" value={opens} onChange={(e) => setOpens(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="de-dong">Đóng đề</label>
            <input id="de-dong" type="datetime-local" className="input" value={closes} onChange={(e) => setCloses(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="de-phut">Thời gian làm bài (phút)</label>
            <input id="de-phut" type="number" min={1} max={600} className="input input--mins" value={mins} onChange={(e) => setMins(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="de-lan">Số lần làm tối đa</label>
            <input id="de-lan" type="number" min={1} max={100} className="input input--mins" value={maxAttempts} onChange={(e) => setMaxAttempts(e.target.value)} />
          </div>
          <label className="check"><input type="checkbox" checked={shuffleQ} onChange={(e) => setShuffleQ(e.target.checked)} /> <span>Đảo thứ tự câu hỏi</span></label>
          <label className="check"><input type="checkbox" checked={shuffleO} onChange={(e) => setShuffleO(e.target.checked)} /> <span>Đảo thứ tự phương án</span></label>
          <label className="check"><input type="checkbox" checked={showAnswers} onChange={(e) => setShowAnswers(e.target.checked)} /> <span>Cho xem đáp án khi đề đóng và không còn ai đang làm (đề không hạn: khi em đã dùng hết số lần làm)</span></label>
          <label className="check"><input type="checkbox" checked={leaderboard} onChange={(e) => setLeaderboard(e.target.checked)} /> <span>Tính điểm vào bảng xếp hạng</span></label>

          {err && <p role="alert" className="error">{err}</p>}
          {saved && !err && <p role="status" className="note">Đã lưu cài đặt.</p>}
          <div className="row">
            <button type="button" className="btn" disabled={save.isPending} onClick={() => submit(exam.status)}>Lưu cài đặt</button>
            {exam.status === 'draft' ? (
              <button type="button" className="btn btn--primary" disabled={save.isPending} onClick={() => submit('open', true)}>Xuất bản đề</button>
            ) : (
              <button
                type="button"
                className="btn btn--primary"
                disabled={setStatus.isPending}
                onClick={() => {
                  setErr('')
                  setStatus.mutate(exam.status === 'open' ? 'closed' : 'open')
                }}
              >
                {exam.status === 'open' ? 'Đóng đề' : 'Mở lại'}
              </button>
            )}
          </div>

          {exam.status !== 'draft' && (
            <div className="well well--mint stack-sm">
              <label htmlFor="de-link" className="note">Link cho học sinh</label>
              <input id="de-link" className="input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
              <div className="row">
                <button type="button" className="btn" onClick={copy}>{copied ? 'Đã chép link' : 'Chép link'}</button>
                <Link to="/de/$examId" params={{ examId: exam.id }} className="btn btn--link">Xem như học sinh</Link>
                <Link to="/gv/ket-qua/$examId" params={{ examId: exam.id }} className="btn btn--link">Kết quả</Link>
              </div>
            </div>
          )}

          <button
            type="button"
            className="btn btn--link"
            onClick={() => window.confirm(`Xóa đề “${exam.title}”? Câu hỏi và bài làm của học sinh cũng sẽ bị xóa.`) && remove.mutate()}
          >
            Xóa đề
          </button>
        </aside>
      </div>
    </>
  )
}

/** Soạn một câu hỏi: dùng cho cả thêm mới (không có `question`) và sửa. */
function QuestionForm({ examId, question, position, onDone }: { examId: string; question?: Question; position: number; onDone: () => void }) {
  const qc = useQueryClient()
  const [body, setBody] = useState(question?.body ?? '')
  const [options, setOptions] = useState<string[]>(question?.options ?? ['', '', '', ''])
  const [correct, setCorrect] = useState<number | null>(question?.correct ?? null)
  const [level, setLevel] = useState(question?.level ?? '')
  const [err, setErr] = useState('')

  const save = useMutation({
    mutationFn: async () => {
      // Bỏ phương án trống; đáp án đúng dịch theo.
      const kept = options.map((t, i) => ({ t: t.trim(), i })).filter((o) => o.t)
      const row = { body: body.trim(), options: kept.map((o) => o.t), correct: kept.findIndex((o) => o.i === correct), level }
      return unwrap(
        question
          ? await supabase.from('questions').update(row).eq('id', question.id)
          : await supabase.from('questions').insert({ ...row, exam_id: examId, position }),
      )
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gv'] })
      onDone()
    },
    onError: (e) => setErr(friendly(e.message)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!body.trim()) return setErr('Vui lòng nhập nội dung câu hỏi.')
    if (options.filter((o) => o.trim()).length < 2) return setErr('Cần ít nhất 2 phương án.')
    if (correct === null) return setErr('Hãy chọn đáp án đúng.')
    if (!options[correct].trim()) return setErr('Đáp án đúng không được để trống.')
    setErr('')
    save.mutate()
  }

  function removeOption(i: number) {
    setOptions(options.filter((_, k) => k !== i))
    setCorrect(correct === null || correct === i ? null : correct > i ? correct - 1 : correct)
  }

  return (
    <form onSubmit={submit} noValidate className="card stack" aria-label={question ? 'Sửa câu hỏi' : 'Thêm câu hỏi'}>
      <div className="field">
        <label htmlFor="ch-noidung">Nội dung câu hỏi</label>
        <textarea id="ch-noidung" className="input" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
      </div>
      <fieldset className="bare stack-sm">
        <legend className="note">Phương án (chọn nút tròn ở đáp án đúng)</legend>
        {options.map((o, i) => (
          <div key={i} className="opt-row">
            <input type="radio" name="dap-an" aria-label={`Phương án ${LETTERS[i]} là đáp án đúng`} checked={correct === i} onChange={() => setCorrect(i)} />
            <input
              className={`input grow ${correct === i ? 'is-right' : ''}`}
              aria-label={`Phương án ${LETTERS[i]}`}
              value={o}
              onChange={(e) => setOptions(options.map((x, k) => (k === i ? e.target.value : x)))}
            />
            {options.length > 2 && (
              <button type="button" className="icon-btn" aria-label={`Xóa phương án ${LETTERS[i]}`} onClick={() => removeOption(i)}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            )}
          </div>
        ))}
        {options.length < 6 && (
          <button type="button" className="btn btn--link" onClick={() => setOptions([...options, ''])}>Thêm phương án</button>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="ch-muc">Mức độ</label>
        <select id="ch-muc" className="input" value={level} onChange={(e) => setLevel(e.target.value)}>
          <option value="">Không đặt</option>
          {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
        </select>
      </div>
      {err && <p role="alert" className="error">{err}</p>}
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={save.isPending}>Lưu</button>
        <button type="button" className="btn" onClick={onDone}>Hủy</button>
      </div>
    </form>
  )
}
