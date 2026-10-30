-- Điểm Mười: lớp, học sinh, đề thi, bài làm.
-- Đáp án (questions.correct) không bao giờ đọc trực tiếp được bởi người làm bài:
-- họ chỉ lấy câu hỏi qua attempt_questions() và kết quả qua attempt_review().

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role text not null default 'student' check (role in ('teacher', 'student')),
  created_at timestamptz not null default now()
);

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'teacher' and not coalesce(new.is_anonymous, false)
      then 'teacher' else 'student' end
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles on delete cascade,
  name text not null check (length(trim(name)) > 0),
  subject text not null default '',
  school_year text not null default '',
  code text not null unique default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at timestamptz not null default now(),
  unique (teacher_id, name)
);

-- Danh sách lớp: giáo viên thêm theo tên/email, hoặc học sinh tự vào bằng mã lớp.
create table public.class_students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes on delete cascade,
  full_name text not null check (length(trim(full_name)) > 0),
  email text check (email = lower(email)),
  user_id uuid references auth.users on delete set null,
  created_at timestamptz not null default now(),
  unique (class_id, email),
  unique (class_id, user_id)
);

create table public.exams (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null default auth.uid() references public.profiles on delete cascade,
  class_id uuid references public.classes on delete set null,
  title text not null check (length(trim(title)) > 0),
  subject text not null default '',
  grade smallint check (grade between 1 and 12),
  access text not null default 'private' check (access in ('private', 'link', 'public')),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  duration_min int not null default 30 check (duration_min between 1 and 600),
  opens_at timestamptz,
  closes_at timestamptz,
  max_attempts int not null default 1 check (max_attempts between 1 and 100),
  shuffle_questions boolean not null default true,
  shuffle_options boolean not null default true,
  show_answers boolean not null default true,
  created_at timestamptz not null default now(),
  constraint exams_window_check check (opens_at is null or closes_at is null or closes_at > opens_at),
  constraint exams_private_class_check check (status = 'draft' or access <> 'private' or class_id is not null)
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams on delete cascade,
  position int not null default 0,
  body text not null check (length(trim(body)) > 0),
  options text[] not null check (array_length(options, 1) between 2 and 6),
  correct smallint not null,
  level text not null default '',
  created_at timestamptz not null default now(),
  check (correct >= 0 and correct < array_length(options, 1))
);
create index on public.questions (exam_id, position);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  display_name text not null,
  question_order uuid[] not null,
  answers jsonb not null default '{}',
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  submitted_at timestamptz,
  correct_count int,
  total int,
  score numeric(4, 2)
);
create index on public.attempts (exam_id);
create index on public.attempts (user_id);

-- Helpers (security definer để tránh RLS đệ quy giữa các bảng)

create function public.is_teacher() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher')
$$;

create function public.is_anonymous() returns boolean
language sql stable as $$
  select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
$$;

