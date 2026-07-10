-- Suddhalaya backend — fix: infinite recursion in the staff RLS policy.
-- The original staff_read policy called is_staff(), which queries `staff`, so
-- evaluating the policy recursed. Replace with a direct self-row check.
-- (Apply this to any database created before this fix. 0002 now ships the fix too.)

drop policy if exists staff_read  on public.staff;
drop policy if exists staff_write on public.staff;

create policy staff_self_read on public.staff for select using (user_id = auth.uid());
-- staff writes go through the service role (seeder / admin API) — no anon/auth policy.
