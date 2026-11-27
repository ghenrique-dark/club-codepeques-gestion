import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useConsulta, ok, cargarConfig, mesesEntre } from '../lib/datos.js';
import { Campo, Etiqueta, Modal, limpiar, usd, useAviso, fechaCorta } from '../lib/ui.jsx';
import { ESTATUS, cuotaDe, mesDeCorte, mesTexto, normalizarTelefono } from '../../shared/mensajes.js';

const VACIO = {
  codigo: '', nombre: '', edad: '', estatus: 'activo', fecha_ingreso: '2026-09-01', fecha_retiro: '',
  representante: '', telefono: '', correo: '', fact_rif: '', fact_razon_social: '', cedula_representante: '', notas: ''
};

export default function Estudiantes() {
  const aviso = useAviso();
  const [filtro, setFiltro] = useState('vigentes');
  const [buscar, setBuscar] = useState('');
  const [edit, setEdit] = useState(null);
  const { datos, error, recargar } = useConsulta(async () => {
    const [lista, config, historial] = await Promise.all([
      supabase.from('estudiantes').select('*').order('nombre').then(ok),
      cargarConfig(),
      supabase.from('estatus_historial').select('estudiante_id,estatus,desde').order('desde').then(ok)
    ]);
    return { lista, config, historial };
  });

  if (error) return <div className="aviso err">{error}</div>;
  if (!datos) return <p className="muted">Cargando…</p>;
  const { lista, config, historial } = datos;
  const hoy = mesDeCorte(new Date(), config.zona_horaria);
  const proximoCambio = (id) => historial.find((h) => h.estudiante_id === id && h.desde > hoy);
  const q = buscar.trim().toLowerCase();
  const visibles = lista.filter((e) => {
    if (filtro === 'vigentes' && e.fecha_retiro) return false;
    if (filtro === 'retirados' && !e.fecha_retiro) return false;
    if (['activo', 'egresado', 'regimen_especial'].includes(filtro) && (e.estatus !== filtro || e.fecha_retiro)) return false;
    return !q || `${e.nombre} ${e.representante} ${e.codigo || ''}`.toLowerCase().includes(q);
  });

  return (
    <>
      <div className="head">
        <div>
          <h1>Estudiantes</h1>
          <p className="muted">Cuota según estatus: activo {usd(config.cuota_activo)}, egresado {usd(config.cuota_egresado)}, régimen especial {usd(config.cuota_regimen_especial)}. Pulsa <b>Editar</b> para cambiar datos, representante o estatus.</p>
        </div>
        <button className="btn prim" onClick={() => setEdit({ ...VACIO })}>Agregar estudiante</button>
      </div>
      <div className="card">
        <div className="acciones" style={{ marginBottom: 12 }}>
          <select value={filtro} onChange={(e) => setFiltro(e.target.value)} aria-label="Filtrar">
            <option value="vigentes">Todos los vigentes</option>
            <option value="activo">Activos</option>
            <option value="egresado">Egresados</option>
            <option value="regimen_especial">Régimen especial</option>
            <option value="retirados">Retirados del Club</option>
            <option value="todos">Todos</option>
          </select>
          <input placeholder="Buscar por nombre o representante" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ minWidth: 260 }} />
          <span className="muted small">{visibles.length} de {lista.length}</span>
        </div>
        <div className="tabla-wrap"><table>
          <thead><tr><th>Cód.</th><th>Estudiante</th><th>Estatus actual</th><th className="num">Cuota</th><th>Representante</th><th>Teléfono</th><th>Correo</th><th /></tr></thead>
          <tbody>
            {visibles.map((e) => {
              const prox = proximoCambio(e.id);
              return (
                <tr key={e.id}>
                  <td>{e.codigo}</td>
                  <td><b>{e.nombre}</b>{e.edad ? <span className="muted small"> · {e.edad} años</span> : null}
                    {e.fecha_retiro && <div className="small muted">Retirado desde {fechaCorta(e.fecha_retiro)}</div>}
                    {e.notas && <div className="small muted" style={{ maxWidth: 280 }}>{e.notas}</div>}</td>
                  <td><Etiqueta valor={e.estatus} texto={ESTATUS[e.estatus]} />
                    {prox && <div className="small muted">Desde {mesTexto(prox.desde)}: {ESTATUS[prox.estatus]}</div>}</td>
                  <td className="num">{usd(cuotaDe(e.estatus, config))}</td>
                  <td>{e.representante}</td>
                  <td>{e.telefono || <span className="muted">—</span>}</td>
                  <td>{e.correo || <span className="muted">—</span>}</td>
                  <td><button className="btn sm" onClick={() => setEdit({ ...VACIO, ...e })}>Editar</button></td>
                </tr>
              );
            })}
          </tbody>
        </table></div>
      </div>
      {edit && <FormEstudiante inicial={edit} config={config} lista={lista} onCerrar={() => setEdit(null)}
        onGuardado={(m, cerrar = true) => { if (cerrar) setEdit(null); aviso(m); recargar(); }} />}
    </>
  );
}

