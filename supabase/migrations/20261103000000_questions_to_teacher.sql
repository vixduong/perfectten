-- #9 Học sinh hỏi giáo viên về một câu của bài đã nộp; giáo viên của đề trả lời.
-- Chỉ ghi qua RPC; bảng không chứa đáp án. Rollback: drop function ask_teacher, reply_inquiry; drop table inquiries.

create table public.inquiries (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts on delete cascade,
  question_id uuid references public.questions on delete set null,
  exam_id uuid not null references public.exams on delete cascade,
  student_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (length(trim(body)) between 1 and 2000),
  reply text check (reply is null or length(trim(reply)) between 1 and 2000),
  replied_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.inquiries (attempt_id);
create index on public.inquiries (exam_id, created_at desc);

alter table public.inquiries enable row level security;
revoke all on public.inquiries from anon, authenticated;
grant select on public.inquiries to authenticated;
create policy "inquiries read" on public.inquiries for select
  using (student_id = auth.uid() or public.owns_exam(exam_id));

-- Chủ bài làm (tài khoản thật), bài đã nộp, câu thuộc bài đó.
create function public.ask_teacher(p_attempt uuid, p_question uuid, p_body text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  a public.attempts;
  v_body text := trim(coalesce(p_body, ''));
  v_id uuid;
begin
  if auth.uid() is null or public.is_anonymous() then
    raise exception 'Cần đăng nhập bằng tài khoản để hỏi giáo viên';
  end if;
  select * into a from public.attempts where id = p_attempt and user_id = auth.uid();
  if a.id is null then raise exception 'Không tìm thấy bài làm'; end if;
  if a.submitted_at is null then raise exception 'Em cần nộp bài trước khi hỏi giáo viên'; end if;
  if p_question is null or not (p_question = any (a.question_order))
     or not exists (select 1 from public.questions where id = p_question) then
    raise exception 'Câu hỏi không thuộc bài làm';
  end if;
  if length(v_body) not between 1 and 2000 then raise exception 'Câu hỏi phải từ 1 đến 2000 ký tự'; end if;

  insert into public.inquiries (attempt_id, question_id, exam_id, student_id, body)
  values (a.id, p_question, a.exam_id, auth.uid(), v_body)
  returning id into v_id;
  return v_id;
end $$;

-- Giáo viên của đề trả lời; trả lời lại thì ghi đè.
create function public.reply_inquiry(p_inquiry uuid, p_body text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_body text := trim(coalesce(p_body, ''));
  v_exam uuid;
begin
  select exam_id into v_exam from public.inquiries where id = p_inquiry;
  if v_exam is null or not public.owns_exam(v_exam) then raise exception 'Không tìm thấy câu hỏi'; end if;
  if length(v_body) not between 1 and 2000 then raise exception 'Câu trả lời phải từ 1 đến 2000 ký tự'; end if;
  update public.inquiries set reply = v_body, replied_at = now() where id = p_inquiry;
end $$;

revoke execute on function public.ask_teacher, public.reply_inquiry from public, anon;
grant execute on function public.ask_teacher, public.reply_inquiry to authenticated;
