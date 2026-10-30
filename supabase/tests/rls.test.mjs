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
  insert into public.teacher_allowlist values ('co.ha@truong.vn'), ('x@truong.vn'), ('@gv.edu.vn');
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

// Danh sách giáo viên: email lạ xin vai trò teacher vẫn là học sinh; khớp đúng email hoặc tên miền thì là giáo viên.
await db.exec(`
  insert into auth.users (id, email, raw_user_meta_data) values
    ('00000000-0000-0000-0000-0000000000e1', 'la@gmail.com', '{"role":"teacher"}'),
    ('00000000-0000-0000-0000-0000000000e2', 'Thay.Nam@GV.edu.vn', '{"role":"teacher"}'),
    ('00000000-0000-0000-0000-0000000000e3', 'sv@xgv.edu.vn', '{"role":"teacher"}'),
    ('00000000-0000-0000-0000-0000000000e4', 'Co.Ha@truong.vn', '{"role":"student"}');
`)
assert.deepEqual((await db.query(`select role from profiles where id::text like '%e_' order by id`)).rows.map((r) => r.role),
  ['student', 'teacher', 'student', 'student'])
await rejects(asT(`select * from teacher_allowlist`), /permission denied/)
await rejects(asT(`insert into teacher_allowlist values ('a@b.c')`), /permission denied/)
await rejects(as(null, `select * from teacher_allowlist`), /permission denied/)

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
// Khóa số phương án: chưa ai trả lời câu 3 thì thêm/bớt được; câu 1 đã có bài trả lời thì không (sửa chữ, đổi đáp án vẫn được).
await asT(`update questions set options = '{Đúng,Sai,Khác}' where id = $1`, [qs[2].id])
await asT(`update questions set options = '{Đúng,Sai}' where id = $1`, [qs[2].id])
await rejects(asT(`update questions set options = '{A,B,C}', correct = 0 where id = $1`, [qs[0].id]), /đã có học sinh trả lời/)
await rejects(asT(`update questions set options = '{A,B,C,D,E}' where id = $1`, [qs[0].id]), /đã có học sinh trả lời/)
await asT(`update questions set options = '{A1,B,C,D}', correct = 0 where id = $1`, [qs[0].id])
await asT(`update questions set correct = 0 where id = $1`, [qs[0].id])

// Bỏ chọn: câu đã chọn rồi xóa thì không còn trong answers, chấm là chưa trả lời; chọn lại được.
await asS(`select save_answer($1, $2, 0)`, [attemptId, qs[2].id])
await asS(`select save_answer($1, $2, null)`, [attemptId, qs[2].id])
assert.deepEqual(Object.keys((await asS(`select answers from attempts where id = $1`, [attemptId]))[0].answers).sort(), [qs[0].id, qs[1].id].sort())
await asS(`select save_answer($1, $2, null)`, [attemptId, qs[0].id])
await asS(`select save_answer($1, $2, 0)`, [attemptId, qs[0].id])
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

