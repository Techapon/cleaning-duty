// โหลดค่าจาก .env (ถ้ามี dotenv ติดตั้งแล้ว)
// หากยังไม่มี ให้รัน: npm install dotenv ก่อน
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// โหลด .env แบบ manual (ไม่ต้องลง dependency เพิ่ม)
try {
  const envPath = resolve(__dirname, '../.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIndex = trimmed.indexOf('=');
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
} catch {
  // ถ้าไม่มี .env ก็ใช้ค่าจาก environment variables โดยตรง
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('Missing SUPABASE_URL. กรุณาตั้งค่าใน .env หรือ environment variables');
}
if (!serviceRoleKey) {
  throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY. กรุณาตั้งค่าใน .env หรือ environment variables');
}


const classroom = 'ม.5/17';
const students = [
  'ด.ช.กิตติพงศ์ ใจดี', 'ด.ญ.อรอุมา ศรีทอง', 'ด.ช.ปกรณ์ วงศ์คำ', 'ด.ญ.ชนากานต์ อ่อนหวาน', 'ด.ช.ธนกร ทองมาก', 'ด.ญ.ชลธิชา บุญมา',
  'ด.ช.ณัฐวุฒิ ใจมั่น', 'ด.ญ.พิมพ์ชนก แสงทอง', 'ด.ช.ธีรภัทร ศรีสุข', 'ด.ญ.ณิชาภา วัฒนะ', 'ด.ช.วรเมธ เกษมสุข', 'ด.ญ.กัญญารัตน์ แก้วดี',
  'ด.ช.ภูมิพัฒน์ อินทร์แก้ว', 'ด.ญ.รินรดา พูนผล', 'ด.ช.ณรงค์เดช มณีวงศ์', 'ด.ญ.เบญญาภา แสงจันทร์', 'ด.ช.ชยพล สุขใจ', 'ด.ญ.นภัสสร วงศ์ใหญ่',
  'ด.ช.ภาคิน รุ่งเรือง', 'ด.ญ.วริศรา ทองแท้', 'ด.ช.กันต์ธีร์ พัฒนชัย', 'ด.ญ.จุฑามาศ แสนดี', 'ด.ช.นิธิพัฒน์ ตันติสุข', 'ด.ญ.สิริกานต์ บุญช่วย',
  'ด.ช.พงศกร รัตนชัย', 'ด.ญ.ณัฐธิดา ชูศรี', 'ด.ช.จักรภพ สายใจ', 'ด.ญ.ปิยะดา ใจงาม', 'ด.ช.อิทธิพล พรหมมา', 'ด.ญ.สุภัสสรา มีสุข'
];

const tasks = [
  ['กวาดห้อง', 1], ['กวาดห้อง', 2], ['จัดโต๊ะ', 1],
  ['จัดโต๊ะ', 2], ['เขียน/เช็ดกระดาน', 1], ['ทิ้งขยะ', 1]
];

async function request(path, options = {}) {
  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${payload?.message || payload?.msg || response.statusText}`);
  }
  return payload;
}

async function getExistingUsers() {
  const data = await request('/auth/v1/admin/users?page=1&per_page=1000');
  return new Map((data.users || []).map((user) => [user.email, user]));
}

async function ensureAuthUser(existingUsers, code, role) {
  const email = `${code}@skrduty.local`;
  const password = `skr${code}`;
  const metadata = { school_code: code, role };
  let user = existingUsers.get(email);

  if (!user) {
    const created = await request('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: metadata })
    });
    user = created.user || created;
    existingUsers.set(email, user);
  } else {
    const updated = await request(`/auth/v1/admin/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify({ password, email_confirm: true, user_metadata: metadata })
    });
    user = updated.user || updated;
    existingUsers.set(email, user);
  }

  return user;
}

async function upsert(table, rows) {
  await request(`/rest/v1/${table}?on_conflict=id`, {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(rows)
  });
}

async function seedTasks() {
  const response = await fetch(`${supabaseUrl}/rest/v1/clean_tasks?on_conflict=task_name,position`, {
    method: 'POST',
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      'content-type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(tasks.map(([task_name, position]) => ({ task_name, position })))
  });
  if (!response.ok) throw new Error(`Unable to seed clean tasks: ${await response.text()}`);
}

const existingUsers = await getExistingUsers();
const teacher = await ensureAuthUser(existingUsers, '90001', 'teacher');
await upsert('teachers', [{
  id: teacher.id,
  school_code: '90001',
  name: 'ครูประจำชั้น ม.5/17',
  classroom
}]);

const studentProfiles = [];
for (const [index, name] of students.entries()) {
  const code = String(54201 + index);
  const user = await ensureAuthUser(existingUsers, code, 'student');
  studentProfiles.push({
    id: user.id,
    school_code: code,
    name,
    classroom,
    duty_weekday: Math.floor(index / 6) + 1
  });
}

await upsert('students', studentProfiles);
await seedTasks();

console.log('Seed complete.');
console.log('Teacher: 90001 / skr90001');
console.log('Students: 54201-54230 / skr<student code>');
