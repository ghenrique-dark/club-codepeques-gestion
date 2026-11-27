import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
// Clave publicable (sb_publishable_...). Se acepta también la antigua anon key.
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

export const configurado = Boolean(url && key);
export const supabase = configurado ? createClient(url, key) : null;
