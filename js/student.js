import { supabase } from './supabase.js';
import { requireRole, logout } from './auth.js';

const weekdays = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์'];
const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
let current;
let tasks = [];
let duties = [];
let pendingTask = null;
let pendingUpload = null;

const bangkokDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts();
  return `${parts.find((p) => p.type === 'year').value}-${parts.find((p) => p.type === 'month').value}-${parts.find((p) => p.type === 'day').value}`;
};
const thaiDate = () => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'full' }).format(new Date());
const statusText = { booked: 'จองแล้ว · รอส่งหลักฐาน', submitted_on_time: 'ส่งตรงเวลา · รอตรวจ', submitted_late: 'ส่งช้า · รอตรวจ', passed: 'ผ่านเรียบร้อย', needs_improvement: 'ต้องแก้ไข', absent: 'ขาดเวร' };

async function signedUrl(path) {
  if (!path) return null;
  const { data } = await supabase.storage.from('clean-evidence').createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

function notice(message, type = 'teal') {
  const element = document.querySelector('#studentNotice');
  element.textContent = message;
  element.className = `mb-4 border-l-4 px-4 py-3 text-sm ${type === 'error' ? 'border-rose-500 bg-rose-50 text-rose-700' : 'border-teal bg-teal/5 text-teal'}`;
}

function showLoader() { 
  const loader = document.querySelector('#loader');
  if (loader) { loader.classList.remove('hidden', 'opacity-0'); }
}
function hideLoader() {
  const loader = document.querySelector('#loader');
  if (loader) { loader.classList.add('opacity-0'); setTimeout(() => loader.classList.add('hidden'), 300); }
}

async function refresh() {
  showLoader();
  const date = bangkokDate();
  const [taskResult, dutyResult] = await Promise.all([
    supabase.from('clean_tasks').select('*').order('task_name').order('position'),
    supabase.from('clean_duty').select('id,task_id,student_id,status,evidence_path,submitted_at,review_reason,students(name)').eq('duty_date', date)
  ]);
  if (taskResult.error || dutyResult.error) { hideLoader(); return notice(taskResult.error?.message || dutyResult.error?.message, 'error'); }
  tasks = taskResult.data;
  duties = await Promise.all(dutyResult.data.map(async (duty) => ({ ...duty, signedUrl: await signedUrl(duty.evidence_path) })));
  render();
  hideLoader();
}

function render() {
  const myDuty = duties.find((duty) => duty.student_id === current.user.id);
  const weekdayToken = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', weekday: 'short' }).format(new Date());
  const isoWeekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[weekdayToken];
  const isMyDay = current.profile.duty_weekday === isoWeekday;
  const available = tasks.length - duties.length;
  document.querySelector('#availableCount').textContent = `เหลือ ${available} จาก ${tasks.length} ตำแหน่ง`;
  document.querySelector('#todayLabel').textContent = thaiDate();
  document.querySelector('#userName').textContent = current.profile.name;
  document.querySelector('#weekdayValue').textContent = weekdays[current.profile.duty_weekday - 1];
  document.querySelector('#studentDescription').textContent = isMyDay ? 'เลือกตำแหน่งที่รับผิดชอบ และส่งภาพเมื่อทำงานเสร็จ' : `วันนี้ไม่ใช่วันเวรของคุณ (วันเวร: ${weekdays[current.profile.duty_weekday - 1]})`;
  document.querySelector('#myDutyStatus').textContent = myDuty ? statusText[myDuty.status] : 'ยังไม่ได้จอง';
  document.querySelector('#myDutyMeta').textContent = myDuty?.review_reason || (myDuty ? 'คุณสามารถส่งรูปหลักฐานในตำแหน่งที่จอง' : 'ยังไม่มีรายการเวรในวันนี้');
  document.querySelector('#dutyGrid').innerHTML = tasks.map((task) => {
    const duty = duties.find((item) => item.task_id === task.id);
    const mine = duty?.student_id === current.user.id;
    const canBook = isMyDay && !myDuty && !duty;
    const displayName = duty ? (mine ? 'คุณจองแล้ว' : `จองโดย ${duty.students?.name || 'นักเรียน'}`) : 'ว่าง';
    return `<article class="duty-card ${duty ? 'taken' : ''} ${mine ? 'selected' : ''}"><div><span class="duty-icon">${task.task_name === 'กวาดห้อง' ? '🧹' : task.task_name === 'จัดโต๊ะ' ? '🪑' : task.task_name === 'ทิ้งขยะ' ? '♲' : '▤'}</span><h3 class="mt-4 font-bold">${task.task_name}</h3><p class="mt-1 text-sm text-slate-500">ตำแหน่ง ${task.position}</p><span class="mt-3 inline-block rounded-full px-2 py-1 text-xs font-bold ${duty ? 'bg-slate-200 text-slate-600' : 'bg-emerald-50 text-emerald-700'}">${displayName}</span></div>${canBook ? `<button class="book-button mt-4 w-full bg-teal px-3 py-2.5 text-sm font-bold text-white" data-task="${task.id}" type="button">จองตำแหน่งนี้</button>` : ''}${mine && !duty.evidence_path ? `<div class="mt-4 flex gap-2"><label class="flex-1 cursor-pointer text-center bg-teal px-3 py-2.5 text-sm font-bold text-white">อัปโหลด<input class="evidence-input hidden" type="file" data-duty="${duty.id}" accept="image/jpeg,image/png,image/webp" /></label><button class="cancel-button border border-slate-200 bg-white px-3 py-2.5 text-sm font-bold text-rose-600 hover:bg-rose-50" data-duty="${duty.id}" type="button">ยกเลิก</button></div>` : ''}${mine && duty.evidence_path ? `<button class="view-image-button mt-4 w-full border border-teal bg-teal/5 text-teal px-3 py-2.5 text-sm font-bold hover:bg-teal/10" data-url="${duty.signedUrl}" type="button">ดูรูปภาพที่ส่ง</button><p class="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">ส่งเมื่อ ${new Intl.DateTimeFormat('th-TH', { timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(duty.submitted_at))}</p>` : ''}</article>`;
  }).join('');
}

document.querySelector('#dutyGrid').addEventListener('click', async (event) => {
  const bookBtn = event.target.closest('.book-button');
  const cancelBtn = event.target.closest('.cancel-button');
  const viewBtn = event.target.closest('.view-image-button');

  if (bookBtn) {
    pendingTask = tasks.find((task) => task.id === bookBtn.dataset.task);
    document.querySelector('#bookingDetail').textContent = `${pendingTask.task_name} · ตำแหน่ง ${pendingTask.position}`;
    document.querySelector('#bookingDate').textContent = thaiDate();
    document.querySelector('#bookingDialog').showModal();
  } else if (cancelBtn) {
    if (confirm('คุณต้องการยกเลิกการจองตำแหน่งนี้ใช่หรือไม่?')) {
      const { error } = await supabase.rpc('cancel_clean_duty', { p_duty_id: cancelBtn.dataset.duty });
      if (error) notice(error.message, 'error'); else notice('ยกเลิกการจองเรียบร้อยแล้ว');
      await refresh();
    }
  } else if (viewBtn) {
    document.querySelector('#viewImagePreview').src = viewBtn.dataset.url;
    document.querySelector('#viewImageDialog').showModal();
  }
});

document.querySelector('#confirmBooking').addEventListener('click', async (event) => {
  event.preventDefault();
  if (!pendingTask) return;
  const { error } = await supabase.rpc('book_clean_duty', { p_task_id: pendingTask.id });
  document.querySelector('#bookingDialog').close();
  pendingTask = null;
  if (error) notice(error.message, 'error'); else notice('จองเวรสำเร็จแล้ว กรุณาส่งรูปหลักฐานก่อน 17:30 น.');
  await refresh();
});

document.querySelector('#dutyGrid').addEventListener('change', (event) => {
  const input = event.target.closest('.evidence-input');
  if (!input) return;
  const file = input.files[0];
  if (!file) return;
  if (!allowedTypes.includes(file.type) || file.size > 10 * 1024 * 1024) return notice('รองรับเฉพาะ JPG, PNG, WEBP และขนาดไม่เกิน 10 MB', 'error');
  pendingUpload = { file, dutyId: input.dataset.duty, preview: URL.createObjectURL(file) };
  document.querySelector('#uploadPreview').src = pendingUpload.preview;
  document.querySelector('#uploadDetail').textContent = 'รูปหลักฐานการทำความสะอาด';
  document.querySelector('#uploadFile').textContent = `${file.name} · ${(file.size / 1024 / 1024).toFixed(2)} MB`;
  document.querySelector('#uploadDialog').showModal();
});

document.querySelector('#cancelUpload').addEventListener('click', () => { if (pendingUpload) URL.revokeObjectURL(pendingUpload.preview); pendingUpload = null; });
document.querySelector('#confirmUpload').addEventListener('click', async (event) => {
  event.preventDefault();
  if (!pendingUpload) return;
  const extension = pendingUpload.file.name.split('.').pop().toLowerCase();
  const path = `${current.user.id}/${pendingUpload.dutyId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from('clean-evidence').upload(path, pendingUpload.file, { contentType: pendingUpload.file.type, upsert: false });
  if (uploadError) { notice(uploadError.message, 'error'); return; }
  const { error: submitError } = await supabase.rpc('submit_clean_evidence', { p_duty_id: pendingUpload.dutyId, p_evidence_path: path });
  if (submitError) { await supabase.storage.from('clean-evidence').remove([path]); notice(submitError.message, 'error'); return; }
  URL.revokeObjectURL(pendingUpload.preview); pendingUpload = null;
  document.querySelector('#uploadDialog').close(); notice('ส่งหลักฐานเรียบร้อยแล้ว'); await refresh();
});

document.querySelector('#closeViewImage').addEventListener('click', () => {
  document.querySelector('#viewImageDialog').close();
});

[document.querySelector('#uploadPreview'), document.querySelector('#viewImagePreview')].forEach(img => {
  img.addEventListener('click', (e) => {
    document.querySelector('#lightboxImage').src = e.target.src;
    document.querySelector('#lightboxDialog').showModal();
  });
});

document.querySelector('#lightboxImage').addEventListener('click', () => {
  document.querySelector('#lightboxDialog').close();
});
document.querySelector('#lightboxDialog').addEventListener('click', (e) => {
  if (e.target === document.querySelector('#lightboxDialog')) document.querySelector('#lightboxDialog').close();
});

current = await requireRole('student');
if (current) { document.querySelector('#logoutButton').addEventListener('click', logout); await refresh(); }
