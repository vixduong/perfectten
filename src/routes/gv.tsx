import { Link, Outlet, createFileRoute, useLocation } from '@tanstack/react-router'
import { TEACHER_NAV, TopBar } from '../components/TopBar'
import { supabase, unwrap, useMe } from '../lib/supabase'
import type { Attempt, Exam, Klass, RosterRow } from '../lib/types'

export const Route = createFileRoute('/gv')({ component: TeacherLayout })

// RLS đã giới hạn mọi truy vấn dưới đây ở dữ liệu của giáo viên đang đăng nhập.
// Khóa bắt đầu bằng 'gv' để một lần invalidateQueries(['gv']) làm mới cả khu vực.
export const classesQuery = {
  queryKey: ['gv', 'classes'],
  queryFn: async () => unwrap(await supabase.from('classes').select('*').order('created_at')) as Klass[],
}
export const rosterQuery = {
  queryKey: ['gv', 'roster'],
  queryFn: async () => unwrap(await supabase.from('class_students').select('*').order('full_name')) as RosterRow[],
}
export const examsQuery = {
  queryKey: ['gv', 'exams'],
  queryFn: async () => unwrap(await supabase.from('exams').select('*').order('created_at', { ascending: false })) as Exam[],
}
export const attemptsQuery = {
  queryKey: ['gv', 'attempts'],
  queryFn: async () => unwrap(await supabase.from('attempts').select('*')) as Attempt[],
}

/** Đổi lỗi ràng buộc của Postgres sang tiếng Việt dễ hiểu. */
export function friendly(msg: string): string {
  if (/exams_private_class_check/.test(msg)) return 'Đề riêng tư cần chọn lớp trước khi xuất bản.'
  if (/exams_window_check/.test(msg)) return 'Giờ đóng đề phải sau giờ mở đề.'
  if (/duration_min/.test(msg)) return 'Thời gian làm bài phải từ 1 đến 600 phút.'
  if (/max_attempts/.test(msg)) return 'Số lần làm tối đa phải từ 1 đến 100.'
  if (/grade/.test(msg)) return 'Khối lớp phải từ 1 đến 12.'
  if (/exams_title_check/.test(msg)) return 'Tên đề không được để trống.'
  if (/questions_body_check/.test(msg)) return 'Nội dung câu hỏi không được để trống.'
  if (/questions_options_check/.test(msg)) return 'Mỗi câu cần từ 2 đến 6 phương án.'
  if (/questions_check/.test(msg)) return 'Đáp án đúng phải là một trong các phương án.'
  if (/classes_teacher_id_name_key/.test(msg)) return 'Tên lớp này đã có rồi.'
  if (/class_students_class_id_email_key/.test(msg)) return 'Email này đã có trong lớp.'
  if (/class_students_email_check/.test(msg)) return 'Email phải viết thường.'
  return msg
}

function TeacherLayout() {
  const me = useMe()
  const path = useLocation({ select: (l) => l.pathname })
  const ok = me.data && !me.data.anonymous && me.data.profile.role === 'teacher'

  if (ok) {
    return (
      <>
        <TopBar nav={TEACHER_NAV} label="Giáo viên" />
        <Outlet />
      </>
    )
  }
  return (
    <>
      <TopBar />
      <main className="page page--narrow">
        {me.isPending ? (
          <p className="note" role="status">Đang tải…</p>
        ) : me.data && !me.data.anonymous ? (
          <section className="card stack" style={{ maxWidth: 480, marginInline: 'auto' }}>
            <h1>Trang này dành cho giáo viên</h1>
            <p className="sub">Tài khoản của bạn là tài khoản học sinh.</p>
            <Link to="/hs" className="btn btn--primary">Về trang của em</Link>
          </section>
        ) : (
          <section className="card stack" style={{ maxWidth: 480, marginInline: 'auto' }}>
            <h1>Đăng nhập để tiếp tục</h1>
            <p className="sub">Khu vực giáo viên cần tài khoản giáo viên.</p>
            <Link to="/dang-nhap" search={{ next: path }} className="btn btn--primary">Đăng nhập</Link>
          </section>
        )}
      </main>
    </>
  )
}