// Hỏi giáo viên: chỉ chủ bài (tài khoản thật) hỏi được, câu phải thuộc bài; chỉ giáo viên của đề đọc/trả lời.
const [inq] = await asS(`select ask_teacher($1, $2, '  Vì sao đáp án câu 2 là B?  ') as id`, [attemptId, qs[1].id])
const mine = (await asS(`select * from inquiries`))[0]
assert.deepEqual([mine.body, mine.reply, mine.exam_id, mine.student_id], ['Vì sao đáp án câu 2 là B?', null, exam.id, S])
await rejects(asX(`select ask_teacher($1, $2, 'hi')`, [attemptId, qs[1].id]), /Không tìm thấy bài làm/)
await rejects(asT(`select ask_teacher($1, $2, 'hi')`, [attemptId, qs[1].id]), /Không tìm thấy bài làm/)
await rejects(asA(`select ask_teacher($1, $2, 'hi')`, [attemptId, qs[1].id]), /Cần đăng nhập/)
await rejects(as(null, `select ask_teacher($1, $2, 'hi')`, [attemptId, qs[1].id]), /permission denied/)
await rejects(asS(`select ask_teacher($1, $2, 'hi')`, [attemptId, '00000000-0000-0000-0000-000000000099']), /không thuộc bài làm/)
await rejects(asS(`select ask_teacher($1, null, 'hi')`, [attemptId]), /không thuộc bài làm/)
await rejects(asS(`select ask_teacher($1, $2, '   ')`, [attemptId, qs[1].id]), /từ 1 đến 2000/)
await rejects(asS(`select ask_teacher($1, $2, $3)`, [attemptId, qs[1].id, 'x'.repeat(2001)]), /từ 1 đến 2000/)
// Chưa ai ngoài chủ bài và giáo viên của đề đọc được; học sinh không ghi thẳng vào bảng.
assert.equal((await asX(`select * from inquiries`)).length, 0)
assert.equal((await asA(`select * from inquiries`)).length, 0)
await rejects(as(null, `select * from inquiries`), /permission denied/)
assert.equal((await asT(`select * from inquiries`)).length, 1)
await rejects(asS(`insert into inquiries (attempt_id, exam_id, body) values ($1, $2, 'x')`, [attemptId, exam.id]), /permission denied/)
await rejects(asS(`update inquiries set reply = 'tự trả lời'`), /permission denied/)
await rejects(asS(`delete from inquiries`), /permission denied/)
await rejects(asT(`update inquiries set reply = 'sửa thẳng'`), /permission denied/)
// Trả lời: chỉ giáo viên của đề; học sinh và giáo viên khác không trả lời được; trả lời lại thì ghi đè.
await rejects(asS(`select reply_inquiry($1, 'tự trả lời')`, [inq.id]), /Không tìm thấy câu hỏi/)
await rejects(asX(`select reply_inquiry($1, 'tôi là gv khác')`, [inq.id]), /Không tìm thấy câu hỏi/)
await rejects(asT(`select reply_inquiry($1, '  ')`, [inq.id]), /từ 1 đến 2000/)
await asT(`select reply_inquiry($1, 'Vì B là đáp án đúng theo bài giảng.')`, [inq.id])
await asT(`select reply_inquiry($1, 'Em xem lại bài 5 nhé.')`, [inq.id])
const answered = (await asS(`select reply, replied_at from inquiries where id = $1`, [inq.id]))[0]
assert.equal(answered.reply, 'Em xem lại bài 5 nhé.'); assert.notEqual(answered.replied_at, null)
// Đề chưa đóng thì hỏi cũng không lộ đáp án: bảng chỉ có nội dung câu hỏi và câu trả lời.
assert.ok(!JSON.stringify(await asS(`select * from inquiries`)).includes('correct'))

// Đề công khai: khách ẩn danh làm được với họ tên; người chưa đăng nhập thấy trong kho đề.
await asT(`update exams set access = 'public', max_attempts = 2 where id = $1`, [exam.id])
assert.equal((await as(null, `select public_exams() as l`))[0].l.length, 1)
await rejects(asA(`select start_attempt($1, '  ')`, [exam.id]), /họ tên/)
const anonAttempt = (await asA(`select start_attempt($1, 'Khách A') as id`, [exam.id]))[0].id
assert.equal((await asA(`select attempt_questions($1) as p`, [anonAttempt]))[0].p.attempt.display_name, 'Khách A')
// Khách chọn đúng câu 1 rồi bỏ chọn: khi chấm vẫn là chưa trả lời (điểm 0).
await asA(`select save_answer($1, $2, 0)`, [anonAttempt, qs[0].id])
await asA(`select save_answer($1, $2, null)`, [anonAttempt, qs[0].id])
assert.deepEqual((await asA(`select answers from attempts where id = $1`, [anonAttempt]))[0].answers, {})

// Bài chưa nộp thì chưa hỏi được (tài khoản thật làm đề công khai); xong dọn bài dở để không ảnh hưởng phần dưới.
const xAttempt = (await asX(`select start_attempt($1, 'Người lạ') as id`, [exam.id]))[0].id
await rejects(asX(`select ask_teacher($1, $2, 'hi')`, [xAttempt, qs[0].id]), /nộp bài trước/)
await db.exec(`delete from attempts where id = '${xAttempt}'`)

