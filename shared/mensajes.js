// Lógica compartida entre la web (vista previa, WhatsApp manual)
// y la función de Netlify que envía las notificaciones programadas.
// Sin dependencias: funciona en el navegador y en Node.

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
  'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export const ESTATUS = {
  activo: 'Activo',
  egresado: 'Egresado',
  regimen_especial: 'Régimen especial'
};

/** '2026-09-01' -> 'septiembre de 2026' */
export function mesTexto(fechaISO) {
  const [y, m] = String(fechaISO).slice(0, 10).split('-').map(Number);
  return `${MESES[m - 1]} de ${y}`;
}

/** 70 -> '70.00' */
export function fmt(n) {
  return (Number(n) || 0).toFixed(2);
}

export function cuotaDe(estatus, config) {
  if (estatus === 'activo') return Number(config.cuota_activo);
  if (estatus === 'egresado') return Number(config.cuota_egresado);
  return Number(config.cuota_regimen_especial);
}

/** '0414-1234567' -> '584141234567' (Venezuela). Deja intactos los números con código de país. */
export function normalizarTelefono(tel) {
  if (!tel) return '';
  let d = String(tel).replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d.slice(1);
  if (d.startsWith('00')) return d.slice(2);
  if (d.startsWith('0')) return '58' + d.slice(1);
  if (d.length === 10) return '58' + d;
  return d;
}

export function enlaceWhatsApp(telefono, texto) {
  const n = normalizarTelefono(telefono);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texto)}` : '';
}

/**
 * Agrupa por familia (mismo teléfono, o mismo correo, o mismo representante)
 * y calcula el estado de cuenta de cada estudiante hasta el mes de corte.
 * estudiantes: filas de la tabla estudiantes (sin retiro)
 * cargos: filas de v_cargos
 */
export function agruparFamilias(estudiantes, cargos, { corte } = {}) {
  const corteISO = corte ? String(corte).slice(0, 10) : null;
  const porEst = new Map();
  for (const c of cargos) {
    if (corteISO && String(c.mes).slice(0, 10) > corteISO) continue;
    if (!porEst.has(c.estudiante_id)) porEst.set(c.estudiante_id, []);
    porEst.get(c.estudiante_id).push(c);
  }
  const familias = new Map();
  for (const e of estudiantes) {
    const tel = normalizarTelefono(e.telefono);
    const clave = tel || (e.correo || '').trim().toLowerCase() || (e.representante || '').trim().toLowerCase();
    if (!familias.has(clave)) {
      familias.set(clave, {
        clave,
        representante: e.representante,
        telefono: e.telefono || '',
        correo: (e.correo || '').trim(),
        estudiantes: []
      });
    }
    const f = familias.get(clave);
    if (!f.correo && e.correo) f.correo = e.correo.trim();
    if (!f.telefono && e.telefono) f.telefono = e.telefono;
    const lista = (porEst.get(e.id) || []).sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
    const pendientes = lista.filter((c) => Number(c.saldo) > 0);
    f.estudiantes.push({
      ...e,
      cargos: lista,
      pendientes,
      saldo: pendientes.reduce((s, c) => s + Number(c.saldo), 0),
      vencido: pendientes.some((c) => c.vencido)
    });
  }
  return [...familias.values()].map((f) => ({
    ...f,
    saldo: f.estudiantes.reduce((s, x) => s + x.saldo, 0),
    vencido: f.estudiantes.some((x) => x.vencido)
  })).sort((a, b) => a.representante.localeCompare(b.representante, 'es'));
}

function listaY(arr) {
  const a = arr.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1];
}

function reemplazar(texto, valores) {
  return Object.entries(valores).reduce(
    (t, [k, v]) => t.split(`{${k}}`).join(v ?? ''), String(texto ?? ''));
}

/** Detalle por estudiante, una línea cada uno */
export function detalleFamilia(familia, config) {
  return familia.estudiantes.map((e) => {
    const cuota = cuotaDe(e.estatus, config);
    const etiqueta = ESTATUS[e.estatus] || e.estatus;
    if (cuota === 0 && e.saldo === 0) {
      return `• ${e.nombre} (${etiqueta}): exonerado de la mensualidad.`;
    }
    if (e.saldo === 0) {
      return `• ${e.nombre} (${etiqueta}, ${fmt(cuota)} USD al mes): al día.`;
    }
    const meses = e.pendientes.map((c) =>
      `${mesTexto(c.mes)}: ${fmt(c.saldo)} USD${c.vencido ? ' (vencido)' : ''}`);
    return `• ${e.nombre} (${etiqueta}, ${fmt(cuota)} USD al mes): pendiente ${listaY(meses)}. Subtotal: ${fmt(e.saldo)} USD.`;
  }).join('\n');
}

/** Una sola línea (para parámetros de plantillas de WhatsApp, que no admiten saltos de línea) */
export function resumenUnaLinea(familia, config) {
  return familia.estudiantes.map((e) => {
    const cuota = cuotaDe(e.estatus, config);
    if (cuota === 0 && e.saldo === 0) return `${e.nombre}: exonerado`;
    if (e.saldo === 0) return `${e.nombre}: al día`;
    return `${e.nombre}: ${listaY(e.pendientes.map((c) => mesTexto(c.mes)))} (${fmt(e.saldo)} USD)`;
  }).join('; ');
}

export function fechaTexto(fecha = new Date(), zona = 'America/Caracas') {
  const d = new Date(fecha);
  const partes = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(d).split('-').map(Number);
  return `${partes[2]} de ${MESES[partes[1] - 1]} de ${partes[0]}`;
}

/** Mensaje completo de estado de cuenta para una familia */
export function construirMensaje(familia, config, { fecha = new Date() } = {}) {
  const comunes = {
    representante: familia.representante,
    club: config.nombre_club,
    estudiantes: listaY(familia.estudiantes.map((e) => e.nombre)),
    fecha: fechaTexto(fecha, config.zona_horaria),
    saldo: fmt(familia.saldo),
    datos_pago: config.datos_pago,
    firma: config.firma
  };
  const cierre = familia.saldo > 0
    ? reemplazar(config.texto_solicitud_pago, comunes)
    : reemplazar(config.texto_al_dia, comunes);
  return reemplazar(config.plantilla_mensaje, {
    ...comunes,
    detalle: detalleFamilia(familia, config),
    cierre
  });
}

export function asuntoCorreo(familia, config) {
  return reemplazar(config.asunto_correo, {
    club: config.nombre_club,
    representante: familia.representante,
    saldo: fmt(familia.saldo)
  });
}

/** Mes de corte: primer día del mes de la fecha dada, en la zona del club */
export function mesDeCorte(fecha = new Date(), zona = 'America/Caracas') {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit' })
    .format(new Date(fecha)).split('-');
  return `${y}-${m}-01`;
}
