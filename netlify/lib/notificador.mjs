// Motor de envío: lo usan la función programada (cada hora) y "Enviar ahora".
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import {
  agruparFamilias, construirMensaje, asuntoCorreo, resumenUnaLinea,
  normalizarTelefono, enlaceWhatsApp, mesDeCorte, fmt
} from '../../shared/mensajes.js';

const env = (k) => process.env[k];

export function clienteAdmin() {
  const url = env('SUPABASE_URL');
  // Clave secreta (sb_secret_...). Se acepta también la antigua service_role key.
  const key = env('SUPABASE_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) throw new Error('Faltan SUPABASE_URL o SUPABASE_SECRET_KEY en las variables de entorno.');
  return createClient(url, key, { auth: { persistSession: false } });
}

// ------------------------- CORREO (SMTP del administrador) -------------------------
let transporte = null;
function correoConfigurado() {
  return Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS'));
}
function smtp() {
  if (!transporte) {
    const puerto = Number(env('SMTP_PORT') || 465);
    transporte = nodemailer.createTransport({
      host: env('SMTP_HOST'),
      port: puerto,
      secure: puerto === 465,
      pool: true,
      maxConnections: 3,
      auth: { user: env('SMTP_USER'), pass: env('SMTP_PASS') }
    });
  }
  return transporte;
}

function html(texto, config) {
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div style="font-family:Arial,sans-serif;font-size:14px;color:#0B2033;max-width:620px">
  <div style="background:#0B2033;color:#fff;padding:14px 18px;border-radius:8px 8px 0 0;font-weight:bold">${esc(config.nombre_club)}</div>
  <div style="border:1px solid #E6E6E6;border-top:0;padding:18px;border-radius:0 0 8px 8px;line-height:1.55">${esc(texto).replace(/\n/g, '<br>')}</div>
</div>`;
}

async function enviarCorreo(destino, asunto, texto, config) {
  await smtp().sendMail({
    from: { name: env('MAIL_FROM_NAME') || config.nombre_club, address: env('SMTP_USER') },
    to: destino,
    replyTo: config.correo_admin || env('SMTP_USER'),
    subject: asunto,
    text: texto,
    html: html(texto, config)
  });
}

// ------------------------- WHATSAPP (API oficial de Meta, opcional) -------------------------
function whatsappConfigurado() {
  return Boolean(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_NUMBER_ID') && env('WHATSAPP_TEMPLATE'));
}

/**
 * Envía la plantilla aprobada en Meta. Debe tener 4 variables en el cuerpo:
 * {{1}} representante, {{2}} estudiantes, {{3}} resumen, {{4}} saldo total.
 */
async function enviarWhatsApp(telefono, familia, config) {
  const limpiar = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 900);
  const nombres = familia.estudiantes.map((e) => e.nombre).join(', ');
  const r = await fetch(`https://graph.facebook.com/v21.0/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: normalizarTelefono(telefono),
      type: 'template',
      template: {
        name: env('WHATSAPP_TEMPLATE'),
        language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'es' },
        components: [{
          type: 'body',
          parameters: [
            { type: 'text', text: limpiar(familia.representante) },
            { type: 'text', text: limpiar(nombres) },
            { type: 'text', text: limpiar(resumenUnaLinea(familia, config)) },
            { type: 'text', text: fmt(familia.saldo) }
          ]
        }]
      }
    })
  });
  if (!r.ok) {
    const cuerpo = await r.text();
    throw new Error(`WhatsApp API ${r.status}: ${cuerpo.slice(0, 300)}`);
  }
}

// ------------------------- SEGURIDAD -------------------------

/** Verifica que la petición venga de un administrador con sesión iniciada. */
export async function verificarAdmin(req, sb) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'Falta la sesión', status: 401 };
  const { data: u, error } = await sb.auth.getUser(token);
  if (error || !u?.user) return { error: 'Sesión no válida', status: 401 };
  const { data: admin } = await sb.from('admins').select('user_id').eq('user_id', u.user.id).maybeSingle();
  if (!admin) return { error: 'No autorizado', status: 403 };
  return { user: u.user };
}

// ------------------------- PROCESO -------------------------

async function cargarDatos(sb, fechaEnvio) {
  const { data: config, error: e1 } = await sb.from('configuracion').select('*').eq('id', 1).single();
  if (e1) throw e1;
  const corte = mesDeCorte(fechaEnvio, config.zona_horaria);
  const { error: e2 } = await sb.rpc('asegurar_cargos', { hasta: corte });
  if (e2) throw e2;
  const { data: estudiantes, error: e3 } = await sb.from('estudiantes').select('*').is('fecha_retiro', null).order('nombre');
  if (e3) throw e3;
  const { data: cargos, error: e4 } = await sb.from('v_cargos').select('*').lte('mes', corte);
  if (e4) throw e4;
  return { config, corte, familias: agruparFamilias(estudiantes, cargos, { corte }) };
}