// Giáo viên đóng đề sớm khi còn người đang làm: chưa hiện đáp án, cả đúng/sai từng câu.
await asT(`update exams set show_answers = true, status = 'closed' where id = $1`, [exam.id])
review = (await asS(`select attempt_review($1) as r`, [attemptId]))[0].r
assert.equal(review.reveal, false, 'someone still in progress')
assert.equal(review.questions[0].is_correct, null)

// Bài bỏ dở: giáo viên chỉ chốt được sau khi hết giờ; xong thì đáp án hiện.
await rejects(asT(`select submit_attempt($1)`, [anonAttempt]), /Không tìm thấy/)
await db.exec(`update attempts set deadline = now() - interval '1 minute' where id = '${anonAttempt}'`)
await asT(`select submit_attempt($1)`, [anonAttempt])
assert.notEqual((await asT(`select score from attempts where id = $1`, [anonAttempt]))[0].score, null)
assert.equal((await asS(`select attempt_review($1) as r`, [attemptId]))[0].r.reveal, true)

// Sửa đáp án hoặc xóa câu sau khi đã nộp: điểm được chấm lại.
await asT(`update questions set correct = 3 where id = $1`, [qs[1].id])
let [regraded] = await asS(`select correct_count, total, score from attempts where id = $1`, [attemptId])
assert.deepEqual([regraded.correct_count, regraded.total, Number(regraded.score)], [2, 3, 6.67])
await asT(`delete from questions where id = $1`, [qs[2].id])
;[regraded] = await asS(`select correct_count, total, score from attempts where id = $1`, [attemptId])
assert.deepEqual([regraded.correct_count, regraded.total, Number(regraded.score)], [2, 2, 10])

// Đánh giá đề: phải nộp bài mới chấm được, chấm lại thì ghi đè; trung bình hiện trong kho đề.
await rejects(asX(`select rate_exam($1, 5)`, [exam.id]), /nộp bài trước/)
await rejects(asS(`select rate_exam($1, 6)`, [exam.id]), /1 đến 5/)
await asS(`select rate_exam($1, 2)`, [exam.id])
await asS(`select rate_exam($1, 5)`, [exam.id])
await asA(`select rate_exam($1, 4)`, [exam.id])
assert.equal((await asS(`select * from exam_ratings`)).length, 1, 'student sees only own rating')
assert.equal((await asT(`select * from exam_ratings`)).length, 2)
await asT(`update exams set status = 'open' where id = $1`, [exam.id])
const listed = (await as(null, `select public_exams() as l`))[0].l[0]
assert.deepEqual([Number(listed.rating), listed.rating_count], [4.5, 2])

// Bảng xếp hạng: lượt tốt nhất mỗi người, người ngoài không xem được, giáo viên tắt thì ẩn.
let board = (await asS(`select leaderboard($1) as b`, [exam.id]))[0].b
assert.deepEqual(board.rows.map((r) => [r.rank, r.name, Number(r.score), r.me]), [[1, 'Trần Minh Anh', 10, true], [2, 'Khách A', 0, false]])
assert.equal((await asX(`select leaderboard($1) as b`, [exam.id]))[0].b, null)
assert.equal((await asA(`select leaderboard_exams() as l`))[0].l.length, 1)
const quality = (await as(null, `select exam_quality() as q`))[0].q[0]
assert.deepEqual([quality.attempts, Number(quality.avg_score), quality.discrimination], [2, 5, null])
await asT(`update exams set leaderboard = false where id = $1`, [exam.id])
assert.equal((await asS(`select leaderboard($1) as b`, [exam.id]))[0].b, null)
await asT(`update exams set leaderboard = true where id = $1`, [exam.id])

// Vào lớp bằng mã: tài khoản thật được, ẩn danh thì không.
await asX(`select join_class($1)`, [cls.code.toLowerCase()])
assert.equal((await asX(`select * from classes`)).length, 1)
await rejects(asA(`select join_class($1)`, [cls.code]), /Cần đăng nhập/)

// Hạn nộp phải sau giờ mở; đề riêng tư phải gắn lớp khi xuất bản.
await rejects(asT(`update exams set opens_at = now(), closes_at = now() - interval '1 hour' where id = $1`, [exam.id]), /check/)
await rejects(asT(`insert into exams (title, access, status) values ('x', 'private', 'open')`), /check/)

console.log('ok: all database checks passed')
