import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useConsulta, ok, cargarConfig, llamarFuncion } from '../lib/datos.js';
import { Campo, Etiqueta, Modal, usd, useAviso, fechaHora } from '../lib/ui.jsx';
import { agruparFamilias, construirMensaje, enlaceWhatsApp, mesDeCorte } from '../../shared/mensajes.js';

function manana8() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(8, 0, 0, 0);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T08:00`;
}

export default function Notificaciones() {
  const aviso = useAviso();
  const [nueva, setNueva] = useState(false);
  const [registro, setRegistro] = useState(null);
  const [enviando, setEnviando] = useState(null);
  const { datos, error, recargar } = useConsulta(async () => {
    await supabase.rpc('asegurar_cargos');
    const [progs, config, estudiantes, cargos] = await Promise.all([
      supabase.from('programaciones').select('*').order('fecha_envio', { ascending: false }).limit(60).then(ok),
      cargarConfig(),
      supabase.from('estudiantes').select('*').is('fecha_retiro', null).order('nombre').then(ok),
      supabase.from('v_cargos').select('*').then(ok)
    ]);
    const corte = mesDeCorte(new Date(), config.zona_horaria);
    return { progs, config, familias: agruparFamilias(estudiantes, cargos, { corte }) };
  });

  async function enviarAhora(p) {
    if (!confirm(`¿Enviar ahora "${p.nombre}"? Se usará el estado de cuenta de este momento.`)) return;
    setEnviando(p.id);
    try {
      const j = await llamarFuncion('enviar-ahora', { id: p.id });
      const c = j.conteo || {};
      aviso(`Listo: ${c.correo_enviados || 0} correos, ${c.whatsapp_enviados || 0} WhatsApp automáticos, ${c.whatsapp_manual || 0} WhatsApp para enviar a mano.`);
    } catch (e) { aviso(e.message, 'err'); }
    setEnviando(null);
    recargar();
  }

  async function cancelar(p) {
    if (!confirm(`¿Cancelar "${p.nombre}"?`)) return;
    try { ok(await supabase.from('programaciones').update({ estado: 'cancelada' }).eq('id', p.id).eq('estado', 'pendiente')); recargar(); }
    catch (e) { aviso(e.message, 'err'); }
  }

  if (error) return <div className="aviso err">{error}</div>;
  if (!datos) return <p className="muted">Cargando…</p>;
  const { progs, config, familias } = datos;

  return (
    <>
      <div className="head">
        <div>
          <h1>Notificaciones a representantes</h1>
          <p className="muted">Programa una fecha y el sistema envía a cada familia el estado de cuenta de sus estudiantes. Si hay saldo pendiente, el mensaje incluye la solicitud de pago.</p>
        </div>
        <button className="btn prim" onClick={() => setNueva(true)}>Programar envío</button>
      </div>

      <div className="card">
        <h2>Envíos programados</h2>
        {progs.length === 0 ? <p className="muted">Todavía no hay envíos programados.</p> : (
          <div className="tabla-wrap"><table>
            <thead><tr><th>Nombre</th><th>Fecha y hora</th><th>A quién</th><th>Canales</th><th>Estado</th><th>Resultado</th><th /></tr></thead>
            <tbody>{progs.map((p) => (
              <tr key={p.id}>
                <td><b>{p.nombre}</b>{p.repetir_mensual && <div className="small muted">Se repite cada mes</div>}</td>
                <td>{fechaHora(p.fecha_envio)}</td>
                <td>{p.alcance === 'todas' ? 'Todas las familias' : 'Solo con saldo pendiente'}</td>
                <td>{p.canales.map((c) => c === 'correo' ? 'Correo' : 'WhatsApp').join(' + ')}</td>
                <td><Etiqueta valor={p.estado} /></td>
                <td className="small">{p.resumen ? resumenTexto(p.resumen) : <span className="muted">—</span>}</td>
                <td><div className="acciones">
                  {p.estado === 'pendiente' && <button className="btn sm acc" disabled={enviando === p.id} onClick={() => enviarAhora(p)}>{enviando === p.id ? 'Enviando…' : 'Enviar ahora'}</button>}
                  {p.estado === 'pendiente' && <button className="btn sm" onClick={() => cancelar(p)}>Cancelar</button>}
                  {p.ejecutada_en && <button className="btn sm" onClick={() => setRegistro(p)}>Ver detalle</button>}
                </div></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
        <p className="small muted" style={{ marginTop: 10 }}>El servidor revisa cada hora en punto: un envío programado para las 8:00 sale entre las 8:00 y las 9:00.</p>
      </div>

      <VistaPrevia familias={familias} config={config} />

      {nueva && <NuevaProgramacion onCerrar={() => setNueva(false)} onGuardado={() => { setNueva(false); aviso('Envío programado.'); recargar(); }} />}
      {registro && <Registro prog={registro} onCerrar={() => setRegistro(null)} />}
    </>
  );
}

function resumenTexto(r) {
  if (r.error) return `Error: ${r.error}`;
  const partes = [`${r.familias} familias`];
  if (r.correo_enviados) partes.push(`${r.correo_enviados} correos`);
  if (r.whatsapp_enviados) partes.push(`${r.whatsapp_enviados} WhatsApp`);
  if (r.whatsapp_manual) partes.push(`${r.whatsapp_manual} WhatsApp a mano`);
  if (r.sin_destino) partes.push(`${r.sin_destino} sin contacto`);
  if (r.errores) partes.push(`${r.errores} errores`);
  return partes.join(' · ');
}

function NuevaProgramacion({ onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState({ nombre: 'Estado de cuenta mensual', fecha: manana8(), alcance: 'todas', correo: true, whatsapp: true, repetir: false });
  async function guardar(e) {
    e.preventDefault();
    const canales = [f.correo && 'correo', f.whatsapp && 'whatsapp'].filter(Boolean);
    if (!canales.length) { aviso('Elige al menos un canal.', 'err'); return; }
    try {
      ok(await supabase.from('programaciones').insert({
        nombre: f.nombre, fecha_envio: new Date(f.fecha).toISOString(), alcance: f.alcance, canales, repetir_mensual: f.repetir
      }));
      onGuardado();
    } catch (err) { aviso(err.message, 'err'); }
  }
  return (
    <Modal titulo="Programar envío" onCerrar={onCerrar}>
      <form className="f" onSubmit={guardar}>
        <Campo label="Nombre"><input required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></Campo>
        <div className="fila">
          <Campo label="Fecha y hora del envío"><input type="datetime-local" required value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></Campo>
          <Campo label="A quién">
            <select value={f.alcance} onChange={(e) => setF({ ...f, alcance: e.target.value })}>
              <option value="todas">Todas las familias (estado de cuenta)</option>
              <option value="solo_con_saldo">Solo familias con saldo pendiente (cobro)</option>
            </select>
          </Campo>
        </div>
        <div className="acciones">
          <label className="check"><input type="checkbox" checked={f.correo} onChange={(e) => setF({ ...f, correo: e.target.checked })} /> Correo</label>
          <label className="check"><input type="checkbox" checked={f.whatsapp} onChange={(e) => setF({ ...f, whatsapp: e.target.checked })} /> WhatsApp</label>
          <label className="check"><input type="checkbox" checked={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.checked })} /> Repetir cada mes en la misma fecha</label>
        </div>
        <p className="small muted">Si WhatsApp automático no está configurado en Netlify, el sistema deja cada mensaje listo en el detalle del envío para mandarlo con un toque.</p>
        <div><button className="btn prim">Programar</button></div>
      </form>
    </Modal>
  );
}

function Registro({ prog, onCerrar }) {
  const { datos } = useConsulta(async () =>
    supabase.from('notificaciones').select('*').eq('programacion_id', prog.id).order('representante').then(ok), [prog.id]);
  return (
    <Modal titulo={`Detalle: ${prog.nombre}`} onCerrar={onCerrar} ancho>
      {!datos ? <p className="muted">Cargando…</p> : (
        <div className="tabla-wrap"><table>
          <thead><tr><th>Representante</th><th>Canal</th><th>Destino</th><th className="num">Saldo</th><th>Estado</th><th>Detalle</th></tr></thead>
          <tbody>{datos.map((n) => (
            <tr key={n.id}>
              <td>{n.representante}<div className="small muted">{n.estudiantes}</div></td>
              <td>{n.canal === 'correo' ? 'Correo' : 'WhatsApp'}</td>
              <td className="small">{n.destino || '—'}</td>
              <td className="num">{usd(n.saldo)}</td>
              <td><Etiqueta valor={n.estado} texto={n.estado === 'manual' ? 'para enviar' : undefined} /></td>
              <td className="small">{n.estado === 'manual'
                ? <a className="btn sm wa" href={n.detalle} target="_blank" rel="noreferrer">Abrir WhatsApp</a>
                : n.detalle}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
    </Modal>
  );
}

function VistaPrevia({ familias, config }) {
  const aviso = useAviso();
  const [soloSaldo, setSoloSaldo] = useState(true);
  const [abierta, setAbierta] = useState(null);
  const [enviando, setEnviando] = useState(null);
  const [enviados, setEnviados] = useState({});
  const lista = soloSaldo ? familias.filter((f) => f.saldo > 0) : familias;

  async function enviarCorreo(f) {
    if (!confirm(`¿Enviar ahora el estado de cuenta por correo a ${f.representante} (${f.correo})?`)) return;
    setEnviando(f.clave);
    try {
      const r = await llamarFuncion('enviar-correo', { estudiante_id: f.estudiantes[0].id });
      setEnviados((x) => ({ ...x, [f.clave]: true }));
      aviso(`Correo enviado a ${r.destino}.`);
    } catch (e) { aviso(e.message, 'err'); }
    setEnviando(null);
  }

  async function copiar(texto) {
    try { await navigator.clipboard.writeText(texto); aviso('Mensaje copiado. Pégalo en WhatsApp Business o donde lo necesites.'); }
    catch { aviso('No se pudo copiar automáticamente: abre "Ver mensaje" y cópialo a mano.', 'err'); }
  }

  return (
    <div className="card">
      <div className="head" style={{ marginBottom: 8 }}>
        <div>
          <h2>Envío manual y vista previa</h2>
          <p className="muted small">El mismo mensaje que enviará el sistema, con el estado de cuenta de hoy. “Enviar correo” lo manda al instante desde la cuenta de correo del Club; “WhatsApp” abre el chat con el mensaje ya escrito.</p>
        </div>
        <label className="check"><input type="checkbox" checked={soloSaldo} onChange={(e) => setSoloSaldo(e.target.checked)} /> Solo con saldo pendiente</label>
      </div>
      <div className="tabla-wrap"><table>
        <thead><tr><th>Representante</th><th>Estudiantes</th><th className="num">Saldo</th><th>Contacto</th><th /></tr></thead>
        <tbody>{lista.map((f) => {
          const texto = construirMensaje(f, config);
          const wa = enlaceWhatsApp(f.telefono, texto);
          return (
            <tr key={f.clave}>
              <td><b>{f.representante}</b>
                {abierta === f.clave && <pre className="msg">{texto}</pre>}</td>
              <td>{f.estudiantes.map((e) => e.nombre).join(', ')}</td>
              <td className="num">{usd(f.saldo)} {f.vencido && <span className="etq vencido">vencido</span>}</td>
              <td className="small">{f.telefono || '—'}<br />{f.correo || <span className="muted">sin correo</span>}</td>
              <td><div className="acciones">
                <button className="btn sm" onClick={() => setAbierta(abierta === f.clave ? null : f.clave)}>{abierta === f.clave ? 'Ocultar' : 'Ver mensaje'}</button>
                <button className="btn sm" onClick={() => copiar(texto)}>Copiar</button>
                {wa && <a className="btn sm wa" href={wa} target="_blank" rel="noreferrer">WhatsApp</a>}
                {f.correo && (enviados[f.clave]
                  ? <span className="etq enviado">correo enviado</span>
                  : <button className="btn sm prim" disabled={enviando === f.clave} onClick={() => enviarCorreo(f)}>{enviando === f.clave ? 'Enviando…' : 'Enviar correo'}</button>)}
              </div></td>
            </tr>
          );
        })}</tbody>
      </table></div>
    </div>
  );
}