function FormEstudiante({ inicial, config, lista, onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState(inicial);
  const [guardando, setGuardando] = useState(false);
  const [aplicarHermanos, setAplicarHermanos] = useState(true);
  const nuevo = !inicial.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  // Hermanos: mismo teléfono o mismo representante que los datos ORIGINALES
  const telOriginal = normalizarTelefono(inicial.telefono);
  const repOriginal = (inicial.representante || '').trim().toLowerCase();
  const hermanos = nuevo ? [] : lista.filter((x) => x.id !== inicial.id && (
    (telOriginal && normalizarTelefono(x.telefono) === telOriginal) ||
    (repOriginal && (x.representante || '').trim().toLowerCase() === repOriginal)));
  const cambioRep = !nuevo && ['representante', 'telefono', 'correo'].some((k) => (f[k] || '') !== (inicial[k] || ''));

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      const { id, creado_en, ...resto } = f;
      const datos = limpiar({ ...resto, edad: f.edad === '' || f.edad == null ? '' : Number(f.edad) });
      if (nuevo) {
        ok(await supabase.from('estudiantes').insert(datos));
      } else {
        delete datos.estatus; // el estatus se cambia en su propia sección, por mes
        ok(await supabase.from('estudiantes').update(datos).eq('id', id));
        if (cambioRep && aplicarHermanos && hermanos.length) {
          ok(await supabase.from('estudiantes').update(limpiar({
            representante: f.representante, telefono: f.telefono || '', correo: f.correo || ''
          })).in('id', hermanos.map((h) => h.id)));
        }
      }
      await supabase.rpc('asegurar_cargos');
      onGuardado(nuevo ? 'Estudiante agregado.' : 'Cambios guardados.');
    } catch (err) {
      aviso('No se pudo guardar: ' + err.message, 'err');
    } finally {
      setGuardando(false);
    }
  }

  async function eliminar() {
    const texto = `¿Eliminar a ${inicial.nombre} del registro?\n\nSe borrarán también todas sus mensualidades, sus pagos y su historial. Esta acción no se puede deshacer.\n\nSi solo dejó el Club, es mejor llenar "Retirado del Club desde" para conservar su historial.`;
    if (!confirm(texto)) return;
    try {
      ok(await supabase.from('estudiantes').delete().eq('id', inicial.id));
      onGuardado(`${inicial.nombre} fue eliminado del registro.`);
    } catch (err) { aviso(err.message, 'err'); }
  }

  return (
    <Modal titulo={nuevo ? 'Agregar estudiante' : `Editar: ${inicial.nombre}`} onCerrar={onCerrar} ancho>
      <form className="f" onSubmit={guardar}>
        <h3>Datos del estudiante</h3>
        <div className="fila">
          <Campo label="Nombre completo"><input required value={f.nombre} onChange={set('nombre')} /></Campo>
          <Campo label="Código (opcional)"><input value={f.codigo || ''} onChange={set('codigo')} placeholder="I18" /></Campo>
          <Campo label="Edad"><input type="number" min="5" max="25" value={f.edad ?? ''} onChange={set('edad')} /></Campo>
        </div>
        <div className="fila">
          {nuevo && (
            <Campo label="Estatus de ingreso">
              <select value={f.estatus} onChange={set('estatus')}>
                <option value="activo">Activo ({usd(config.cuota_activo)})</option>
                <option value="egresado">Egresado ({usd(config.cuota_egresado)})</option>
                <option value="regimen_especial">Régimen especial ({usd(config.cuota_regimen_especial)})</option>
              </select>
            </Campo>
          )}
          <Campo label="Fecha de ingreso"><input type="date" min="2026-09-01" required value={f.fecha_ingreso || ''} onChange={set('fecha_ingreso')} /></Campo>
          <Campo label="Retirado del Club desde (opcional)"><input type="date" value={f.fecha_retiro || ''} onChange={set('fecha_retiro')} /></Campo>
        </div>

        <h3 style={{ marginTop: 6 }}>Representante</h3>
        <div className="fila">
          <Campo label="Nombre (se usa en los mensajes)"><input required value={f.representante} onChange={set('representante')} /></Campo>
          <Campo label="Teléfono / WhatsApp"><input value={f.telefono || ''} onChange={set('telefono')} placeholder="0414-1234567" /></Campo>
          <Campo label="Correo"><input type="email" value={f.correo || ''} onChange={set('correo')} /></Campo>
        </div>
        {cambioRep && hermanos.length > 0 && (
          <label className="check aviso warn">
            <input type="checkbox" checked={aplicarHermanos} onChange={(e) => setAplicarHermanos(e.target.checked)} />
            Aplicar también el nombre, teléfono y correo del representante a: {hermanos.map((h) => h.nombre).join(', ')}
          </label>
        )}
        <div className="fila">
          <Campo label="Facturación: RIF / Cédula"><input value={f.fact_rif || ''} onChange={set('fact_rif')} /></Campo>
          <Campo label="Facturación: Razón social"><input value={f.fact_razon_social || ''} onChange={set('fact_razon_social')} /></Campo>
          <Campo label="Cédula del representante"><input value={f.cedula_representante || ''} onChange={set('cedula_representante')} /></Campo>
        </div>
        <Campo label="Notas"><textarea value={f.notas || ''} onChange={set('notas')} /></Campo>
        <div className="acciones">
          <button className="btn prim" disabled={guardando}>{guardando ? 'Guardando…' : nuevo ? 'Agregar' : 'Guardar datos'}</button>
          <button type="button" className="btn" onClick={onCerrar}>Cancelar</button>
        </div>
      </form>

      {!nuevo && <SeccionEstatus est={inicial} config={config} onCambio={(m) => onGuardado(m, false)} />}

      {!nuevo && (
        <div className="card" style={{ marginTop: 18, marginBottom: 0, borderColor: 'var(--err)' }}>
          <h3>Eliminar del registro</h3>
          <p className="small muted">Borra al estudiante con todas sus mensualidades, pagos e historial. Si solo dejó el Club, usa “Retirado del Club desde”.</p>
          <button type="button" className="btn peligro" onClick={eliminar}>Eliminar a {inicial.nombre}</button>
        </div>
      )}
    </Modal>
  );
}

