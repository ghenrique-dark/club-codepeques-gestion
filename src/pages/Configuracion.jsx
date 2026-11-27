import { useEffect, useState } from 'react';
import { supabase } from '../supabase.js';
import { cargarConfig, ok } from '../lib/datos.js';
import { Campo, useAviso } from '../lib/ui.jsx';
import { agruparFamilias, construirMensaje } from '../../shared/mensajes.js';

const EJEMPLO_EST = [
  { id: 'a', nombre: 'Ana Pérez', estatus: 'activo', representante: 'María Pérez', telefono: '0414-0000000', correo: 'maria@ejemplo.com' },
  { id: 'b', nombre: 'Luis Pérez', estatus: 'egresado', representante: 'María Pérez', telefono: '0414-0000000', correo: 'maria@ejemplo.com' }
];
const EJEMPLO_CARGOS = [
  { estudiante_id: 'a', mes: '2026-10-01', monto: 70, saldo: 70, vencido: true },
  { estudiante_id: 'a', mes: '2026-11-01', monto: 70, saldo: 0, vencido: false },
  { estudiante_id: 'b', mes: '2026-11-01', monto: 140, saldo: 140, vencido: false }
];

export default function Configuracion() {
  const aviso = useAviso();
  const [f, setF] = useState(null);
  const [guardando, setGuardando] = useState(false);
  useEffect(() => { cargarConfig().then(setF).catch((e) => aviso(e.message, 'err')); }, [aviso]);
  if (!f) return <p className="muted">Cargando…</p>;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      const { id, actualizado_en, mes_inicio, ...resto } = f;
      ok(await supabase.from('configuracion').update({
        ...resto,
        cuota_activo: Number(f.cuota_activo), cuota_egresado: Number(f.cuota_egresado),
        cuota_regimen_especial: Number(f.cuota_regimen_especial), dia_limite: Number(f.dia_limite),
        correo_admin: f.correo_admin || null, actualizado_en: new Date().toISOString()
      }).eq('id', 1));
      aviso('Configuración guardada. Las nuevas cuotas se aplican a las mensualidades que se creen desde ahora.');
    } catch (err) { aviso(err.message, 'err'); }
    setGuardando(false);
  }

  const familia = agruparFamilias(EJEMPLO_EST, EJEMPLO_CARGOS)[0];
  const ejemplo = construirMensaje(familia, f);

  return (
    <>
      <div className="head"><div><h1>Configuración</h1><p className="muted">Cuotas, fechas, datos de pago y textos de los mensajes.</p></div></div>
      <form className="f" onSubmit={guardar}>
        <div className="card f">
          <h2>Cuotas mensuales por estatus (USD)</h2>
          <div className="fila">
            <Campo label="Activo"><input type="number" min="0" step="0.01" value={f.cuota_activo} onChange={set('cuota_activo')} /></Campo>
            <Campo label="Egresado"><input type="number" min="0" step="0.01" value={f.cuota_egresado} onChange={set('cuota_egresado')} /></Campo>
            <Campo label="Régimen especial"><input type="number" min="0" step="0.01" value={f.cuota_regimen_especial} onChange={set('cuota_regimen_especial')} /></Campo>
            <Campo label="Día límite de pago (1 a 28)"><input type="number" min="1" max="28" value={f.dia_limite} onChange={set('dia_limite')} /></Campo>
          </div>
          <p className="small muted">Las mensualidades se cobran desde septiembre de 2026. Cambiar una cuota no modifica las mensualidades ya creadas.</p>
        </div>
        <div className="card f">
          <h2>Club y pagos</h2>
          <div className="fila">
            <Campo label="Nombre del club"><input required value={f.nombre_club} onChange={set('nombre_club')} /></Campo>
            <Campo label="Correo del administrador (recibe el resumen de cada envío y las respuestas)"><input type="email" value={f.correo_admin || ''} onChange={set('correo_admin')} /></Campo>
          </div>
          <Campo label="Firma de los mensajes"><input value={f.firma} onChange={set('firma')} /></Campo>
          <Campo label="Datos de pago"><textarea value={f.datos_pago} onChange={set('datos_pago')} /></Campo>
          {/\[.*\]/.test(f.datos_pago) && <div className="aviso warn">Los datos de pago todavía tienen texto de ejemplo entre corchetes. Escribe los datos reales antes de programar envíos.</div>}
        </div>
        <div className="card f">
          <h2>Mensajes</h2>
          <p className="small muted">Marcadores: {'{representante} {estudiantes} {club} {fecha} {detalle} {cierre} {saldo} {datos_pago} {firma}'}. {'{detalle}'} es la lista de cada estudiante con su estatus y meses pendientes; {'{cierre}'} es la solicitud de pago si hay saldo, o el texto de “al día”.</p>
          <Campo label="Asunto del correo"><input value={f.asunto_correo} onChange={set('asunto_correo')} /></Campo>
          <Campo label="Plantilla del mensaje"><textarea rows={7} value={f.plantilla_mensaje} onChange={set('plantilla_mensaje')} /></Campo>
          <Campo label="Texto cuando hay saldo pendiente"><textarea value={f.texto_solicitud_pago} onChange={set('texto_solicitud_pago')} /></Campo>
          <Campo label="Texto cuando todo está al día"><textarea value={f.texto_al_dia} onChange={set('texto_al_dia')} /></Campo>
          <h3>Vista previa con una familia de ejemplo</h3>
          <pre className="msg">{ejemplo}</pre>
        </div>
        <div><button className="btn prim" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar configuración'}</button></div>
      </form>
    </>
  );
}
