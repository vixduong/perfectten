-- Chỉ chạy khi `supabase db reset` ở máy local: cho phép đăng ký giáo viên bằng email @truong.edu.vn (dùng trong e2e).
insert into public.teacher_allowlist (pattern) values ('@truong.edu.vn') on conflict do nothing;