function SeccionEstatus({ est, config, onCambio }) {
  const aviso = useAviso();
  const ingreso = (est.fecha_ingreso || config.mes_inicio).slice(0, 7) + '-01';
  const desdeMin = ingreso > config.mes_inicio ? ingreso : config.mes_inicio;
  const hoy = mesDeCorte(new Date(), config.zona_horaria);
  const [y, m] = hoy.split('-').map(Number);
  const hasta = `${y + 1}-${String(m).padStart(2, '0')}-01`;
  const meses = mesesEntre(desdeMin, hasta);
  const [nuevoEst, setNuevoEst] = useState(est.estatus === 'activo' ? 'egresado' : 'activo');
  const [desde, setDesde] = useState(hoy >= desdeMin ? hoy : desdeMin);
  const [nota, setNota] = useState('');
  const [trabajando, setTrabajando] = useState(false);

  const { datos: historial, recargar } = useConsulta(async () =>
    supabase.from('estatus_historial').select('*').eq('estudiante_id', est.id).order('desde').then(ok), [est.id]);

  async function aplicar() {
    if (!confirm(`¿${est.nombre} pasa a "${ESTATUS[nuevoEst]}" a partir de ${mesTexto(desde)}?\n\nSe ajustarán las mensualidades desde ese mes a ${usd(cuotaDe(nuevoEst, config))}. Los meses anteriores no cambian.`)) return;
    setTrabajando(true);
    try {
      const r = ok(await supabase.rpc('cambiar_estatus', { p_est: est.id, p_estatus: nuevoEst, p_desde: desde, p_nota: nota || null }));
      await supabase.rpc('asegurar_cargos');
      let msg = r.mensualidades_actualizadas > 0
        ? `Estatus actualizado desde ${mesTexto(desde)}. Se ajustaron ${r.mensualidades_actualizadas} mensualidad(es) ya creadas.`
        : `Estatus actualizado desde ${mesTexto(desde)}. Se aplicará a las mensualidades desde ese mes cuando se creen.`;
      if (r.meses_con_saldo_a_favor > 0) msg += ` Atención: ${r.meses_con_saldo_a_favor} mes(es) quedan con saldo a favor (pagó más que la nueva cuota); revísalo en Mensualidades y pagos.`;
      setNota('');
      await recargar();
      onCambio(msg);
    } catch (e) { aviso(e.message, 'err'); }
    setTrabajando(false);
  }

  async function quitar(h) {
    if (!confirm(`¿Eliminar el cambio a "${ESTATUS[h.estatus]}" desde ${mesTexto(h.desde)}? Las mensualidades desde ese mes vuelven al estatus anterior.`)) return;
    try {
      ok(await supabase.rpc('eliminar_cambio_estatus', { p_id: h.id }));
      await supabase.rpc('asegurar_cargos');
      await recargar();
      onCambio('Cambio de estatus eliminado.');
    } catch (e) { aviso(e.message, 'err'); }
  }

  return (
    <div className="card" style={{ marginTop: 18, marginBottom: 0 }}>
      <h3>Estatus por mes</h3>
      {!historial ? <p className="muted small">Cargando…</p> : historial.length === 0 ? (
        <p className="small">Desde su ingreso ({mesTexto(desdeMin)}): <Etiqueta valor={est.estatus} texto={ESTATUS[est.estatus]} /> · {usd(cuotaDe(est.estatus, config))} al mes. Sin cambios registrados.</p>
      ) : (
        <div className="tabla-wrap" style={{ marginBottom: 12 }}><table>
          <thead><tr><th>A partir de</th><th>Estatus</th><th className="num">Cuota</th><th>Nota</th><th /></tr></thead>
          <tbody>{historial.map((h, i) => (
            <tr key={h.id}>
              <td>{mesTexto(h.desde)}{h.desde > hoy && <span className="small muted"> (próximo)</span>}</td>
              <td><Etiqueta valor={h.estatus} texto={ESTATUS[h.estatus]} /></td>
              <td className="num">{usd(cuotaDe(h.estatus, config))}</td>
              <td className="small muted">{h.nota}</td>
              <td>{i > 0 && <button type="button" className="btn sm peligro" onClick={() => quitar(h)}>Eliminar</button>}</td>
            </tr>))}
          </tbody>
        </table></div>
      )}
      <div className="f">
        <div className="fila">
          <Campo label="Nuevo estatus">
            <select value={nuevoEst} onChange={(e) => setNuevoEst(e.target.value)}>
              <option value="activo">Activo ({usd(config.cuota_activo)})</option>
              <option value="egresado">Egresado ({usd(config.cuota_egresado)})</option>
              <option value="regimen_especial">Régimen especial ({usd(config.cuota_regimen_especial)})</option>
            </select>
          </Campo>
          <Campo label="A partir del mes">
            <select value={desde} onChange={(e) => setDesde(e.target.value)}>
              {meses.map((x) => <option key={x} value={x}>{mesTexto(x)}</option>)}
            </select>
          </Campo>
          <Campo label="Nota (opcional)"><input value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Motivo del cambio" /></Campo>
        </div>
        <div className="acciones">
          <button type="button" className="btn acc" disabled={trabajando} onClick={aplicar}>{trabajando ? 'Aplicando…' : 'Aplicar cambio de estatus'}</button>
          <span className="small muted">Ajusta las mensualidades desde ese mes en adelante. Puedes elegir un mes pasado o uno futuro.</span>
        </div>
      </div>
    </div>
  );
}