/** Procesa una programación ya marcada como 'procesando'. */
export async function procesarProgramacion(sb, prog) {
  const ahora = new Date(); // el estado de cuenta siempre se calcula al momento real del envío
  const { config, familias } = await cargarDatos(sb, ahora);
  const objetivo = prog.alcance === 'solo_con_saldo' ? familias.filter((f) => f.saldo > 0) : familias;
  const canales = new Set(prog.canales || []);
  const registros = [];
  const conteo = { familias: objetivo.length, correo_enviados: 0, whatsapp_enviados: 0, whatsapp_manual: 0, sin_destino: 0, errores: 0 };

  const tareas = objetivo.map((f) => async () => {
    const texto = construirMensaje(f, config, { fecha: ahora });
    const base = {
      programacion_id: prog.id,
      representante: f.representante,
      estudiantes: f.estudiantes.map((e) => e.nombre).join(', '),
      saldo: f.saldo,
      mensaje: texto
    };
    if (canales.has('correo')) {
      if (!f.correo) {
        registros.push({ ...base, canal: 'correo', destino: null, estado: 'sin_destino', detalle: 'Sin correo registrado' });
        conteo.sin_destino++;
      } else if (!correoConfigurado()) {
        registros.push({ ...base, canal: 'correo', destino: f.correo, estado: 'error', detalle: 'Correo SMTP no configurado en Netlify' });
        conteo.errores++;
      } else {
        try {
          await enviarCorreo(f.correo, asuntoCorreo(f, config), texto, config);
          registros.push({ ...base, canal: 'correo', destino: f.correo, estado: 'enviado' });
          conteo.correo_enviados++;
        } catch (e) {
          registros.push({ ...base, canal: 'correo', destino: f.correo, estado: 'error', detalle: String(e.message || e).slice(0, 500) });
          conteo.errores++;
        }
      }
    }
    if (canales.has('whatsapp')) {
      if (!f.telefono) {
        registros.push({ ...base, canal: 'whatsapp', destino: null, estado: 'sin_destino', detalle: 'Sin teléfono registrado' });
        conteo.sin_destino++;
      } else if (!whatsappConfigurado()) {
        registros.push({ ...base, canal: 'whatsapp', destino: normalizarTelefono(f.telefono), estado: 'manual',
          detalle: enlaceWhatsApp(f.telefono, texto) });
        conteo.whatsapp_manual++;
      } else {
        try {
          await enviarWhatsApp(f.telefono, f, config);
          registros.push({ ...base, canal: 'whatsapp', destino: normalizarTelefono(f.telefono), estado: 'enviado' });
          conteo.whatsapp_enviados++;
        } catch (e) {
          registros.push({ ...base, canal: 'whatsapp', destino: normalizarTelefono(f.telefono), estado: 'error',
            detalle: String(e.message || e).slice(0, 500) });
          conteo.errores++;
        }
      }
    }
  });

  // hasta 4 familias en paralelo para no pasar el límite de tiempo de Netlify
  for (let i = 0; i < tareas.length; i += 4) {
    await Promise.all(tareas.slice(i, i + 4).map((t) => t()));
  }

  if (registros.length) {
    const { error } = await sb.from('notificaciones').insert(registros);
    if (error) throw error;
  }

  const estado = conteo.errores > 0 ? 'con_errores' : 'enviada';
  await sb.from('programaciones')
    .update({ estado, ejecutada_en: new Date().toISOString(), resumen: conteo })
    .eq('id', prog.id);

  if (prog.repetir_mensual) {
    const siguiente = new Date(prog.fecha_envio);
    siguiente.setUTCMonth(siguiente.getUTCMonth() + 1);
    await sb.from('programaciones').insert({
      nombre: prog.nombre, fecha_envio: siguiente.toISOString(), alcance: prog.alcance,
      canales: prog.canales, repetir_mensual: true
    });
  }

  // copia de resumen al administrador
  if (config.correo_admin && correoConfigurado()) {
    const r = `Programación: ${prog.nombre}\nFamilias: ${conteo.familias}\nCorreos enviados: ${conteo.correo_enviados}\n` +
      `WhatsApp enviados por API: ${conteo.whatsapp_enviados}\nWhatsApp para enviar a mano: ${conteo.whatsapp_manual}\n` +
      `Sin correo o teléfono: ${conteo.sin_destino}\nErrores: ${conteo.errores}\n\nEl detalle está en la sección Notificaciones del sistema.`;
    try { await enviarCorreo(config.correo_admin, `Resumen de envío: ${prog.nombre}`, r, config); } catch (_) { /* no bloquea */ }
  }
  return { estado, conteo };
}

/** Envía ahora, por correo, el estado de cuenta a la familia de un estudiante. */
export async function enviarCorreoFamilia(sb, estudianteId) {
  if (!correoConfigurado()) {
    throw new Error('El correo no está configurado: faltan SMTP_HOST, SMTP_USER o SMTP_PASS (en .env o en Netlify).');
  }
  const ahora = new Date();
  const { config, familias } = await cargarDatos(sb, ahora);
  const f = familias.find((x) => x.estudiantes.some((e) => e.id === estudianteId));
  if (!f) throw new Error('No se encontró la familia de ese estudiante.');
  if (!f.correo) throw new Error('Esta familia no tiene correo registrado. Agrégalo en Estudiantes → Editar.');
  const texto = construirMensaje(f, config, { fecha: ahora });
  await enviarCorreo(f.correo, asuntoCorreo(f, config), texto, config);
  await sb.from('notificaciones').insert({
    programacion_id: null, canal: 'correo', representante: f.representante, destino: f.correo,
    estudiantes: f.estudiantes.map((e) => e.nombre).join(', '), saldo: f.saldo, mensaje: texto,
    estado: 'enviado', detalle: 'Envío manual desde la vista previa'
  });
  return { destino: f.correo, representante: f.representante };
}

export async function procesarPendientes() {
  const sb = clienteAdmin();
  const { data: progs, error } = await sb.rpc('tomar_programaciones');
  if (error) throw error;
  const resultados = [];
  for (const p of progs || []) {
    try {
      resultados.push({ id: p.id, ...(await procesarProgramacion(sb, p)) });
    } catch (e) {
      await sb.from('programaciones').update({
        estado: 'con_errores', ejecutada_en: new Date().toISOString(), resumen: { error: String(e.message || e) }
      }).eq('id', p.id);
      resultados.push({ id: p.id, error: String(e.message || e) });
    }
  }
  return resultados;
}