create function public.is_member(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select not public.is_anonymous() and exists (
    select 1 from public.class_students
    where class_id = p_class
      and (user_id = auth.uid() or (email is not null and email = lower(auth.jwt() ->> 'email')))
  )
$$;

create function public.owns_class(p_class uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.classes where id = p_class and teacher_id = auth.uid())
$$;

create function public.owns_exam(p_exam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.exams where id = p_exam and teacher_id = auth.uid())
$$;

-- RLS. Grant rõ ràng, không dựa vào default privileges của project.

grant select on public.profiles, public.exams to anon;
grant select, insert, update, delete on public.classes, public.class_students, public.exams, public.questions to authenticated;
grant select on public.profiles, public.attempts to authenticated;

alter table public.profiles enable row level security;
alter table public.classes enable row level security;
alter table public.class_students enable row level security;
alter table public.exams enable row level security;
alter table public.questions enable row level security;
alter table public.attempts enable row level security;

-- Tên giáo viên hiện công khai trong kho đề; hồ sơ học sinh chỉ chủ tài khoản đọc.
create policy "profiles read" on public.profiles for select
  using (id = auth.uid() or role = 'teacher');
create policy "profiles update own" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (full_name) on public.profiles to authenticated;

create policy "classes teacher" on public.classes for all
  using (teacher_id = auth.uid())
  with check (teacher_id = auth.uid() and public.is_teacher());
create policy "classes member read" on public.classes for select
  using (public.is_member(id));

create policy "roster teacher" on public.class_students for all
  using (public.owns_class(class_id)) with check (public.owns_class(class_id));
create policy "roster self read" on public.class_students for select
  using (user_id = auth.uid() or (email is not null and email = lower(auth.jwt() ->> 'email')));

create policy "exams teacher" on public.exams for all
  using (teacher_id = auth.uid())
  with check (
    teacher_id = auth.uid() and public.is_teacher()
    and (class_id is null or public.owns_class(class_id))
  );
create policy "exams public read" on public.exams for select
  using (access = 'public' and status = 'open');
create policy "exams class read" on public.exams for select
  using (status <> 'draft' and class_id is not null and public.is_member(class_id));

create policy "questions teacher" on public.questions for all
  using (public.owns_exam(exam_id)) with check (public.owns_exam(exam_id));

-- Bài làm chỉ ghi qua RPC bên dưới.
create policy "attempts read" on public.attempts for select
  using (user_id = auth.uid() or public.owns_exam(exam_id));
revoke insert, update, delete on public.attempts from anon, authenticated;

-- RPC

create function public.join_class(p_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_class uuid;
  v_email text := lower(auth.jwt() ->> 'email');
  v_name text;
begin
  if auth.uid() is null or public.is_anonymous() then
    raise exception 'Cần đăng nhập bằng tài khoản để vào lớp';
  end if;
  select id into v_class from public.classes where code = upper(trim(p_code));
  if v_class is null then raise exception 'Không tìm thấy lớp với mã này'; end if;
  select full_name into v_name from public.profiles where id = auth.uid();

  update public.class_students set user_id = auth.uid()
    where class_id = v_class and user_id is null and email = v_email;
  if not found then
    insert into public.class_students (class_id, full_name, email, user_id)
    values (v_class, coalesce(nullif(trim(v_name), ''), v_email), v_email, auth.uid())
    on conflict do nothing;
  end if;
  return v_class;
end $$;

-- Thông tin trước khi vào thi: ai có link cũng xem được (trừ đề nháp).
create function public.exam_info(p_exam uuid) returns jsonb
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
                      and a.submitted_at is null and a.deadline > now() limit 1)
  )
  from public.exams e
  join public.profiles p on p.id = e.teacher_id
  left join public.classes c on c.id = e.class_id
  where e.id = p_exam and (e.status <> 'draft' or e.teacher_id = auth.uid())
$$;

create function public.public_exams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.title, e.subject, e.grade, e.duration_min, e.created_at, p.full_name as teacher_name,
      (select count(*) from public.questions q where q.exam_id = e.id) as question_count,
      (select count(*) from public.attempts a where a.exam_id = e.id and a.submitted_at is not null) as attempt_count
    from public.exams e join public.profiles p on p.id = e.teacher_id
    where e.access = 'public' and e.status = 'open'
  ) x where x.question_count > 0
$$;

create function public.start_attempt(p_exam uuid, p_name text default null) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  e public.exams;
  v_id uuid;
  v_name text;
  v_order uuid[];
begin
  if auth.uid() is null then raise exception 'Cần đăng nhập'; end if;
  select * into e from public.exams where id = p_exam;
  if e.id is null or e.status <> 'open' then raise exception 'Đề chưa mở'; end if;
  if e.opens_at is not null and now() < e.opens_at then raise exception 'Chưa đến giờ mở đề'; end if;
  if e.closes_at is not null and now() >= e.closes_at then raise exception 'Đề đã đóng'; end if;
  if e.access = 'private' and not public.is_member(e.class_id) then
    raise exception 'Em không có trong danh sách lớp của đề này';
  end if;

  -- Làm tiếp bài đang dở thay vì tạo lượt mới.
  select id into v_id from public.attempts
    where exam_id = p_exam and user_id = auth.uid() and submitted_at is null and deadline > now();
  if v_id is not null then return v_id; end if;

  -- Khóa theo (đề, người) để hai tab cùng bấm không vượt số lượt.
  perform pg_advisory_xact_lock(hashtext(p_exam::text || auth.uid()::text));
  if (select count(*) from public.attempts where exam_id = p_exam and user_id = auth.uid()) >= e.max_attempts then
    raise exception 'Em đã dùng hết số lần làm đề này';
  end if;

  if e.access = 'private' then
    -- Học sinh được thêm theo email: gắn tài khoản vào danh sách để thống kê của giáo viên khớp bài làm.
    update public.class_students set user_id = auth.uid()
      where class_id = e.class_id and user_id is null and email = lower(auth.jwt() ->> 'email');
    select cs.full_name into v_name from public.class_students cs
      where cs.class_id = e.class_id
        and (cs.user_id = auth.uid() or cs.email = lower(auth.jwt() ->> 'email'))
      limit 1;
  else
    v_name := nullif(trim(p_name), '');
    if v_name is null then select nullif(trim(full_name), '') into v_name from public.profiles where id = auth.uid(); end if;
  end if;
  if v_name is null then raise exception 'Cần nhập họ tên'; end if;

  select array_agg(id order by case when e.shuffle_questions then random() else position end, created_at)
    into v_order from public.questions where exam_id = p_exam;
  if v_order is null then raise exception 'Đề chưa có câu hỏi'; end if;

  insert into public.attempts (exam_id, user_id, display_name, question_order, deadline)
  values (p_exam, auth.uid(), left(v_name, 120), v_order,
          least(now() + make_interval(mins => e.duration_min), coalesce(e.closes_at, 'infinity')))
  returning id into v_id;
  return v_id;
