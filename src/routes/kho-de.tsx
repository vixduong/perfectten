import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { TopBar, STUDENT_NAV } from '../components/TopBar'
import { num } from '../lib/format'
import { publicExamsQuery } from './index'

export const Route = createFileRoute('/kho-de')({
  head: () => ({ meta: [{ title: 'Kho đề công khai · Điểm Mười' }] }),
  component: Bank,
})

/** Bỏ dấu để tìm kiếm không phân biệt dấu. */
const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').toLowerCase()

function Bank() {
  const { data, isPending, error } = useQuery(publicExamsQuery)
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState('')
  const exams = data ?? []
  const subjects = [...new Set(exams.map((e) => e.subject).filter(Boolean))]
  const needle = fold(q.trim())
  const shown = exams.filter(
    (e) => (!subject || e.subject === subject) && fold(`${e.title} ${e.teacher_name} ${e.subject}`).includes(needle),
  )

  return (
    <>
      <TopBar nav={STUDENT_NAV} label="Học sinh" />
      <main className="page stack">
        <div className="page-head">
          <div className="stack-sm grow">
            <h1>Kho đề công khai</h1>
            <p className="sub">Đề do giáo viên chia sẻ. Làm miễn phí, không cần đăng nhập.</p>
          </div>
        </div>

        <div className="field">
          <label htmlFor="tim">Tìm theo tên đề, giáo viên hoặc môn</label>
          <input id="tim" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="tabs" role="group" aria-label="Lọc theo môn">
          {['', ...subjects].map((s) => (
            <button key={s} type="button" className="pill" aria-pressed={subject === s} onClick={() => setSubject(s)}>
              {s || 'Tất cả'}
            </button>
          ))}
        </div>

        {error && <p role="alert" className="error">{error.message}</p>}
        <p className="note" aria-live="polite">{isPending ? 'Đang tải…' : `${shown.length} đề`}</p>

        {!isPending && shown.length === 0 ? (
          <div className="card"><p>Không có đề phù hợp. Thử bỏ bớt bộ lọc hoặc đổi từ khóa nhé.</p></div>
        ) : (
          <ul className="grid-cards">
            {shown.map((e) => (
              <li key={e.id} className="card card--lift stack-sm">
                <div className="row">
                  <span className="tile" data-subject={e.subject}>{e.subject || 'Đề thi'}</span>
                  {e.grade && <span className="note">Lớp {e.grade}</span>}
                </div>
                <h2 style={{ fontSize: 'var(--text-lg)' }}>{e.title}</h2>
                <p className="sub grow">{e.teacher_name}</p>
                <ul className="meta">
                  <li>{e.question_count} câu</li>
                  <li>{e.duration_min} phút</li>
                  {e.rating !== null && <li>{num(e.rating, 1)} trên 5</li>}
                  <li>{e.attempt_count} lượt làm</li>
                </ul>
                <Link to="/de/$examId" params={{ examId: e.id }} className="btn">Làm bài</Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  )
}
