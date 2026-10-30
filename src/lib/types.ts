// Khớp với supabase/migrations. Khi có Supabase local: `pnpm db:types` để sinh kiểu đầy đủ.

export type Role = 'teacher' | 'student'
export type Access = 'private' | 'link' | 'public'
export type ExamStatus = 'draft' | 'open' | 'closed'

export type Profile = { id: string; full_name: string; role: Role }

export type Klass = {
  id: string
  teacher_id: string
  name: string
  subject: string
  school_year: string
  code: string
  created_at: string
}

export type RosterRow = {
  id: string
  class_id: string
  full_name: string
  email: string | null
  user_id: string | null
  created_at: string
}

export type Exam = {
  id: string
  teacher_id: string
  class_id: string | null
  title: string
  subject: string
  grade: number | null
  access: Access
  status: ExamStatus
  duration_min: number
  opens_at: string | null
  closes_at: string | null
  max_attempts: number
  shuffle_questions: boolean
  shuffle_options: boolean
  show_answers: boolean
  created_at: string
}

export type Question = {
  id: string
  exam_id: string
  position: number
  body: string
  options: string[]
  correct: number
  level: string
}

export type Attempt = {
  id: string
  exam_id: string
  user_id: string
  display_name: string
  answers: Record<string, number>
  started_at: string
  deadline: string
  submitted_at: string | null
  correct_count: number | null
  total: number | null
  score: number | null
}

/** exam_info(): thông tin trước khi vào thi. */
export type ExamInfo = {
  id: string
  title: string
  subject: string
  grade: number | null
  access: Access
  status: ExamStatus
  duration_min: number
  opens_at: string | null
  closes_at: string | null
  max_attempts: number
  teacher_name: string
  class_name: string | null
  question_count: number
  is_member: boolean
  my_attempts: number
  open_attempt: string | null
}

/** public_exams(): một dòng trong kho đề. */
export type PublicExam = {
  id: string
  title: string
  subject: string
  grade: number | null
  duration_min: number
  teacher_name: string
  question_count: number
  attempt_count: number
}

/** attempt_questions(): đề cho một lượt làm, không có đáp án. `i` là chỉ số gốc của phương án. */
export type Paper = {
  attempt: {
    id: string
    exam_id: string
    display_name: string
    deadline: string
    submitted_at: string | null
    answers: Record<string, number>
    now: string
  }
  exam: { title: string; subject: string }
  questions: { id: string; body: string; options: { i: number; t: string }[] }[]
}

/** attempt_review(): kết quả sau khi nộp. `correct` là null khi giáo viên chưa cho xem đáp án. */
export type Review = {
  attempt: {
    id: string
    exam_id: string
    display_name: string
    started_at: string
    submitted_at: string
    correct_count: number
    total: number
    score: number
  }
  exam: { title: string; subject: string }
  reveal: boolean
  questions: { id: string; body: string; options: string[]; chosen: number | null; is_correct: boolean; correct: number | null }[]
}
