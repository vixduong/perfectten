// Luồng đầy đủ qua Supabase local thật (Auth + PostgREST): pnpm supabase start && pnpm test:e2e
import { createClient } from '@supabase/supabase-js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const env = Object.fromEntries(
  readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => l.split('=')),
)
const client = () => createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
const ok = (r) => {
  if (r.error) throw new Error(r.error.message)
  return r.data
}
const run = Date.now()
const mail = (n) => `${n}.${run}@truong.edu.vn`

const teacher = client()
ok(await teacher.auth.signUp({ email: mail('co'), password: 'matkhau1', options: { data: { full_name: 'Cô Hà', role: 'teacher' } } }))
const cls = ok(await teacher.from('classes').insert({ name: '11A2', subject: 'Sinh học 11' }).select().single())
ok(await teacher.from('class_students').insert({ class_id: cls.id, full_name: 'Trần Minh Anh', email: mail('em') }))
const exam = ok(await teacher.from('exams').insert({ title: 'Quang hợp', class_id: cls.id, max_attempts: 1 }).select().single())
const qs = ok(await teacher.from('questions').insert([
  { exam_id: exam.id, position: 1, body: 'Pha sáng ở đâu?', options: ['Tilacoit', 'Strôma'], correct: 0 },
  { exam_id: exam.id, position: 2, body: 'O₂ từ đâu?', options: ['CO₂', 'Nước', 'Glucôzơ'], correct: 1 },
]).select())
ok(await teacher.from('exams').update({ status: 'open' }).eq('id', exam.id))

// Học sinh đăng ký bằng đúng email trong danh sách lớp → tự được nhận vào lớp.
const student = client()
ok(await student.auth.signUp({ email: mail('em'), password: 'matkhau1', options: { data: { full_name: 'Minh Anh', role: 'student' } } }))
const info = ok(await student.rpc('exam_info', { p_exam: exam.id }))
assert.equal(info.is_member, true)
assert.equal(info.question_count, 2)
assert.equal((ok(await student.from('questions').select())).length, 0, 'student cannot read answer keys')

const attempt = ok(await student.rpc('start_attempt', { p_exam: exam.id }))
const paper = ok(await student.rpc('attempt_questions', { p_attempt: attempt }))
assert.ok(!JSON.stringify(paper).includes('"correct"'))
const byBody = Object.fromEntries(paper.questions.map((q) => [q.body, q]))
ok(await student.rpc('save_answer', { p_attempt: attempt, p_question: byBody['Pha sáng ở đâu?'].id, p_choice: 0 }))
ok(await student.rpc('save_answer', { p_attempt: attempt, p_question: byBody['O₂ từ đâu?'].id, p_choice: 2 }))
ok(await student.rpc('submit_attempt', { p_attempt: attempt }))
const review = ok(await student.rpc('attempt_review', { p_attempt: attempt }))
assert.equal(review.attempt.correct_count, 1)
assert.equal(Number(review.attempt.score), 5)
assert.equal(review.reveal, true)

// Hỏi giáo viên và nhận trả lời.
const qid = byBody['O₂ từ đâu?'].id
const asked = ok(await student.rpc('ask_teacher', { p_attempt: attempt, p_question: qid, p_body: 'Vì sao không phải glucôzơ?' }))
assert.match((await student.from('inquiries').insert({ attempt_id: attempt, exam_id: exam.id, body: 'x' })).error?.message ?? '', /permission denied/)
assert.equal(ok(await teacher.from('inquiries').select().is('reply', null)).length, 1)
ok(await teacher.rpc('reply_inquiry', { p_inquiry: asked, p_body: 'O₂ sinh ra từ quang phân li nước.' }))
const thread = ok(await student.from('inquiries').select().eq('attempt_id', attempt))
assert.deepEqual(thread.map((t) => [t.question_id, t.reply]), [[qid, 'O₂ sinh ra từ quang phân li nước.']])
assert.notEqual(thread[0].replied_at, null)

// Người ngoài lớp: không vào được đề riêng tư.
const outsider = client()
ok(await outsider.auth.signUp({ email: mail('la'), password: 'matkhau1', options: { data: { full_name: 'Người lạ' } } }))
assert.match((await outsider.rpc('start_attempt', { p_exam: exam.id })).error?.message ?? '', /không có trong danh sách/)
assert.equal(ok(await outsider.from('exams').select()).filter((e) => e.id === exam.id).length, 0)
assert.equal(ok(await outsider.from('inquiries').select()).length, 0)

// Khách ẩn danh làm đề công khai.
ok(await teacher.from('exams').update({ access: 'public' }).eq('id', exam.id))
const guest = client()
ok(await guest.auth.signInAnonymously({ options: { data: { full_name: 'Khách' } } }))
const pub = ok(await guest.rpc('public_exams'))
assert.ok(pub.some((e) => e.id === exam.id))
const ga = ok(await guest.rpc('start_attempt', { p_exam: exam.id, p_name: 'Khách A' }))
ok(await guest.rpc('submit_attempt', { p_attempt: ga }))
assert.equal(Number(ok(await guest.rpc('attempt_review', { p_attempt: ga })).attempt.score), 0)
assert.match((await guest.rpc('ask_teacher', { p_attempt: ga, p_question: qid, p_body: 'hi' })).error?.message ?? '', /Cần đăng nhập/)
assert.match((await guest.rpc('join_class', { p_code: cls.code })).error?.message ?? '', /Cần đăng nhập/)

// Giáo viên thấy cả hai bài nộp.
const rows = ok(await teacher.from('attempts').select().eq('exam_id', exam.id))
assert.equal(rows.length, 2)
assert.ok(qs.length === 2)

// Đánh giá và bảng xếp hạng.
ok(await student.rpc('rate_exam', { p_exam: exam.id, p_rating: 4 }))
ok(await guest.rpc('rate_exam', { p_exam: exam.id, p_rating: 5 }))
assert.equal(Number(ok(await client().rpc('public_exams')).find((e) => e.id === exam.id).rating), 4.5)
const board = ok(await student.rpc('leaderboard', { p_exam: exam.id }))
assert.deepEqual(board.rows.map((r) => [r.rank, r.name, r.me]), [[1, 'Trần Minh Anh', true], [2, 'Khách A', false]])
assert.equal(ok(await outsider.rpc('leaderboard', { p_exam: exam.id })), null)
assert.ok(ok(await client().rpc('exam_quality')).some((e) => e.id === exam.id))
console.log('ok: e2e flow passed against local Supabase')
