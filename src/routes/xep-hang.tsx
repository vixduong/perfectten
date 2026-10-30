import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { STUDENT_NAV, TEACHER_NAV, TopBar } from '../components/TopBar'
import { clock, num } from '../lib/format'
import { supabase, unwrap, useMe } from '../lib/supabase'
import type { ExamQuality, Leaderboard } from '../lib/types'

type Search = { board: 'students' | 'exams'; exam?: string; crit: number }

export const Route = createFileRoute('/xep-hang')({
  validateSearch: (s: Record<string, unknown>): Search => ({
    board: s.board === 'exams' ? 'exams' : 'students',
    exam: typeof s.exam === 'string' ? s.exam : undefined,
    crit: [0, 1, 2, 3].includes(Number(s.crit)) ? Number(s.crit) : 0,
  }),
  head: () => ({ meta: [{ title: 'Bảng xếp hạng · Điểm Mười' }] }),
  component: Ranking,
})

/** So sánh theo một cột, giá trị null luôn xuống cuối. */
function by<T>(key: keyof T, desc: boolean) {
  return (a: T, b: T) => {
    const x = a[key] as number | null
    const y = b[key] as number | null
    if (x === null || y === null) return (x === null ? 1 : 0) - (y === null ? 1 : 0)
    return desc ? y - x : x - y
  }
}

type Row = Leaderboard['rows'][number]
const STUDENT_SORTS: [string, (a: Row, b: Row) => number][] = [
  ['Điểm cao nhất', (a, b) => a.rank - b.rank],
  ['Làm nhanh nhất', by<Row>('secs', false)],
  ['Tiến bộ nhiều nhất', by<Row>('gain', true)],
  ['Làm nhiều bài nhất', by<Row>('done', true)],
]
const EXAM_SORTS: [string, (a: ExamQuality, b: ExamQuality) => number][] = [
  ['Đánh giá cao nhất', by<ExamQuality>('rating', true)],
  ['Phân loại tốt nhất', by<ExamQuality>('discrimination', true)],
  ['Nhiều lượt làm nhất', by<ExamQuality>('attempts', true)],
  ['Điểm trung bình cao nhất', by<ExamQuality>('avg_score', true)],
]

