import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Browser ไม่สามารถอ่าน .env ได้โดยตรง
// ค่า URL และ Anon Key ถูกเก็บไว้ใน config.json (ซึ่งถูก ignore ใน .gitignore เพื่อความปลอดภัย)
// สำหรับ Local Development: คัดลอก config.example.json เป็น config.json แล้วใส่ค่าของตัวเอง
// สำหรับ GitHub Pages: อัปโหลด config.json ขึ้น repo หรือใช้ค่าตรงๆ ตามความเหมาะสม
const response = await fetch(new URL('../config.json', import.meta.url));
if (!response.ok) throw new Error('ไม่พบ config.json — กรุณาคัดลอก config.example.json แล้วเปลี่ยนชื่อเป็น config.json และใส่ค่า Supabase ของคุณ');
const config = await response.json();
const url = config.supabase?.url;
const key = config.supabase?.anon;
if (!url || !key || url.includes('your-project-ref')) throw new Error('กรุณาตั้งค่า SUPABASE_URL และ SUPABASE_ANON_KEY ใน config.json ก่อนใช้งาน');

export const supabase = createClient(url, key);
