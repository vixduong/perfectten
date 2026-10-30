-- Sửa sau review: lộ đáp án khi đóng đề sớm, bài bỏ dở không được chấm, điểm lệch khi sửa câu hỏi.
-- Chỉ thay hàm/trigger/default; không đổi dữ liệu cũ. Rollback: chạy lại định nghĩa hàm trong 20261030000000_init.sql
-- và `drop trigger questions_regrade on public.questions; drop function public.regrade_on_question_change, public.grade_attempt;`

-- Mã lớp 8 ký tự (32 bit) thay vì 6, khó dò hơn. Lớp cũ giữ mã cũ.
alter table public.classes alter column code set default upper(substr(md5(gen_random_uuid()::text), 1, 8));

-- Chấm theo câu hỏi hiện có của đề; dùng chung cho nộp bài và chấm lại.
create function public.grade_attempt(p_attempt uuid) returns void
language sql security definer set search_path = '' as $$
  update public.attempts a set
    correct_count = g.c,
    total = g.t,
    score = case when g.t > 0 then round(10.0 * g.c / g.t, 2) end
  from (
    select count(*) filter (where (x.answers ->> q.id::text)::int = q.correct) as c, count(q.id) as t
    from public.attempts x left join public.questions q on q.id = any (x.question_order)
    where x.id = p_attempt
  ) g
  where a.id = p_attempt
$$;
revoke execute on function public.grade_attempt from public, anon, authenticated;

-- Giáo viên được chốt bài đã hết giờ mà học sinh chưa nộp (mất mạng, đóng trình duyệt).
create or replace function public.submit_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt for update;
  if a.id is null or not (
    a.user_id = auth.uid()
    or (public.owns_exam(a.exam_id) and now() > a.deadline + interval '30 seconds')
  ) then
    raise exception 'Không tìm thấy bài làm';
  end if;
  if a.submitted_at is not null then return; end if;
  update public.attempts set submitted_at = least(now(), a.deadline) where id = p_attempt;
  perform public.grade_attempt(p_attempt);
end $$;

-- Sửa đáp án, sửa phương án hoặc xóa câu sau khi đã có bài nộp: chấm lại cho khớp với trang kết quả.
create function public.regrade_on_question_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.grade_attempt(a.id) from public.attempts a
    where a.exam_id = coalesce(new.exam_id, old.exam_id) and a.submitted_at is not null;
  return null;
end $$;
create trigger questions_regrade after update of correct, options or delete on public.questions
  for each row execute function public.regrade_on_question_change();

-- Bài hết giờ chưa nộp vẫn trả về để học sinh vào lại, trang làm bài sẽ tự nộp.
create or replace function public.exam_info(p_exam uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', e.id, 'title', e.title, 'subject', e.subject, 'grade', e.grade,
    'access', e.access, 'status', e.status, 'duration_min', e.duration_min,
    'opens_at', e.opens_at, 'closes_at', e.closes_at, 'max_attempts', e.max_attempts,
    'teacher_name', p.full_name, 'class_name', c.name,
    'question_count', (select count(*) from public.questions q where q.exam_id = e.id),
    'is_member', e.class_id is not null and public.is_member(e.class_id),
    'my_attempts', (select count(*) from public.attempts a where a.exam_id = e.id and a.user_id = auth.uid()),
    'open_attempt', (select a.id from public.attempts a where a.exam_id = e.id and a.user_id = auth.uid()
                      and a.submitted_at is null order by a.started_at desc limit 1)
  )
  from public.exams e
  join public.profiles p on p.id = e.teacher_id
  left join public.classes c on c.id = e.class_id
  where e.id = p_exam and (e.status <> 'draft' or e.teacher_id = auth.uid())
$$;

-- Đáp án (và đúng/sai từng câu) chỉ hiện khi giáo viên cho phép, không còn ai đang làm đề, và:
-- đề đã đóng / đã qua hạn, hoặc đề không hạn mà em đã dùng hết số lần làm.
create or replace function public.attempt_review(p_attempt uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select a.*, e.title, e.subject, e.teacher_id,
      e.teacher_id = auth.uid() or (
        e.show_answers
        and not exists (select 1 from public.attempts x where x.exam_id = e.id
                        and x.submitted_at is null and x.deadline + interval '30 seconds' > now())
        and (
          e.status = 'closed' or e.closes_at <= now()
          or (e.closes_at is null and (select count(*) from public.attempts y
                                       where y.exam_id = e.id and y.user_id = a.user_id) >= e.max_attempts)
        )
      ) as reveal
    from public.attempts a join public.exams e on e.id = a.exam_id
    where a.id = p_attempt and a.submitted_at is not null
      and (a.user_id = auth.uid() or e.teacher_id = auth.uid())
  )
  select jsonb_build_object(
    'attempt', jsonb_build_object('id', b.id, 'exam_id', b.exam_id, 'display_name', b.display_name,
      'started_at', b.started_at, 'submitted_at', b.submitted_at,
      'correct_count', b.correct_count, 'total', b.total, 'score', b.score),
    'exam', jsonb_build_object('title', b.title, 'subject', b.subject),
    'reveal', b.reveal,
    'questions', (
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'body', q.body, 'options', to_jsonb(q.options),
        'chosen', (b.answers ->> q.id::text)::int,
        'is_correct', case when b.reveal then (b.answers ->> q.id::text)::int is not distinct from q.correct end,
        'correct', case when b.reveal then q.correct end
      ) order by ord.n)
      from unnest(b.question_order) with ordinality ord(qid, n)
      join public.questions q on q.id = ord.qid
    )
  ) from base b
$$;