end $$;

-- Câu hỏi của một lượt làm, không kèm đáp án. Thứ tự phương án được đảo cố định theo lượt làm;
-- mỗi phương án mang chỉ số gốc "i" để lưu câu trả lời.
create function public.attempt_questions(p_attempt uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'attempt', jsonb_build_object('id', a.id, 'exam_id', a.exam_id, 'display_name', a.display_name,
      'deadline', a.deadline, 'submitted_at', a.submitted_at, 'answers', a.answers, 'now', now()),
    'exam', jsonb_build_object('title', e.title, 'subject', e.subject),
    'questions', (
      select jsonb_agg(jsonb_build_object(
        'id', q.id, 'body', q.body,
        'options', (select jsonb_agg(jsonb_build_object('i', o.n - 1, 't', o.t)
                      order by case when e.shuffle_options then md5(a.id::text || q.id::text || o.n) else lpad(o.n::text, 3, '0') end)
                    from unnest(q.options) with ordinality o(t, n))
      ) order by ord.n)
      from unnest(a.question_order) with ordinality ord(qid, n)
      join public.questions q on q.id = ord.qid
    )
  )
  from public.attempts a join public.exams e on e.id = a.exam_id
  where a.id = p_attempt and a.user_id = auth.uid()
$$;

create function public.save_answer(p_attempt uuid, p_question uuid, p_choice int) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attempts;
begin
  select * into a from public.attempts where id = p_attempt and user_id = auth.uid() for update;
  if a.id is null then raise exception 'Không tìm thấy bài làm'; end if;
  if a.submitted_at is not null then raise exception 'Bài đã nộp'; end if;
  -- 30 giây bù độ trễ mạng.
  if now() > a.deadline + interval '30 seconds' then raise exception 'Đã hết giờ làm bài'; end if;
  if not (p_question = any (a.question_order)) then raise exception 'Câu hỏi không thuộc bài làm'; end if;
  if p_choice is null then
    update public.attempts set answers = answers - p_question::text where id = p_attempt;
  else
    if not exists (select 1 from public.questions where id = p_question
                   and p_choice >= 0 and p_choice < array_length(options, 1)) then
      raise exception 'Phương án không hợp lệ';
    end if;
    update public.attempts set answers = answers || jsonb_build_object(p_question::text, p_choice) where id = p_attempt;
  end if;
end $$;

create function public.submit_attempt(p_attempt uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.attempts; v_correct int;
begin
  select * into a from public.attempts where id = p_attempt and user_id = auth.uid() for update;
  if a.id is null then raise exception 'Không tìm thấy bài làm'; end if;
  if a.submitted_at is not null then return; end if;
  select count(*) into v_correct from public.questions q
    where q.id = any (a.question_order) and (a.answers ->> q.id::text)::int = q.correct;
  update public.attempts set
    submitted_at = least(now(), a.deadline),
    correct_count = v_correct,
    total = cardinality(a.question_order),
    score = round(10.0 * v_correct / cardinality(a.question_order), 2)
  where id = p_attempt;
end $$;

-- Kết quả: đáp án đúng chỉ hiện khi giáo viên cho phép và đề đã đóng (hoặc không có hạn).
create function public.attempt_review(p_attempt uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with base as (
    select a.*, e.title, e.subject, e.teacher_id,
      e.show_answers and (e.status = 'closed' or e.closes_at is null or e.closes_at <= now()) as reveal
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
        'is_correct', (b.answers ->> q.id::text)::int = q.correct,
        'correct', case when b.reveal then q.correct end
      ) order by ord.n)
      from unnest(b.question_order) with ordinality ord(qid, n)
      join public.questions q on q.id = ord.qid
    )
  ) from base b
$$;

revoke execute on function public.join_class, public.start_attempt, public.attempt_questions,
  public.save_answer, public.submit_attempt, public.attempt_review from public, anon;
grant execute on function public.join_class, public.start_attempt, public.attempt_questions,
  public.save_answer, public.submit_attempt, public.attempt_review to authenticated;
