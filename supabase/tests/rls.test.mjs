// Chạy migration trên PGlite với schema auth giả lập, kiểm tra quyền và chấm điểm.
// node supabase/tests/rls.test.mjs  (cần: pnpm add -D @electric-sql/pglite)
import { PGlite } from '@electric-sql/pglite'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'

const dir = new URL('../migrations/', import.meta.url)
const db = new PGlite()

await db.exec(`
  create role anon nologin; create role authenticated nologin;
  create schema auth;
  grant usage on schema auth, public to anon, authenticated;
  create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}', is_anonymous boolean default false);
  create function auth.jwt() returns jsonb language sql stable as $$ select nullif(current_setting('request.jwt.claims', true), '')::jsonb $$;
  create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt() ->> 'sub')::uuid $$;
  grant execute on all functions in schema auth to anon, authenticated;
`)
for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(new URL(f, dir), 'utf8'))

const T = '00000000-0000-0000-0000-00000000000a' // giáo viên
const S = '00000000-0000-0000-0000-00000000000b' // học sinh trong lớp
const X = '00000000-0000-0000-0000-00000000000c' // người ngoài
const A = '00000000-0000-0000-0000-00000000000d' // khách ẩn danh
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('${T}', 'co.ha@truong.vn', '{"role":"teacher","full_name":"Nguyễn Thu Hà"}'),
    ('${S}', 'minh.anh@truong.vn', '{"role":"student","full_name":"Trần Minh Anh"}'),
    ('${X}', 'x@truong.vn', '{"role":"teacher","full_name":"Kẻ lạ"}');
  insert into auth.users (id, is_anonymous) values ('${A}', true);
  update public.profiles set role = 'student' where id = '${X}';
