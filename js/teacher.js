import { supabase } from './supabase.js';
import { requireRole, logout } from './auth.js';

const weekdays = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
let current;
let todayDuties = [];
let selectedDuty = null;

function bangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  return `${parts.find((part) => part.type === 'year').value}-${parts.find((part) => part.type === 'month').value}-${parts.find((part) => part.type === 'day').value}`;
}
function thaiDate() { return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' }).format(new Date()); }
const label = { booked: 'รอส่ง', submitted_on_time: 'ส่งตรงเวลา', submitted_late: 'ส่งช้า', passed: 'ผ่านแล้ว', needs_improvement: 'ต้องแก้ไข', absent: 'ขาดเวร' };
const badge = { booked: 'bg-slate-100 text-slate-600', submitted_on_time: 'bg-emerald-50 text-emerald-700', submitted_late: 'bg-rose-50 text-rose-700', passed: 'bg-teal/10 text-teal', needs_improvement: 'bg-amber-50 text-amber-800', absent: 'bg-rose-50 text-rose-700' };

async function signedUrl(path) {
  if (!path) return null;
  const { data } = await supabase.storage.from('clean-evidence').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

async function refresh() {
  const [studentsResult, dutiesResult] = await Promise.all([
    supabase.from('students').select('*').eq('classroom', current.profile.classroom).order('school_code'),
    supabase.from('clean_duty').select('id,duty_date,status,evidence_path,submitted_at,review_reason,task_id,student_id,students(name,school_code),clean_tasks(task_name,position)').eq('duty_date', bangkokDate())
  ]);
  if (studentsResult.error || dutiesResult.error) return showError(studentsResult.error?.message || dutiesResult.error?.message);
  todayDuties = await Promise.all(dutiesResult.data.map(async (duty) => ({ ...duty, signedUrl: await signedUrl(duty.evidence_path) })));
  renderDashboard();
  renderDuties();
  renderMissing(studentsResult.data);
  renderRoster(studentsResult.data);
}

function renderDashboard() {
  const submitted = todayDuties.filter((duty) => duty.submitted_at).length;
  const pending = todayDuties.filter((duty) => duty.status === 'booked').length;
  const late = todayDuties.filter((duty) => duty.status === 'submitted_late').length;
  document.querySelector('#submittedCount').innerHTML = `${submitted} <span class="text-base text-slate-400">/ 6 คน</span>`;
  document.querySelector('#pendingCount').innerHTML = `${pending} <span class="text-base text-slate-400">คน</span>`;
  document.querySelector('#lateCount').innerHTML = `${late} <span class="text-base text-slate-400">คน</span>`;
  document.querySelector('#dutyCount').textContent = `${todayDuties.length} รายการ`;
}

function renderDuties() {
  const list = document.querySelector('#inspectionList');
  list.innerHTML = todayDuties.length ? todayDuties.map((duty) => `<article class="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between"><div class="flex min-w-0 items-center gap-3">${duty.signedUrl ? `<img class="evidence-thumb" src="${duty.signedUrl}" alt="รูปหลักฐาน" />` : `<div class="grid evidence-thumb place-items-center bg-slate-100 text-xl text-slate-400">—</div>`}<div class="min-w-0"><p class="font-bold">${duty.students.name}</p><p class="text-sm text-slate-500">${duty.clean_tasks.task_name} · ตำแหน่ง ${duty.clean_tasks.position}</p><p class="mt-1 text-xs text-slate-400">${duty.submitted_at ? `ส่งเมื่อ ${new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(duty.submitted_at))}` : 'ยังไม่มีรูปหลักฐาน'}</p></div></div><div class="flex items-center gap-3"><span class="rounded-full px-2.5 py-1 text-xs font-bold ${badge[duty.status]}">${label[duty.status]}</span>${duty.signedUrl ? `<button class="review-button border border-slate-300 px-3 py-2 text-sm font-bold hover:bg-slate-50" data-duty="${duty.id}" type="button">ตรวจงาน</button>` : ''}</div></article>`).join('') : '<p class="px-5 py-8 text-center text-slate-500">ยังไม่มีการจองเวรในวันนี้</p>';
}

function renderMissing(students) {
  const weekdayToken = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(new Date());
  const isoWeekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayToken];
  
  const onDutyStudents = students.filter(s => s.duty_weekday === isoWeekday);
  const missingStudents = onDutyStudents.map(student => {
    const duty = todayDuties.find(d => d.student_id === student.id);
    if (!duty) return { student, statusText: 'ยังไม่ได้จองเวร', statusColor: 'text-slate-500' };
    if (duty.status === 'booked') return { student, statusText: `จองแล้ว (${duty.clean_tasks.task_name}) แต่ยังไม่ส่ง`, statusColor: 'text-amber-600' };
    return null;
  }).filter(Boolean);

  document.querySelector('#missingCount').textContent = `${missingStudents.length} คน`;
  document.querySelector('#missingList').innerHTML = missingStudents.length 
    ? missingStudents.map(m => `<div class="flex items-center justify-between px-5 py-4"><p class="font-bold">${m.student.name}</p><span class="text-sm font-medium ${m.statusColor}">${m.statusText}</span></div>`).join('')
    : '<p class="px-5 py-8 text-center text-emerald-600">เยี่ยมมาก! ทุกคนจองเวรและส่งงานแล้ว</p>';
}

