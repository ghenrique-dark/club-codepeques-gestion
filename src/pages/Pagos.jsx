import { useMemo, useState } from 'react';
import { supabase } from '../supabase.js';
import { useConsulta, ok, cargarConfig, mesesEntre } from '../lib/datos.js';
import { Campo, Etiqueta, Modal, limpiar, usd, useAviso, fechaCorta } from '../lib/ui.jsx';
import { ESTATUS, MESES, mesDeCorte, mesTexto } from '../../shared/mensajes.js';

const METODOS = ['Pago móvil', 'Transferencia Bs', 'Zelle', 'Efectivo USD', 'Efectivo Bs', 'Binance / USDT', 'Otro'];
const mesCorto = (iso) => { const [y, m] = iso.split('-').map(Number); return `${MESES[m - 1].slice(0, 3)} ${String(y).slice(2)}`; };

export default function Pagos() {
  const aviso = useAviso();
  const [buscar, setBuscar] = useState('');
  const [verRetirados, setVerRetirados] = useState(false);
  const [sel, setSel] = useState(null); // { estudiante, mes }
  const { datos, error, recargar } = useConsulta(async () => {
    await supabase.rpc('asegurar_cargos');
    const [config, estudiantes, cargos] = await Promise.all([
      cargarConfig(),
      supabase.from('estudiantes').select('*').order('nombre').then(ok),
      supabase.from('v_cargos').select('*').then(ok)
    ]);
    return { config, estudiantes, cargos };
  });

  const meses = useMemo(() => {
    if (!datos) return [];
    const hoy = mesDeCorte(new Date(), datos.config.zona_horaria);
    const ultimo = datos.cargos.reduce((m, c) => (c.mes > m ? c.mes : m), hoy);
    return mesesEntre(datos.config.mes_inicio, ultimo);
  }, [datos]);

  if (error) return <div className="aviso err">{error}</div>;
  if (!datos) return <p className="muted">Cargando…</p>;
  const { estudiantes, cargos, config } = datos;
  const mapa = new Map(cargos.map((c) => [`${c.estudiante_id}|${c.mes}`, c]));
  const q = buscar.trim().toLowerCase();
  const filas = estudiantes.filter((e) => (verRetirados || !e.fecha_retiro) &&
    (!q || `${e.nombre} ${e.representante}`.toLowerCase().includes(q)));

  return (
    <>
      <div className="head">
        <div>
          <h1>Mensualidades y pagos</h1>
          <p className="muted">Desde septiembre de 2026. Toca una celda para ver el detalle o registrar un pago. Las mensualidades se crean solas cada mes según el estatus.</p>
        </div>
        <button className="btn prim" onClick={() => setSel({ estudiante: null, mes: mesDeCorte(new Date(), config.zona_horaria) })}>Registrar pago</button>
      </div>
      <div className="card">
        <div className="acciones" style={{ marginBottom: 12 }}>
          <input placeholder="Buscar estudiante o representante" value={buscar} onChange={(e) => setBuscar(e.target.value)} style={{ minWidth: 260 }} />
          <label className="check"><input type="checkbox" checked={verRetirados} onChange={(e) => setVerRetirados(e.target.checked)} /> Mostrar retirados</label>
          <span className="small muted">
            <span className="etq pagado">pagado</span> <span className="etq parcial">parcial</span> <span className="etq pendiente">pendiente</span> <span className="etq vencido">vencido</span> <span className="etq exonerado">exonerado</span>
          </span>
        </div>
        <div className="tabla-wrap">
          <table className="cuad">
            <thead><tr><th>Estudiante</th>{meses.map((m) => <th key={m} className="num">{mesCorto(m)}</th>)}<th className="num">Saldo</th></tr></thead>
            <tbody>
              {filas.map((e) => {
                const saldo = cargos.filter((c) => c.estudiante_id === e.id).reduce((s, c) => s + Number(c.saldo), 0);
                return (
                  <tr key={e.id}>
                    <td style={{ minWidth: 220 }}><b>{e.nombre}</b><div className="small muted">{ESTATUS[e.estatus]}</div></td>
                    {meses.map((m) => {
                      const c = mapa.get(`${e.id}|${m}`);
                      return (
                        <td key={m} className="celda">
                          {c ? (
                            <button className={'c-' + c.estado} onClick={() => setSel({ estudiante: e, mes: m })}
                              title={`${mesTexto(m)}: ${c.estado}`}>
                              {c.estado === 'pagado' ? '✓' : c.estado === 'exonerado' ? '—' : usd(c.saldo).replace(' USD', '')}
                              <small>{c.estado}</small>
                            </button>
                          ) : <button className="c-vacio" onClick={() => setSel({ estudiante: e, mes: m })} title="Sin mensualidad">·</button>}
                        </td>
                      );
                    })}
                    <td className="num"><b>{usd(saldo)}</b></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {sel && <DetalleMes sel={sel} estudiantes={estudiantes.filter((e) => !e.fecha_retiro)} meses={meses} config={config}
        onCerrar={() => setSel(null)} onCambio={(m) => { aviso(m); recargar(); }} />}
    </>
  );
}

function DetalleMes({ sel, estudiantes, meses, config, onCerrar, onCambio }) {
  const aviso = useAviso();
  const [estId, setEstId] = useState(sel.estudiante?.id || '');
  const [mes, setMes] = useState(sel.mes);
  const hoy = new Date().toISOString().slice(0, 10);
  const [pago, setPago] = useState({ fecha_pago: hoy, monto: '', metodo: 'Pago móvil', referencia: '', monto_bs: '', tasa: '', nota: '' });
  const [montoCargo, setMontoCargo] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const { datos, recargar } = useConsulta(async () => {
    if (!estId) return null;
    const [cargo, pagos] = await Promise.all([
      supabase.from('v_cargos').select('*').eq('estudiante_id', estId).eq('mes', mes).maybeSingle().then(ok),
      supabase.from('pagos').select('*').eq('estudiante_id', estId).eq('mes', mes).order('fecha_pago').then(ok)
    ]);
    setMontoCargo(cargo ? cargo.monto : null);
    setPago((p) => ({ ...p, monto: cargo && Number(cargo.saldo) > 0 ? String(cargo.saldo) : '' }));
    return { cargo, pagos };
  }, [estId, mes]);

  const est = estudiantes.find((e) => e.id === estId) || sel.estudiante;
  const set = (k) => (e) => setPago({ ...pago, [k]: e.target.value });

  async function registrar(e) {
    e.preventDefault();
    if (!estId) return;
    setGuardando(true);
    try {
      ok(await supabase.from('pagos').insert(limpiar({
        ...pago, estudiante_id: estId, mes,
        monto: Number(pago.monto),
        monto_bs: pago.monto_bs === '' ? '' : Number(pago.monto_bs),
        tasa: pago.tasa === '' ? '' : Number(pago.tasa)
      })));
      await recargar();
      onCambio('Pago registrado.');
    } catch (err) { aviso('No se pudo registrar: ' + err.message, 'err'); }
    setGuardando(false);
  }

  async function borrarPago(id) {
    if (!confirm('¿Eliminar este pago?')) return;
    try { ok(await supabase.from('pagos').delete().eq('id', id)); await recargar(); onCambio('Pago eliminado.'); }
    catch (err) { aviso(err.message, 'err'); }
  }

  async function guardarMonto() {
    try {
      if (datos?.cargo) {
        ok(await supabase.from('cargos').update({ monto: Number(montoCargo) }).eq('id', datos.cargo.id));
      } else {
        ok(await supabase.from('cargos').insert({ estudiante_id: estId, mes, monto: Number(montoCargo), estatus_al_generar: est?.estatus }));
      }
      await recargar(); onCambio('Mensualidad actualizada.');
    } catch (err) { aviso(err.message, 'err'); }
  }

  const calcBs = pago.monto_bs && pago.tasa ? (Number(pago.monto_bs) / Number(pago.tasa)).toFixed(2) : null;

  return (
    <Modal titulo={est ? `${est.nombre} · ${mesTexto(mes)}` : 'Registrar pago'} onCerrar={onCerrar}>
      <div className="f">
        <div className="fila">
          <Campo label="Estudiante">
            <select value={estId} onChange={(e) => setEstId(e.target.value)} required>
              <option value="">Elegir…</option>
              {estudiantes.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
            </select>
          </Campo>
          <Campo label="Mes que cubre">
            <select value={mes} onChange={(e) => setMes(e.target.value)}>
              {meses.map((m) => <option key={m} value={m}>{mesTexto(m)}</option>)}
            </select>
          </Campo>
        </div>
        {estId && datos !== null && (
          <>
            <div className="card" style={{ marginBottom: 0 }}>
              {datos?.cargo ? (
                <div className="acciones" style={{ justifyContent: 'space-between' }}>
                  <div>Mensualidad <b>{usd(datos.cargo.monto)}</b> ({ESTATUS[datos.cargo.estatus_al_generar] || '—'}) · pagado {usd(datos.cargo.pagado)} · saldo <b>{usd(datos.cargo.saldo)}</b> · vence {fechaCorta(datos.cargo.vence)}
                    {Number(datos.cargo.a_favor) > 0 && <div className="aviso warn" style={{ margin: '8px 0 0' }}>Saldo a favor: {usd(datos.cargo.a_favor)}. Pagó más que la cuota de este mes (por ejemplo, por un cambio de estatus). Puedes eliminar ese pago y registrarlo en otro mes.</div>}</div>
                  <Etiqueta valor={datos.cargo.estado} />
                </div>
              ) : <p className="muted">Este mes no tiene mensualidad creada (por ejemplo, antes de su fecha de ingreso).</p>}
              <details style={{ marginTop: 8 }}>
                <summary className="small">Corregir el monto de esta mensualidad</summary>
                <div className="acciones" style={{ marginTop: 8 }}>
                  <input type="number" min="0" step="0.01" value={montoCargo ?? ''} onChange={(e) => setMontoCargo(e.target.value)} style={{ width: 140 }} />
                  <button type="button" className="btn sm" onClick={guardarMonto} disabled={montoCargo === null || montoCargo === ''}>Guardar monto</button>
                  <span className="small muted">Cuota normal: activo {usd(config.cuota_activo)}, egresado {usd(config.cuota_egresado)}, régimen especial {usd(config.cuota_regimen_especial)}.</span>
                </div>
              </details>
            </div>
            {datos?.pagos?.length > 0 && (
              <div className="tabla-wrap"><table>
                <thead><tr><th>Fecha</th><th className="num">Monto</th><th>Método</th><th>Referencia</th><th>Nota</th><th /></tr></thead>
                <tbody>{datos.pagos.map((p) => (
                  <tr key={p.id}>
                    <td>{fechaCorta(p.fecha_pago)}</td><td className="num">{usd(p.monto)}</td><td>{p.metodo}</td>
                    <td>{p.referencia}</td><td className="small muted">{p.nota}</td>
                    <td><button className="btn sm peligro" onClick={() => borrarPago(p.id)}>Eliminar</button></td>
                  </tr>))}
                </tbody>
              </table></div>
            )}
          </>
        )}
        <form className="f" onSubmit={registrar}>
          <h3>Nuevo pago</h3>
          <div className="fila">
            <Campo label="Fecha del pago"><input type="date" required value={pago.fecha_pago} onChange={set('fecha_pago')} /></Campo>
            <Campo label="Monto (USD)"><input type="number" min="0.01" step="0.01" required value={pago.monto} onChange={set('monto')} /></Campo>
            <Campo label="Método">
              <select value={pago.metodo} onChange={set('metodo')}>{METODOS.map((m) => <option key={m}>{m}</option>)}</select>
            </Campo>
            <Campo label="Referencia"><input value={pago.referencia} onChange={set('referencia')} /></Campo>
          </div>
          <div className="fila">
            <Campo label="Monto en Bs (opcional)"><input type="number" min="0" step="0.01" value={pago.monto_bs} onChange={set('monto_bs')} /></Campo>
            <Campo label="Tasa Bs/USD (opcional)"><input type="number" min="0" step="0.0001" value={pago.tasa} onChange={set('tasa')} /></Campo>
            <Campo label="Nota"><input value={pago.nota} onChange={set('nota')} /></Campo>
          </div>
          {calcBs && <p className="small muted">Con esa tasa, {pago.monto_bs} Bs equivalen a {calcBs} USD.
            {' '}<button type="button" className="btn sm" onClick={() => setPago({ ...pago, monto: calcBs })}>Usar como monto</button></p>}
          <div><button className="btn prim" disabled={!estId || guardando}>{guardando ? 'Guardando…' : 'Registrar pago'}</button></div>
          <p className="small muted">Un pago que cubre dos meses se registra dos veces, uno por mes. Un pago parcial se registra tal cual: el saldo queda pendiente.</p>
        </form>
      </div>
    </Modal>
  );
}
