// "Enviar ahora" desde la web. Solo para administradores con sesión iniciada.
import { clienteAdmin, procesarProgramacion, verificarAdmin } from '../lib/notificador.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const sb = clienteAdmin();
    const acceso = await verificarAdmin(req, sb);
    if (acceso.error) return json({ error: acceso.error }, acceso.status);

    const { id } = await req.json();
    if (!id) return json({ error: 'Falta el id de la programación' }, 400);

    // se toma solo si sigue pendiente (evita envíos dobles)
    const { data: prog, error } = await sb.from('programaciones')
      .update({ estado: 'procesando' })
      .eq('id', id).eq('estado', 'pendiente')
      .select().maybeSingle();
    if (error) throw error;
    if (!prog) return json({ error: 'La programación ya no está pendiente.' }, 409);

    const r = await procesarProgramacion(sb, prog);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    return json({ error: String(e.message || e) }, 500);
  }
};

export const config = { path: '/api/enviar-ahora' };
