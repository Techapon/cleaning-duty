import { supabase } from './supabase.js';
import { getProfile } from './auth.js';

const form = document.querySelector('#loginForm');
const errorBox = document.querySelector('#loginError');
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const code = document.querySelector('#schoolCode').value.trim();
  const password = document.querySelector('#password').value;
  if (!/^\d{5}$/.test(code)) return showError('กรุณากรอกรหัสประจำตัว 5 หลัก');
  const button = document.querySelector('#loginButton');
  button.disabled = true; button.textContent = 'กำลังเข้าสู่ระบบ...';
  const { error } = await supabase.auth.signInWithPassword({ email: `${code}@skrduty.local`, password });
  if (error) { button.disabled = false; button.textContent = 'เข้าสู่ระบบ'; return showError('รหัสประจำตัวหรือรหัสผ่านไม่ถูกต้อง'); }
  const current = await getProfile();
  if (!current) { await supabase.auth.signOut(); button.disabled = false; button.textContent = 'เข้าสู่ระบบ'; return showError('ไม่พบโปรไฟล์ผู้ใช้ในระบบ'); }
  location.replace(current.role === 'teacher' ? 'teacher.html' : 'student.html');
});
function showError(message) { errorBox.textContent = message; errorBox.classList.remove('hidden'); }