function renderRoster(students) {
  document.querySelector('#studentCount').textContent = `${students.length} คน`;
  document.querySelector('#roster').innerHTML = students.map((student, index) => `<div class="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span class="font-medium">${String(index + 1).padStart(2, '0')}. ${student.name}</span><span class="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">${weekdays[student.duty_weekday - 1]}</span></div>`).join('');
  document.querySelector('#scheduleRows').innerHTML = weekdays.map((day, index) => `<section class="border-l-4 border-teal bg-slate-50 p-4"><p class="font-bold">${day} <span class="text-sm font-normal text-slate-500">· 6 คน</span></p><p class="mt-2 text-sm leading-7">${students.filter((student) => student.duty_weekday === index + 1).map((student) => student.name).join(', ')}</p></section>`).join('');
}

function showError(message) { document.querySelector('#inspectionList').innerHTML = `<p class="px-5 py-6 text-rose-700">${message}</p>`; }

document.querySelector('#inspectionList').addEventListener('click', (event) => {
  const button = event.target.closest('[data-duty]');
  if (!button) return;
  selectedDuty = todayDuties.find((duty) => duty.id === button.dataset.duty);
  document.querySelector('#reviewName').textContent = selectedDuty.students.name;
  document.querySelector('#reviewDetail').textContent = `${selectedDuty.clean_tasks.task_name} · ตำแหน่ง ${selectedDuty.clean_tasks.position}`;
  document.querySelector('#reviewImage').src = selectedDuty.signedUrl;
  document.querySelector('#reviewStatus').value = selectedDuty.status === 'passed' ? 'passed' : 'needs_improvement';
  document.querySelector('#reasonPreset').value = '';
  document.querySelector('#reasonText').value = selectedDuty.review_reason || '';
  document.querySelector('#reviewDialog').showModal();
});

document.querySelector('#cancelReview').addEventListener('click', () => document.querySelector('#reviewDialog').close());
document.querySelector('#reviewForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.querySelector('#reviewStatus').value;
  const reason = [document.querySelector('#reasonPreset').value, document.querySelector('#reasonText').value.trim()].filter(Boolean).join(': ');
  const errorBox = document.querySelector('#reviewError');
  if (status !== 'passed' && !reason) { errorBox.textContent = 'กรุณาเลือกหรือกรอกเหตุผล'; errorBox.classList.remove('hidden'); return; }
  const { error } = await supabase.rpc('review_clean_duty', { p_duty_id: selectedDuty.id, p_status: status, p_reason: reason || null });
  if (error) { errorBox.textContent = error.message; errorBox.classList.remove('hidden'); return; }
  document.querySelector('#reviewDialog').close(); await refresh();
});

document.querySelector('#showSchedule').addEventListener('click', () => document.querySelector('#scheduleDialog').showModal());
document.querySelector('#closeSchedule').addEventListener('click', () => document.querySelector('#scheduleDialog').close());

document.querySelector('#reviewImage').addEventListener('click', (e) => {
  document.querySelector('#lightboxImage').src = e.target.src;
  document.querySelector('#lightboxDialog').showModal();
});
document.querySelector('#lightboxImage').addEventListener('click', () => document.querySelector('#lightboxDialog').close());
document.querySelector('#lightboxDialog').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#lightboxDialog')) document.querySelector('#lightboxDialog').close();
});

current = await requireRole('teacher');
if (current) { document.querySelector('#userName').textContent = current.profile.name; document.querySelector('#classroomName').textContent = current.profile.classroom; document.querySelector('#todayLabel').textContent = thaiDate(); document.querySelector('#logoutButton').addEventListener('click', logout); await refresh(); }