`)

async function as(uid, sql, params = [], { anonymous = false, email } = {}) {
  const claims = uid ? JSON.stringify({ sub: uid, email, is_anonymous: anonymous, role: 'authenticated' }) : ''
  await db.exec(`reset role; select set_config('request.jwt.claims', '${claims}', false); set role ${uid ? 'authenticated' : 'anon'};`)
  try { return (await db.query(sql, params)).rows } finally { await db.exec('reset role') }
}
const asT = (s, p) => as(T, s, p, { email: 'co.ha@truong.vn' })
const asS = (s, p) => as(S, s, p, { email: 'minh.anh@truong.vn' })
const asX = (s, p) => as(X, s, p, { email: 'x@truong.vn' })
const asA = (s, p) => as(A, s, p, { anonymous: true })
const rejects = (p, re) => assert.rejects(p, re)

// Vai trò: chỉ người đăng ký "teacher" mới là giáo viên; không tự nâng quyền được.
assert.equal((await asT(`select role from profiles where id = auth.uid()`))[0].role, 'teacher')
await rejects(asX(`update profiles set role = 'teacher' where id = auth.uid()`), /permission denied/)
await rejects(asX(`insert into classes (name) values ('lớp giả')`), /row-level security/)

// Giáo viên tạo lớp, thêm học sinh theo email, tạo đề riêng tư.
const [cls] = await asT(`insert into classes (name, subject) values ('11A2', 'Sinh học 11') returning id, code`)
await asT(`insert into class_students (class_id, full_name, email) values ($1, 'Trần Minh Anh', 'minh.anh@truong.vn')`, [cls.id])
const [exam] = await asT(`insert into exams (title, class_id, duration_min, max_attempts, shuffle_questions) values ('Quang hợp', $1, 30, 1, false) returning id`, [cls.id])
const qs = await asT(`insert into questions (exam_id, position, body, options, correct) values
  ($1, 1, 'Câu 1', '{A,B,C,D}', 0), ($1, 2, 'Câu 2', '{A,B,C,D}', 1), ($1, 3, 'Câu 3', '{Đúng,Sai}', 1) returning id`, [exam.id])

// Đề nháp: chưa ai làm được, chưa ai thấy.
await rejects(asS(`select start_attempt($1)`, [exam.id]), /Đề chưa mở/)
assert.equal((await asS(`select exam_info($1) as i`, [exam.id]))[0].i, null)
await asT(`update exams set status = 'open' where id = $1`, [exam.id])

// Không ai ngoài giáo viên đọc được bảng câu hỏi (nơi có đáp án).
assert.equal((await asS(`select * from questions`)).length, 0)
await rejects(as(null, `select * from questions`), /permission denied/)

// Người ngoài lớp và khách ẩn danh không vào được đề riêng tư.
await rejects(asX(`select start_attempt($1)`, [exam.id]), /không có trong danh sách/)
await rejects(asA(`select start_attempt($1, 'Khách')`, [exam.id]), /không có trong danh sách/)
assert.equal((await asX(`select * from exams`)).length, 0)

// Học sinh trong danh sách (khớp email) thấy đề, làm bài.
assert.equal((await asS(`select * from exams`)).length, 1)
const info = (await asS(`select exam_info($1) as i`, [exam.id]))[0].i
assert.equal(info.is_member, true); assert.equal(info.question_count, 3)
const attemptId = (await asS(`select start_attempt($1) as id`, [exam.id]))[0].id
assert.equal((await asS(`select start_attempt($1) as id`, [exam.id]))[0].id, attemptId, 'resume same attempt')
const paper = (await asS(`select attempt_questions($1) as p`, [attemptId]))[0].p
assert.equal(paper.questions.length, 3)
assert.ok(!JSON.stringify(paper).includes('correct'), 'no answer key in paper')
assert.equal(paper.attempt.display_name, 'Trần Minh Anh')
assert.equal((await asT(`select user_id from class_students where class_id = $1`, [cls.id]))[0].user_id, S, 'roster linked by email')
assert.equal((await asX(`select attempt_questions($1) as p`, [attemptId]))[0].p, null)

await asS(`select save_answer($1, $2, 0)`, [attemptId, qs[0].id]) // đúng
await asS(`select save_answer($1, $2, 3)`, [attemptId, qs[1].id]) // sai
await rejects(asS(`select save_answer($1, $2, 5)`, [attemptId, qs[2].id]), /không hợp lệ/)
await rejects(asX(`select save_answer($1, $2, 0)`, [attemptId, qs[0].id]), /Không tìm thấy/)
await rejects(asS(`update attempts set score = 10`), /permission denied/)

await asS(`select submit_attempt($1)`, [attemptId])
const [graded] = await asS(`select correct_count, total, score from attempts where id = $1`, [attemptId])
assert.deepEqual([graded.correct_count, graded.total, Number(graded.score)], [1, 3, 3.33])
await rejects(asS(`select save_answer($1, $2, 1)`, [attemptId, qs[2].id]), /Bài đã nộp/)
await rejects(asS(`select start_attempt($1)`, [exam.id]), /hết số lần/)

// Kết quả: không có hạn nộp => hiện đáp án; giáo viên tắt show_answers => ẩn.
let review = (await asS(`select attempt_review($1) as r`, [attemptId]))[0].r
assert.equal(review.reveal, true); assert.equal(review.questions[1].correct, 1); assert.equal(review.questions[1].chosen, 3)
await asT(`update exams set show_answers = false where id = $1`, [exam.id])
review = (await asS(`select attempt_review($1) as r`, [attemptId]))[0].r
assert.equal(review.reveal, false); assert.equal(review.questions[1].correct, null)
assert.equal((await asX(`select attempt_review($1) as r`, [attemptId]))[0].r, null)

// Giáo viên thấy bài làm của lớp; người khác thì không.
assert.equal((await asT(`select * from attempts`)).length, 1)
assert.equal((await asX(`select * from attempts`)).length, 0)

// Đề công khai: khách ẩn danh làm được với họ tên; người chưa đăng nhập thấy trong kho đề.
await asT(`update exams set access = 'public', max_attempts = 2 where id = $1`, [exam.id])
assert.equal((await as(null, `select public_exams() as l`))[0].l.length, 1)
await rejects(asA(`select start_attempt($1, '  ')`, [exam.id]), /họ tên/)
const anonAttempt = (await asA(`select start_attempt($1, 'Khách A') as id`, [exam.id]))[0].id
assert.equal((await asA(`select attempt_questions($1) as p`, [anonAttempt]))[0].p.attempt.display_name, 'Khách A')

// Vào lớp bằng mã: tài khoản thật được, ẩn danh thì không.
await asX(`select join_class($1)`, [cls.code.toLowerCase()])
assert.equal((await asX(`select * from classes`)).length, 1)
await rejects(asA(`select join_class($1)`, [cls.code]), /Cần đăng nhập/)

// Hạn nộp phải sau giờ mở; đề riêng tư phải gắn lớp khi xuất bản.
await rejects(asT(`update exams set opens_at = now(), closes_at = now() - interval '1 hour' where id = $1`, [exam.id]), /check/)
await rejects(asT(`insert into exams (title, access, status) values ('x', 'private', 'open')`), /check/)

console.log('ok: all database checks passed')
