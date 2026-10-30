import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, type FormEvent } from 'react'
import { TopBar } from '../components/TopBar'
import { stamp } from '../lib/format'
import { supabase, unwrap, useMe } from '../lib/supabase'
import type { ExamInfo } from '../lib/types'

export const Route = createFileRoute('/de/$examId')({
  head: () => ({ meta: [{ title: 'Vào phòng thi · Điểm Mười' }] }),
  component: Entry,
})

function Entry() {
  const { examId } = Route.useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const meQuery = useMe()
  const me = meQuery.data
  const user = me && !me.anonymous ? me : null
  const [typed, setTyped] = useState<string | null>(null)
  const name = typed ?? me?.profile.full_name ?? ''

  // Khóa theo người dùng để đăng nhập/đăng xuất thì tự tải lại (số lượt, tư cách thành viên).
  const info = useQuery({
    queryKey: ['exam-info', examId, me?.userId ?? 'khach'],
    enabled: !meQuery.isPending,
    queryFn: async () => unwrap(await supabase.rpc('exam_info', { p_exam: examId })) as ExamInfo | null,
  })

  const start = useMutation({
    mutationFn: async () => {
      if (!me) {
        const { error } = await supabase.auth.signInAnonymously({ options: { data: { full_name: name.trim() } } })
        if (error) throw new Error(error.message)
      }
      return unwrap(await supabase.rpc('start_attempt', { p_exam: examId, p_name: name.trim() || null })) as string
    },
    onSuccess: (attemptId) => {
      qc.invalidateQueries({ queryKey: ['exam-info', examId] })
      navigate({ to: '/lam-bai/$attemptId', params: { attemptId } })
    },
  })
  function submit(e: FormEvent) {
    e.preventDefault()
    start.mutate()
  }

  const e = info.data
  const now = Date.now()
  const notYet = !!e && !!e.opens_at && now < new Date(e.opens_at).getTime()
  const closed = !!e && (e.status !== 'open' || (!!e.closes_at && now >= new Date(e.closes_at).getTime()))
  const nextPath = `/de/${examId}`
  const startError = start.error && <p role="alert" className="error">{start.error.message}</p>

  let aside
  if (!e) {
    aside = <p className="note">{info.isPending || meQuery.isPending ? 'Đang tải…' : 'Không tìm thấy đề này.'}</p>
  } else if (closed || notYet) {
    aside = (
      <div className="well">
        <p>{notYet ? `Đề chưa mở. Em quay lại sau ${stamp(e.opens_at)} nhé.` : 'Đề đã đóng, em không làm bài được nữa.'}</p>
      </div>
    )
  } else if (e.open_attempt) {
    aside = (
      <div className="stack-sm">
        <p>Em đang có một bài làm dở.</p>
        <Link to="/lam-bai/$attemptId" params={{ attemptId: e.open_attempt }} className="btn btn--primary btn--lg">Làm tiếp</Link>
      </div>
    )
  } else if (e.my_attempts >= e.max_attempts) {
    aside = <div className="well"><p>Em đã dùng hết số lần làm đề này.</p></div>
  } else if (e.access === 'private') {
    if (!user) {
      aside = (
        <div className="stack-sm">
          <h2>Đăng nhập để làm bài</h2>
          <p className="sub">Đề này chỉ dành cho học sinh trong lớp.</p>
          <Link to="/dang-nhap" search={{ next: nextPath }} className="btn btn--primary btn--lg">Đăng nhập</Link>
        </div>
      )
    } else if (!e.is_member) {
      aside = (
        <div className="well well--coral">
          <p>Em không có trong danh sách lớp {e.class_name}. Hãy nhập mã lớp ở trang của em hoặc hỏi giáo viên.</p>
          <Link to="/hs" className="btn">Về trang của em</Link>
        </div>
      )
    } else {
      aside = (
        <form className="stack-sm" onSubmit={submit}>
          <h2>Chào {user.profile.full_name}</h2>
          <div className="well well--mint"><p>Em có trong danh sách lớp {e.class_name}.</p></div>
          <p className="note">Giữ kết nối mạng khi làm bài. Bài được lưu tự động sau mỗi câu trả lời.</p>
          {startError}
          <button type="submit" className="btn btn--primary btn--lg" disabled={start.isPending}>Bắt đầu làm bài</button>
        </form>
      )
    }
  } else {
    aside = (
      <form className="stack-sm" onSubmit={submit}>
        <div className="field">
          <label htmlFor="ho-ten">Họ tên</label>
          <input id="ho-ten" className="input" value={name} onChange={(ev) => setTyped(ev.target.value)} required autoComplete="name" />
        </div>
        <p className="note">Giữ kết nối mạng khi làm bài. Bài được lưu tự động sau mỗi câu trả lời.</p>
        {startError}
        <button type="submit" className="btn btn--primary btn--lg" disabled={start.isPending}>Bắt đầu làm bài</button>
      </form>
    )
  }

  return (
    <>
      <TopBar />
      <div className="inkband">
        <div className="split" style={{ maxWidth: 'var(--page-narrow)', marginInline: 'auto' }}>
          <div className="main stack">
            {info.error && <p role="alert" className="error">{info.error.message}</p>}
            {e && (
              <>
                <h1>{e.title}</h1>
                <p className="sub">
                  {e.access === 'private' && e.class_name ? `Đề riêng của lớp ${e.class_name}, ${e.teacher_name}` : e.teacher_name}
                </p>
                <dl className="facts">
                  <dt>Môn</dt><dd>{e.subject || 'Chưa ghi'}</dd>
                  <dt>Số câu</dt><dd>{e.question_count}</dd>
                  <dt>Thời gian</dt><dd>{e.duration_min} phút, tính từ lúc bấm bắt đầu</dd>
                  <dt>Mở đề</dt>
                  <dd>
                    {e.opens_at || e.closes_at
                      ? [e.opens_at ? `Từ ${stamp(e.opens_at)}` : '', e.closes_at ? `đến ${stamp(e.closes_at)}` : ''].filter(Boolean).join(' ')
                      : 'Không giới hạn'}
                  </dd>
                  <dt>Số lần làm</dt><dd>{e.max_attempts}</dd>
                  <dt>Đã làm</dt><dd>{e.my_attempts} lần</dd>
                </dl>
              </>
            )}
          </div>
          <aside className="aside card stack" style={{ color: 'var(--color-ink)' }} aria-label="Vào phòng thi">
            {aside}
          </aside>
        </div>
      </div>
    </>
  )
}
