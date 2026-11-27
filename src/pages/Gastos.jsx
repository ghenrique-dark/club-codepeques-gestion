import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useConsulta, ok } from '../lib/datos.js';
import { Campo, Modal, limpiar, usd, useAviso, fechaCorta } from '../lib/ui.jsx';

const METODOS = ['Pago móvil', 'Transferencia Bs', 'Zelle', 'Efectivo USD', 'Efectivo Bs', 'Binance / USDT', 'Otro'];
const FONDOS = { mensualidades: 'Mensualidades', patrocinio: 'Patrocinio', otro: 'Otro' };

export default function Gastos() {
  const aviso = useAviso();
  const [edit, setEdit] = useState(null);
  const [cat, setCat] = useState('');
  const { datos, error, recargar } = useConsulta(async () => {
    const [gastos, presupuesto] = await Promise.all([
      supabase.from('gastos').select('*').order('fecha', { ascending: false }).then(ok),
      supabase.from('presupuesto').select('*').order('categoria').then(ok)
    ]);
    return { gastos, presupuesto };
  });

  if (error) return <div className="aviso err">{error}</div>;
  if (!datos) return <p className="muted">Cargando…</p>;
  const { gastos, presupuesto } = datos;
  const categorias = presupuesto.map((p) => p.categoria);
  const ejecutado = (c) => gastos.filter((g) => g.categoria === c).reduce((s, g) => s + Number(g.monto), 0);
  const totalP = presupuesto.reduce((s, p) => s + Number(p.monto), 0);
  const totalG = gastos.reduce((s, g) => s + Number(g.monto), 0);
  const visibles = cat ? gastos.filter((g) => g.categoria === cat) : gastos;

  async function guardarPresupuesto(categoria, monto) {
    try { ok(await supabase.from('presupuesto').update({ monto: Number(monto) || 0 }).eq('categoria', categoria)); recargar(); }
    catch (e) { aviso(e.message, 'err'); }
  }

  return (
    <>
      <div className="head">
        <div><h1>Gastos y presupuesto</h1><p className="muted">Total gastado: <b>{usd(totalG)}</b> de un presupuesto de <b>{usd(totalP)}</b>.</p></div>
        <button className="btn prim" onClick={() => setEdit({})}>Registrar gasto</button>
      </div>
      <div className="card">
        <h2>Presupuesto por categoría</h2>
        <div className="tabla-wrap"><table>
          <thead><tr><th>Categoría</th><th className="num">Presupuesto (USD)</th><th className="num">Ejecutado</th><th className="num">Disponible</th><th>Avance</th></tr></thead>
          <tbody>{presupuesto.map((p) => {
            const ej = ejecutado(p.categoria); const pct = Number(p.monto) ? ej / Number(p.monto) : 0;
            return (
              <tr key={p.categoria}>
                <td>{p.categoria}</td>
                <td className="num"><input type="number" min="0" step="0.01" defaultValue={p.monto} style={{ width: 120, textAlign: 'right' }}
                  onBlur={(e) => Number(e.target.value) !== Number(p.monto) && guardarPresupuesto(p.categoria, e.target.value)} aria-label={`Presupuesto de ${p.categoria}`} /></td>
                <td className="num">{usd(ej)}</td>
                <td className="num" style={{ color: Number(p.monto) - ej < 0 ? 'var(--err)' : undefined }}>{usd(Number(p.monto) - ej)}</td>
                <td style={{ minWidth: 140 }}>{Number(p.monto) > 0 && <>
                  <div style={{ background: 'var(--panel-2)', borderRadius: 6, height: 10 }}>
                    <div style={{ background: pct > 1 ? 'var(--err)' : 'var(--peacock)', height: 10, borderRadius: 6, width: `${Math.min(pct, 1) * 100}%` }} /></div>
                  <span className="small muted">{(pct * 100).toFixed(0)} %</span></>}</td>
              </tr>);
          })}</tbody>
        </table></div>
        <p className="small muted" style={{ marginTop: 8 }}>Escribe el monto y sal de la casilla para guardarlo.</p>
      </div>
      <div className="card">
        <div className="acciones" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Gastos</h2>
          <select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Filtrar por categoría">
            <option value="">Todas las categorías</option>{categorias.map((c) => <option key={c}>{c}</option>)}
          </select>
        </div>
        {visibles.length === 0 ? <p className="muted">Sin gastos registrados.</p> : (
          <div className="tabla-wrap"><table>
            <thead><tr><th>Fecha</th><th>Categoría</th><th>Descripción</th><th>Proveedor</th><th className="num">Monto</th><th>Fondo</th><th>Responsable</th></tr></thead>
            <tbody>{visibles.map((g) => (
              <tr key={g.id} style={{ cursor: 'pointer' }} onClick={() => setEdit(g)}>
                <td>{fechaCorta(g.fecha)}</td><td>{g.categoria}</td><td>{g.descripcion}</td><td>{g.proveedor}</td>
                <td className="num">{usd(g.monto)}</td><td>{FONDOS[g.fondo]}</td><td>{g.responsable}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
      {edit && <FormGasto inicial={edit} categorias={categorias} onCerrar={() => setEdit(null)} onGuardado={(m) => { setEdit(null); aviso(m); recargar(); }} />}
    </>
  );
}

function FormGasto({ inicial, categorias, onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState({
    fecha: new Date().toISOString().slice(0, 10), categoria: categorias[0] || 'Otros', descripcion: '', proveedor: '', monto: '',
    metodo: 'Pago móvil', referencia: '', fondo: 'mensualidades', responsable: '', monto_bs: '', tasa: '', notas: '', ...inicial
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault();
    try {
      const { id, creado_en, ...resto } = f;
      const datos = limpiar({ ...resto, monto: Number(f.monto), monto_bs: f.monto_bs === '' || f.monto_bs == null ? '' : Number(f.monto_bs), tasa: f.tasa === '' || f.tasa == null ? '' : Number(f.tasa) });
      if (id) ok(await supabase.from('gastos').update(datos).eq('id', id));
      else ok(await supabase.from('gastos').insert(datos));
      onGuardado('Gasto guardado.');
    } catch (err) { aviso(err.message, 'err'); }
  }
  async function eliminar() {
    if (!confirm('¿Eliminar este gasto?')) return;
    try { ok(await supabase.from('gastos').delete().eq('id', f.id)); onGuardado('Gasto eliminado.'); } catch (err) { aviso(err.message, 'err'); }
  }
  return (
    <Modal titulo={f.id ? 'Editar gasto' : 'Registrar gasto'} onCerrar={onCerrar}>
      <form className="f" onSubmit={guardar}>
        <div className="fila">
          <Campo label="Fecha"><input type="date" required value={f.fecha} onChange={set('fecha')} /></Campo>
          <Campo label="Categoría"><select value={f.categoria} onChange={set('categoria')}>{categorias.map((c) => <option key={c}>{c}</option>)}</select></Campo>
          <Campo label="Monto (USD)"><input type="number" min="0.01" step="0.01" required value={f.monto} onChange={set('monto')} /></Campo>
        </div>
        <Campo label="Descripción"><input required value={f.descripcion} onChange={set('descripcion')} /></Campo>
        <div className="fila">
          <Campo label="Proveedor"><input value={f.proveedor || ''} onChange={set('proveedor')} /></Campo>
          <Campo label="Método"><select value={f.metodo || ''} onChange={set('metodo')}>{METODOS.map((m) => <option key={m}>{m}</option>)}</select></Campo>
          <Campo label="Referencia o comprobante"><input value={f.referencia || ''} onChange={set('referencia')} /></Campo>
        </div>
        <div className="fila">
          <Campo label="Fondo"><select value={f.fondo} onChange={set('fondo')}>{Object.entries(FONDOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          <Campo label="Responsable"><input value={f.responsable || ''} onChange={set('responsable')} /></Campo>
          <Campo label="Monto en Bs (opcional)"><input type="number" min="0" step="0.01" value={f.monto_bs ?? ''} onChange={set('monto_bs')} /></Campo>
          <Campo label="Tasa Bs/USD (opcional)"><input type="number" min="0" step="0.0001" value={f.tasa ?? ''} onChange={set('tasa')} /></Campo>
        </div>
        <Campo label="Notas"><textarea value={f.notas || ''} onChange={set('notas')} /></Campo>
        <div className="acciones">
          <button className="btn prim">Guardar</button>
          {f.id && <button type="button" className="btn peligro" onClick={eliminar}>Eliminar</button>}
        </div>
      </form>
    </Modal>
  );
}
