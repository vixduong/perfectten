-- #6 (bỏ chọn đáp án): save_answer đã xóa khóa câu hỏi khi p_choice là null (xem init); chấm điểm coi câu đó là chưa trả lời.
-- #7 khóa số phương án khi đã có bài trả lời; #10 chỉ email trong danh sách mới thành giáo viên.
-- Rollback: drop trigger questions_lock_options on public.questions; drop function public.lock_options_when_answered;
-- drop table public.teacher_allowlist; rồi chạy lại định nghĩa handle_new_user trong 20261030000000_init.sql.

-- Đáp án học sinh lưu theo vị trí phương án: thêm/bớt phương án sẽ làm lệch ý nghĩa đáp án đã lưu.
create function public.lock_options_when_answered() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(array_length(new.options, 1), 0) <> coalesce(array_length(old.options, 1), 0)
     and exists (select 1 from public.attempts a where a.exam_id = old.exam_id and a.answers ? old.id::text) then
    raise exception 'Không thể thêm/bớt phương án: câu này đã có học sinh trả lời.';
  end if;
  return new;
end $$;
create trigger questions_lock_options before update of options on public.questions
  for each row execute function public.lock_options_when_answered();

-- Danh sách giáo viên do quản trị trường thêm bằng SQL: email đầy đủ hoặc cả tên miền ('@truong.edu.vn').
create table public.teacher_allowlist (
  pattern text primary key check (pattern = lower(pattern) and length(trim(pattern)) > 0)
);
alter table public.teacher_allowlist enable row level security;
revoke all on public.teacher_allowlist from anon, authenticated;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when new.raw_user_meta_data ->> 'role' = 'teacher'
           and not coalesce(new.is_anonymous, false)
           and exists (
             select 1 from public.teacher_allowlist t
             where lower(new.email) = t.pattern
                or (t.pattern like '@%' and right(lower(new.email), length(t.pattern)) = t.pattern)
           )
      then 'teacher' else 'student' end
  );
  return new;
end $$;
