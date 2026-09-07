import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const response = await fetch(new URL('../config.json', import.meta.url));
if (!response.ok) throw new Error('ไม่พบ config.json');
const config = await response.json();
const url = config.supabase?.url;
const key = config.supabase?.anon;
if (!url || !key || url.includes('YOUR_')) throw new Error('ตั้งค่า Supabase ใน config.json ก่อนใช้งาน');

export const supabase = createClient(url, key);
