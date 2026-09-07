-- Classroom Duty Management System
-- Run this file once in Supabase Dashboard > SQL Editor.

create extension if not exists pgcrypto;

do $$
begin
  create type public.clean_duty_status as enum (
    'booked',
    'submitted_on_time',
    'submitted_late',
    'passed',
    'needs_improvement',
    'absent'
  );
exception
  when duplicate_object then null;
end $$;

create table if not exists public.teachers (
  id uuid primary key references auth.users(id) on delete cascade,
  school_code text not null unique check (school_code ~ '^[0-9]{5}$'),
  name text not null,
  classroom text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key references auth.users(id) on delete cascade,
  school_code text not null unique check (school_code ~ '^[0-9]{5}$'),
  name text not null,
  classroom text not null,
  duty_weekday smallint not null check (duty_weekday between 1 and 5),
  created_at timestamptz not null default now()
);

create table if not exists public.clean_tasks (
  id uuid primary key default gen_random_uuid(),
  task_name text not null,
  position smallint not null check (position > 0),
  created_at timestamptz not null default now(),
  unique (task_name, position)
);

create table if not exists public.clean_duty (
  id uuid primary key default gen_random_uuid(),
  duty_date date not null,
  task_id uuid not null references public.clean_tasks(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  status public.clean_duty_status not null default 'booked',
  booked_at timestamptz not null default now(),
  evidence_path text,
  submitted_at timestamptz,
  reviewed_by uuid references public.teachers(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  unique (duty_date, task_id),
  unique (duty_date, student_id),
  check ((evidence_path is null) = (submitted_at is null))
);

create index if not exists clean_duty_date_idx on public.clean_duty (duty_date);
create index if not exists clean_duty_student_idx on public.clean_duty (student_id);

insert into public.clean_tasks (task_name, position)
values
  ('กวาดห้อง', 1),
  ('กวาดห้อง', 2),
  ('จัดโต๊ะ', 1),
  ('จัดโต๊ะ', 2),
  ('เขียน/เช็ดกระดาน', 1),
  ('ทิ้งขยะ', 1)
on conflict (task_name, position) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clean-evidence',
  'clean-evidence',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Security helpers use SECURITY DEFINER so RLS can safely check a user's role.
create or replace function public.is_teacher_of_classroom(p_classroom text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.teachers
    where id = auth.uid() and classroom = p_classroom
  );
$$;

create or replace function public.is_classroom_member(p_classroom text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.students where id = auth.uid() and classroom = p_classroom
  ) or exists (
    select 1 from public.teachers where id = auth.uid() and classroom = p_classroom
  );
$$;

create or replace function public.current_student()
returns public.students
language sql
stable
security definer
set search_path = public
as $$
  select s.* from public.students s where s.id = auth.uid();
$$;

alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.clean_tasks enable row level security;
alter table public.clean_duty enable row level security;

drop policy if exists "teachers read own profile" on public.teachers;
create policy "teachers read own profile"
on public.teachers for select to authenticated
using (id = auth.uid());

drop policy if exists "students read their classroom" on public.students;
create policy "students read their classroom"
on public.students for select to authenticated
using (public.is_classroom_member(classroom));

drop policy if exists "authenticated users read tasks" on public.clean_tasks;
create policy "authenticated users read tasks"
on public.clean_tasks for select to authenticated
using (true);

drop policy if exists "classroom members read duties" on public.clean_duty;
create policy "classroom members read duties"
on public.clean_duty for select to authenticated
using (
  exists (
    select 1 from public.students s
    where s.id = clean_duty.student_id
      and public.is_classroom_member(s.classroom)
  )
);

drop policy if exists "evidence owner uploads" on storage.objects;
create policy "evidence owner uploads"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'clean-evidence'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "evidence owner updates" on storage.objects;
create policy "evidence owner updates"
on storage.objects for update to authenticated
using (bucket_id = 'clean-evidence' and owner_id = auth.uid()::text)
with check (bucket_id = 'clean-evidence' and owner_id = auth.uid()::text);

drop policy if exists "classroom members read evidence" on storage.objects;
create policy "classroom members read evidence"
on storage.objects for select to authenticated
using (
  bucket_id = 'clean-evidence'
  and (owner_id = auth.uid()::text or exists (select 1 from public.teachers where id = auth.uid()))
);

drop policy if exists "evidence owner deletes" on storage.objects;
create policy "evidence owner deletes"
on storage.objects for delete to authenticated
using (bucket_id = 'clean-evidence' and owner_id = auth.uid()::text);

create or replace function public.book_clean_duty(p_task_id uuid)
returns public.clean_duty
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student public.students;
  v_duty public.clean_duty;
  v_today date := timezone('Asia/Bangkok', now())::date;
begin
  select * into v_student from public.students where id = auth.uid();
  if not found then
    raise exception 'เฉพาะนักเรียนเท่านั้นที่จองเวรได้';
  end if;

  if extract(isodow from v_today)::smallint <> v_student.duty_weekday then
    raise exception 'วันนี้ไม่ใช่วันเวรของคุณ';
  end if;

  if not exists (select 1 from public.clean_tasks where id = p_task_id) then
    raise exception 'ไม่พบตำแหน่งเวร';
  end if;

  if exists (select 1 from public.clean_duty where duty_date = v_today and student_id = v_student.id) then
    raise exception 'คุณจองเวรสำหรับวันนี้แล้ว';
  end if;

  if exists (select 1 from public.clean_duty where duty_date = v_today and task_id = p_task_id) then
    raise exception 'ตำแหน่งนี้ถูกจองแล้ว';
  end if;

  insert into public.clean_duty (duty_date, task_id, student_id)
  values (v_today, p_task_id, v_student.id)
  returning * into v_duty;
  return v_duty;
exception
  when unique_violation then
    raise exception 'ตำแหน่งนี้ถูกจองแล้ว หรือคุณจองเวรวันนี้แล้ว';
end;
$$;

create or replace function public.submit_clean_evidence(p_duty_id uuid, p_evidence_path text)
returns public.clean_duty
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duty public.clean_duty;
  v_now timestamptz := now();
  v_status public.clean_duty_status;
begin
  if p_evidence_path !~ ('^' || auth.uid()::text || '/' || p_duty_id::text || '/') then
    raise exception 'พาธไฟล์ไม่ถูกต้อง';
  end if;

  select * into v_duty from public.clean_duty
  where id = p_duty_id and student_id = auth.uid()
  for update;

  if not found then
    raise exception 'ไม่พบรายการเวรของคุณ';
  end if;

  if v_duty.status not in ('booked', 'submitted_on_time', 'submitted_late') then
    raise exception 'รายการนี้ปิดรับการส่งหลักฐานแล้ว';
  end if;

  v_status := case
    when timezone('Asia/Bangkok', v_now)::time <= time '17:30' then 'submitted_on_time'
    else 'submitted_late'
  end;

  update public.clean_duty
  set evidence_path = p_evidence_path,
      submitted_at = v_now,
      status = v_status
  where id = p_duty_id
  returning * into v_duty;
  return v_duty;
end;
$$;

create or replace function public.cancel_clean_duty(p_duty_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duty public.clean_duty;
begin
  select * into v_duty from public.clean_duty
  where id = p_duty_id and student_id = auth.uid()
  for update;

  if not found then
    raise exception 'ไม่พบรายการเวรของคุณ';
  end if;

  if v_duty.status <> 'booked' or v_duty.evidence_path is not null then
    raise exception 'ยกเลิกได้เฉพาะเวรที่ยังไม่ได้ส่งหลักฐาน';
  end if;

  delete from public.clean_duty where id = v_duty.id;
end;
$$;

create or replace function public.review_clean_duty(
  p_duty_id uuid,
  p_status public.clean_duty_status,
  p_reason text default null
)
returns public.clean_duty
language plpgsql
security definer
set search_path = public
as $$
declare
  v_duty public.clean_duty;
  v_classroom text;
begin
  if p_status not in ('passed', 'needs_improvement', 'absent') then
    raise exception 'สถานะการประเมินไม่ถูกต้อง';
  end if;

  if p_status in ('needs_improvement', 'absent') and coalesce(btrim(p_reason), '') = '' then
    raise exception 'กรุณาระบุเหตุผลการประเมิน';
  end if;

  select d.* into v_duty
  from public.clean_duty d
  where d.id = p_duty_id
  for update;

  if not found then
    raise exception 'ไม่พบรายการเวร';
  end if;

  select classroom into v_classroom
  from public.students
  where id = v_duty.student_id;

  if not public.is_teacher_of_classroom(v_classroom) then
    raise exception 'คุณไม่มีสิทธิ์ประเมินรายการนี้';
  end if;

  update public.clean_duty
  set status = p_status,
      review_reason = nullif(btrim(p_reason), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now()
  where id = p_duty_id
  returning * into v_duty;
  return v_duty;
end;
$$;

revoke all on function public.book_clean_duty(uuid) from public;
revoke all on function public.submit_clean_evidence(uuid, text) from public;
revoke all on function public.cancel_clean_duty(uuid) from public;
revoke all on function public.review_clean_duty(uuid, public.clean_duty_status, text) from public;
grant execute on function public.book_clean_duty(uuid) to authenticated;
grant execute on function public.submit_clean_evidence(uuid, text) to authenticated;
grant execute on function public.cancel_clean_duty(uuid) to authenticated;
grant execute on function public.review_clean_duty(uuid, public.clean_duty_status, text) to authenticated;
