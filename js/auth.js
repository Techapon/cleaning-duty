import { supabase } from './supabase.js';

export async function getProfile() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const teacher = await supabase.from('teachers').select('*').eq('id', user.id).maybeSingle();
  if (teacher.data) return { role: 'teacher', profile: teacher.data, user };
  const student = await supabase.from('students').select('*').eq('id', user.id).maybeSingle();
  if (student.data) return { role: 'student', profile: student.data, user };
  return null;
}

export async function requireRole(role) {
  const current = await getProfile();
  if (!current) { location.replace('index.html'); return null; }
  if (current.role !== role) { location.replace(current.role === 'teacher' ? 'teacher.html' : 'student.html'); return null; }
  return current;
}

export async function logout() { await supabase.auth.signOut(); location.replace('index.html'); }
