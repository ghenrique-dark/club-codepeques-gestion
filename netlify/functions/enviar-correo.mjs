// Botón "Enviar correo" de la vista previa: envía al instante el estado de cuenta
// a una familia, desde la cuenta SMTP del administrador. Solo administradores.
import { clienteAdmin, enviarCorreoFamilia, verificarAdmin } from '../lib/notificador.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Método no permitido' }, 405);
  try {
    const sb = clienteAdmin();
    const acceso = await verificarAdmin(req, sb);
    if (acceso.error) return json({ error: acceso.error }, acceso.status);
    const { estudiante_id } = await req.json();
    if (!estudiante_id) return json({ error: 'Falta el estudiante' }, 400);
    const r = await enviarCorreoFamilia(sb, estudiante_id);
    return json({ ok: true, ...r });
  } catch (e) {
    console.error(e);
    const msg = String(e.message || e);
    const auth = /Invalid login|Username and Password not accepted|EAUTH|535/i.test(msg);
    return json({ error: auth
      ? 'Gmail rechazó el usuario o la contraseña. Revisa SMTP_USER y que SMTP_PASS sea la contraseña de aplicación de 16 letras, sin espacios.'
      : msg }, 500);
  }
};