function Ranking() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/xep-hang' })
  const me = useMe().data
  const set = (patch: Partial<Search>) => navigate({ search: (s) => ({ ...s, ...patch }), replace: true })
  const sorts = search.board === 'students' ? STUDENT_SORTS : EXAM_SORTS
  const sorted = (i: number) => (search.crit === i ? 'num is-sorted' : 'num')

  return (
    <>
      <TopBar nav={me?.profile.role === 'teacher' && !me.anonymous ? TEACHER_NAV : STUDENT_NAV} label="Điều hướng" />
      <main className="page page--narrow stack-lg">
        <h1>Bảng xếp hạng</h1>
        <div className="row" role="group" aria-label="Loại bảng xếp hạng">
          {(['students', 'exams'] as const).map((b) => (
            <button key={b} type="button" className="pill" aria-pressed={search.board === b} onClick={() => set({ board: b, crit: 0 })}>
              {b === 'students' ? 'Thành tích học sinh' : 'Chất lượng đề thi'}
            </button>
          ))}
        </div>
        <div className="field">
          <span id="tieuchi" className="note">Xếp theo</span>
          <div className="row" role="group" aria-labelledby="tieuchi">
            {sorts.map(([label], i) => (
              <button key={label} type="button" className="pill" aria-pressed={search.crit === i} onClick={() => set({ crit: i })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {search.board === 'students' ? (
          me ? <Students search={search} set={set} sorted={sorted} /> : (
            <div className="card stack-sm">
              <p>Đăng nhập để xem thứ hạng của em trong các đề đã làm.</p>
              <Link to="/dang-nhap" search={{ next: '/xep-hang' }} className="btn btn--primary">Đăng nhập</Link>
            </div>
          )
        ) : (
          <Exams crit={search.crit} sorted={sorted} />
        )}
      </main>
    </>
  )
}

function Students({ search, set, sorted }: { search: Search; set: (p: Partial<Search>) => void; sorted: (i: number) => string }) {
  const exams = useQuery({
    queryKey: ['leaderboard-exams'],
    queryFn: async () => unwrap(await supabase.rpc('leaderboard_exams')) as { id: string; title: string }[],
  })
  const examId = search.exam ?? exams.data?.[0]?.id
  const board = useQuery({
    queryKey: ['leaderboard', examId],
    enabled: !!examId,
    queryFn: async () => unwrap(await supabase.rpc('leaderboard', { p_exam: examId })) as Leaderboard | null,
  })

  const error = exams.error ?? board.error
  if (error) return <p role="alert" className="error">{error.message}</p>
  if (exams.isPending) return <p className="note">Đang tải…</p>
  if (!examId) return <div className="well"><p>Em chưa nộp bài đề nào có bảng xếp hạng.</p></div>

  const rows = [...(board.data?.rows ?? [])].sort(STUDENT_SORTS[search.crit][1])
  const myPlace = rows.findIndex((r) => r.me) + 1

  return (
    <div className="stack">
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="de">Đề thi</label>
        <select id="de" className="input" value={examId} onChange={(e) => set({ exam: e.target.value })}>
          {/* Đề mở qua link có thể không nằm trong danh sách: vẫn giữ lựa chọn hiện tại. */}
          {!exams.data?.some((x) => x.id === examId) && board.data && <option value={examId}>{board.data.exam.title}</option>}
          {exams.data?.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
        </select>
      </div>
      {board.isPending ? (
        <p className="note">Đang tải…</p>
      ) : !board.data ? (
        <div className="well"><p>Em chưa xem được bảng xếp hạng của đề này, hoặc giáo viên đã tắt bảng xếp hạng.</p></div>
      ) : rows.length === 0 ? (
        <div className="well"><p>Chưa có bài nộp nào.</p></div>
      ) : (
        <>
          <p aria-live="polite">
            {board.data.exam.title}.{' '}
            {myPlace ? <>Em đang xếp hạng <mark>{myPlace}</mark> theo tiêu chí này.</> : `${rows.length} người đã nộp bài.`}
          </p>
          <div className="card card--tight scroll-x">
            <table className="table" style={{ minWidth: 640 }}>
              <thead>
                <tr>
                  <th scope="col">Hạng</th>
                  <th scope="col">Học sinh</th>
                  <th scope="col">Điểm</th>
                  <th scope="col">Thời gian</th>
                  <th scope="col">Tiến bộ so với đề trước</th>
                  <th scope="col">Số bài đã làm</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`} className={r.me ? 'is-me' : undefined}>
                    <td><span className={`rank ${i < 3 ? 'rank--top' : ''}`}>{i + 1}</span></td>
                    <th scope="row">{r.name}{r.me && <span className="visually-hidden"> (em)</span>}</th>
                    <td className={sorted(0)}>{num(r.score)}</td>
                    <td className={sorted(1)}>{clock(r.secs)}</td>
                    <td className={sorted(2)}>{r.gain === null ? '—' : `${r.gain > 0 ? '+' : ''}${num(r.gain)}`}</td>
                    <td className={sorted(3)}>{r.done}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function Exams({ crit, sorted }: { crit: number; sorted: (i: number) => string }) {
  const q = useQuery({
    queryKey: ['exam-quality'],
    queryFn: async () => unwrap(await supabase.rpc('exam_quality')) as ExamQuality[],
  })
  if (q.error) return <p role="alert" className="error">{q.error.message}</p>
  if (!q.data) return <p className="note">Đang tải…</p>
  if (q.data.length === 0) return <div className="well"><p>Chưa có đề công khai nào có bài nộp.</p></div>
  const rows = [...q.data].sort(EXAM_SORTS[crit][1])
  return (
    <div className="stack-sm">
      <div className="card card--tight scroll-x">
        <table className="table" style={{ minWidth: 720 }}>
          <thead>
            <tr>
              <th scope="col">Hạng</th>
              <th scope="col">Đề thi</th>
              <th scope="col">Giáo viên</th>
              <th scope="col">Đánh giá</th>
              <th scope="col">Độ phân biệt</th>
              <th scope="col">Lượt làm</th>
              <th scope="col">Điểm trung bình</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={e.id}>
                <td><span className={`rank ${i < 3 ? 'rank--top' : ''}`}>{i + 1}</span></td>
                <th scope="row"><Link to="/de/$examId" params={{ examId: e.id }}>{e.title}</Link></th>
                <td>{e.teacher_name}</td>
                <td className={sorted(0)}>{e.rating === null ? '—' : num(e.rating, 1)}</td>
                <td className={sorted(1)}>{e.discrimination === null ? '—' : num(e.discrimination)}</td>
                <td className={sorted(2)}>{e.attempts.toLocaleString('vi-VN')}</td>
                <td className={sorted(3)}>{num(e.avg_score, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="note">Độ phân biệt: chênh lệch điểm trung bình giữa nhóm 25% cao nhất và 25% thấp nhất, chia 10. Cần ít nhất 4 bài nộp.</p>
    </div>
  )
}
