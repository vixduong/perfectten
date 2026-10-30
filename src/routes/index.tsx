import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { TopBar } from '../components/TopBar'
import { supabase, unwrap } from '../lib/supabase'
import type { PublicExam } from '../lib/types'

export const Route = createFileRoute('/')({ component: Home })

export const publicExamsQuery = {
  queryKey: ['public-exams'],
  queryFn: async () => unwrap(await supabase.rpc('public_exams')) as PublicExam[],
}

function Home() {
  const exams = useQuery(publicExamsQuery).data?.slice(0, 6) ?? []
  return (
    <>
      <TopBar />
      <main>
        <section className="hero" aria-labelledby="tieude">
          <div className="hero__text">
            <h1 id="tieude">Soạn đề nhẹ tay. Học vui hơn.</h1>
            <p className="lead">Giáo viên soạn đề, giao cho lớp. Học sinh làm bài và thấy mình tiến bộ.</p>
            <div className="row">
              <Link to="/dang-nhap" className="btn btn--primary btn--lg">Bắt đầu soạn đề</Link>
              <Link to="/kho-de" className="btn btn--lg">Vào kho đề</Link>
            </div>
          </div>
        </section>

        <div id="cach-dung" className="kraft-wrap">
          <section className="kraft" aria-labelledby="cd">
            <h2 id="cd">Từ câu hỏi đến kết quả, bốn bước</h2>
            <ol className="steps">
              <li className="step"><strong>Tạo lớp</strong><span>Thêm học sinh hoặc gửi mã lớp.</span></li>
              <li className="step"><strong>Soạn đề</strong><span>Câu trắc nghiệm, đánh dấu đáp án.</span></li>
              <li className="step"><strong>Gửi link cho lớp</strong><span>Đặt giờ mở đề và hạn nộp.</span></li>
              <li className="step"><strong>Xem thống kê</strong><span>Biết câu nào khó, em nào cần giúp.</span></li>
            </ol>
          </section>
        </div>

        {exams.length > 0 && (
          <section id="kho-de" className="sec" aria-labelledby="kd">
            <div className="sec-head">
              <h2 id="kd">Đề đang mở cho mọi người</h2>
              <Link to="/kho-de" className="btn">Xem cả kho đề</Link>
            </div>
            <ul className="grid-cards">
              {exams.map((e) => (
                <li key={e.id} className="card card--lift stack-sm">
                  <div className="row">
                    <span className="tile" data-subject={e.subject}>{e.subject || 'Đề thi'}</span>
                    {e.grade && <span className="note">Lớp {e.grade}</span>}
                  </div>
                  <h3 style={{ fontSize: 'var(--text-lg)' }}>{e.title}</h3>
                  <p className="sub grow">{e.teacher_name}</p>
                  <ul className="meta">
                    <li>{e.question_count} câu</li>
                    <li>{e.duration_min} phút</li>
                  </ul>
                  <Link to="/de/$examId" params={{ examId: e.id }} className="btn">Làm bài</Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="sec" aria-labelledby="bd">
          <h2 id="bd" style={{ marginBottom: 'var(--space-lg)' }}>Bạn muốn bắt đầu từ đâu?</h2>
          <div className="grid-3">
            <Link to="/dang-nhap" className="role-card role-card--pear">
              <span className="role-card__title">Tôi là giáo viên</span>
              <span>Tạo lớp và soạn đề đầu tiên.</span>
            </Link>
            <Link to="/kho-de" className="role-card">
              <span className="role-card__title">Tôi là học sinh</span>
              <span>Vào kho đề và làm thử một bài.</span>
            </Link>
          </div>
        </section>
      </main>
      <footer className="foot">
        <Link to="/" className="brand"><img src="/logo.svg" width={40} height={40} alt="" className="brand__mark" />Điểm Mười</Link>
        <nav aria-label="Liên kết cuối trang" className="row">
          <Link to="/kho-de" className="role-link">Kho đề</Link>
          <Link to="/dang-nhap" className="role-link">Đăng nhập</Link>
        </nav>
      </footer>
    </>
  )
}
