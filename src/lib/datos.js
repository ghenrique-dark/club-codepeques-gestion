import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase.js';

/** Carga una consulta y la recarga cuando se llama a recargar() */
export function useConsulta(fn, deps = []) {
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(async () => {
    setCargando(true);
    try {
      const r = await fn();
      setDatos(r);
      setError(null);
    } catch (e) {
      setError(e.message || String(e));
    } finally {
      setCargando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recargar(); }, [recargar]);
  return { datos, error, cargando, recargar };
}

/** Lanza el error de Supabase si lo hay; si no, devuelve los datos */
export function ok({ data, error }) {
  if (error) throw error;
  return data;
}

export async function cargarConfig() {
  return ok(await supabase.from('configuracion').select('*').eq('id', 1).single());
}

/** Lista de meses (primer día) desde inicio hasta fin, en formato 'YYYY-MM-01' */
export function mesesEntre(inicio, fin) {
  const out = [];
  let [y, m] = inicio.slice(0, 7).split('-').map(Number);
  const [fy, fm] = fin.slice(0, 7).split('-').map(Number);
  while (y < fy || (y === fy && m <= fm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}-01`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

export function urlLogo(path) {
  if (!path) return null;
  return supabase.storage.from('logos').getPublicUrl(path).data.publicUrl;
}

/**
 * Llama a una función de Netlify (envíos) con la sesión del administrador.
 * Con `npm run dev` las funciones no existen: se avisa que hay que usar `netlify dev`.
 */
export async function llamarFuncion(nombre, cuerpo) {
  const { data: { session } } = await supabase.auth.getSession();
  let r;
  try {
    r = await fetch(`/.netlify/functions/${nombre}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token || ''}` },
      body: JSON.stringify(cuerpo)
    });
  } catch {
    throw new Error('No hay conexión con el servidor de envíos.');
  }
  const tipo = r.headers.get('content-type') || '';
  if (!tipo.includes('application/json')) {
    throw new Error('Los envíos no están disponibles en este modo. En tu computadora abre el sistema con "netlify dev" (http://localhost:8888) en lugar de "npm run dev". En el sitio publicado en Netlify funcionan siempre.');
  }
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}
