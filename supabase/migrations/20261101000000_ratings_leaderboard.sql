-- Đánh giá đề (1–5) và bảng xếp hạng. Chỉ thêm cột/bảng/hàm; đề cũ mặc định có trong bảng xếp hạng.
-- Rollback: drop function leaderboard, leaderboard_exams, exam_quality, rate_exam; drop table exam_ratings;
-- alter table exams drop column leaderboard; chạy lại public_exams() trong 20261030000000_init.sql.

alter table public.exams add column leaderboard boolean not null default true;

create table public.exam_ratings (
  exam_id uuid not null references public.exams on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  updated_at timestamptz not null default now(),
  primary key (exam_id, user_id)
);
alter table public.exam_ratings enable row level security;
grant select on public.exam_ratings to authenticated;
create policy "ratings read" on public.exam_ratings for select
  using (user_id = auth.uid() or public.owns_exam(exam_id));

-- Chỉ người đã nộp bài mới chấm được; chấm lại thì ghi đè.
create function public.rate_exam(p_exam uuid, p_rating int) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'Điểm đánh giá từ 1 đến 5'; end if;
  if not exists (select 1 from public.attempts where exam_id = p_exam and user_id = auth.uid() and submitted_at is not null) then
    raise exception 'Em cần nộp bài trước khi đánh giá đề';
  end if;
  insert into public.exam_ratings (exam_id, user_id, rating) values (p_exam, auth.uid(), p_rating)
  on conflict (exam_id, user_id) do update set rating = excluded.rating, updated_at = now();
end $$;

create or replace function public.public_exams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.title, e.subject, e.grade, e.duration_min, e.created_at, p.full_name as teacher_name,
      (select count(*) from public.questions q where q.exam_id = e.id) as question_count,
      (select count(*) from public.attempts a where a.exam_id = e.id and a.submitted_at is not null) as attempt_count,
      (select round(avg(r.rating), 1) from public.exam_ratings r where r.exam_id = e.id) as rating,
      (select count(*) from public.exam_ratings r where r.exam_id = e.id) as rating_count
    from public.exams e join public.profiles p on p.id = e.teacher_id
    where e.access = 'public' and e.status = 'open'
  ) x where x.question_count > 0
$$;

-- Ai được xem bảng xếp hạng một đề: giáo viên của đề, học sinh trong lớp của đề, người đã nộp bài đề đó.
create function public.can_see_leaderboard(p_exam uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.exams e
    where e.id = p_exam and e.status <> 'draft' and e.leaderboard
      and (e.teacher_id = auth.uid()
           or (e.class_id is not null and public.is_member(e.class_id))
           or exists (select 1 from public.attempts a where a.exam_id = e.id and a.user_id = auth.uid() and a.submitted_at is not null))
  )
$$;

-- Mỗi người lấy lượt tốt nhất (điểm cao, rồi làm nhanh). "gain" = điểm đề này trừ điểm bài nộp ngay trước đó (đề khác).
create function public.leaderboard(p_exam uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  with best as (
    select distinct on (a.user_id) a.user_id, a.display_name, a.score, a.submitted_at,
      extract(epoch from a.submitted_at - a.started_at)::int as secs
    from public.attempts a
    where a.exam_id = p_exam and a.submitted_at is not null and a.score is not null
    order by a.user_id, a.score desc, a.submitted_at - a.started_at
  ), ranked as (
    select b.*, rank() over (order by b.score desc, b.secs) as rank,
      (select count(*) from public.attempts x where x.user_id = b.user_id and x.submitted_at is not null) as done,
      b.score - (select x.score from public.attempts x
                 where x.user_id = b.user_id and x.exam_id <> p_exam and x.score is not null
                   and x.submitted_at < b.submitted_at
                 order by x.submitted_at desc limit 1) as gain
    from best b
  )
  select jsonb_build_object(
    'exam', jsonb_build_object('id', e.id, 'title', e.title),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'rank', r.rank, 'name', r.display_name, 'score', r.score, 'secs', r.secs,
        'done', r.done, 'gain', r.gain, 'me', r.user_id = auth.uid()) order by r.rank, r.display_name)
      from ranked r), '[]')
  )
  from public.exams e
  where e.id = p_exam and public.can_see_leaderboard(p_exam)
$$;

-- Các đề người xem có thể mở bảng xếp hạng (để chọn trên trang).
create function public.leaderboard_exams() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'title', e.title) order by e.created_at desc), '[]')
  from public.exams e
  where public.can_see_leaderboard(e.id)
$$;

-- Chất lượng đề công khai. Độ phân biệt = (điểm TB nhóm 25% cao nhất − nhóm 25% thấp nhất) / 10, cần ≥ 4 bài.
create function public.exam_quality() returns jsonb
language sql stable security definer set search_path = '' as $$
  with s as (
    select a.exam_id, a.score, ntile(4) over (partition by a.exam_id order by a.score) as q
    from public.attempts a join public.exams e on e.id = a.exam_id
    where e.access = 'public' and e.status = 'open' and a.submitted_at is not null and a.score is not null
  )
  select coalesce(jsonb_agg(x), '[]') from (
    select e.id, e.title, p.full_name as teacher_name,
      (select round(avg(r.rating), 1) from public.exam_ratings r where r.exam_id = e.id) as rating,
      count(*) as attempts,
      round(avg(s.score), 1) as avg_score,
      case when count(*) >= 4
        then round((avg(s.score) filter (where s.q = 4) - avg(s.score) filter (where s.q = 1)) / 10, 2) end as discrimination
    from s join public.exams e on e.id = s.exam_id join public.profiles p on p.id = e.teacher_id
    group by e.id, e.title, p.full_name
  ) x
$$;

revoke execute on function public.rate_exam, public.leaderboard, public.leaderboard_exams from public, anon;
grant execute on function public.rate_exam, public.leaderboard, public.leaderboard_exams to authenticated;
