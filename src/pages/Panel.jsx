import { supabase } from '../supabase.js';
import { useConsulta, ok, cargarConfig } from '../lib/datos.js';
import { usd } from '../lib/ui.jsx';
import { agruparFamilias, mesTexto } from '../../shared/mensajes.js';
import { Link } from 'react-router-dom';

export default function Panel() {
  const { datos, error, cargando } = useConsulta(async () => {
    await supabase.rpc('asegurar_cargos');
    const [res, mensual, est, cargos, config] = await Promise.all([
      supabase.from('v_resumen').select('*').single().then(ok),
      supabase.from('v_resumen_mensual').select('*').then(ok),
      supabase.from('estudiantes').select('*').is('fecha_retiro', null).then(ok),
      supabase.from('v_cargos').select('*').then(ok),
      cargarConfig()
    ]);
    const familias = agruparFamilias(est, cargos).filter((f) => f.saldo > 0).sort((a, b) => b.saldo - a.saldo);
    return { res, mensual, familias, config };
  });

  if (error) return <div className="aviso err">Error al cargar: {error}</div>;
  if (cargando && !datos) return <p className="muted">Cargando…</p>;
  const { res, mensual, familias } = datos;
  const caja = Number(res.cobrado) + Number(res.patrocinio_dinero) - Number(res.gastos);
  const pct = Number(res.facturado) > 0 ? (Number(res.cobrado) / Number(res.facturado)) * 100 : 0;

  const kpis = [
    ['Estudiantes', `${res.activos} ${res.activos === 1 ? 'activo' : 'activos'} · ${res.egresados} ${res.egresados === 1 ? 'egresado' : 'egresados'} · ${res.regimen_especial} en régimen especial`, false, true],
    ['Ingreso mensual previsto', usd(res.ingreso_mensual_previsto)],
    ['Facturado (desde sep. 2026)', usd(res.facturado)],
    ['Cobrado', usd(res.cobrado)],
    ['Por cobrar', usd(res.por_cobrar)],
    ['Vencido', usd(res.vencido)],
    ['% de cobranza', pct.toFixed(1) + ' %'],
    ['Patrocinio recibido (dinero)', usd(res.patrocinio_dinero)],
    ['Aportes en especie', usd(res.patrocinio_especie)],
    ['Gastos', usd(res.gastos)],
    ['Caja disponible', usd(caja), true]
  ];
  const maximo = Math.max(1, ...mensual.map((m) => Number(m.facturado)));

  return (
    <>
      <div className="head">
        <div><h1>Panel</h1><p className="muted">Situación financiera del Club al día de hoy.</p></div>
        <div className="acciones">
          <Link className="btn prim" to="/pagos">Registrar un pago</Link>
          <Link className="btn" to="/notificaciones">Programar notificación</Link>
        </div>
      </div>
      <div className="grid kpis" style={{ marginBottom: 18 }}>
        {kpis.map(([t, v, dest, chico]) => (
          <div key={t} className={'kpi' + (dest ? ' destacado' : '')}>
            <span>{t}</span><b style={chico ? { fontSize: 15, fontWeight: 600 } : undefined}>{v}</b>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Mes a mes</h2>
        <div className="tabla-wrap">
          <table>
            <thead><tr><th>Mes</th><th className="num">Facturado</th><th className="num">Cobrado</th><th className="num">Pendiente</th><th className="num">Gastos</th><th style={{ width: '35%' }}>Cobranza</th></tr></thead>
            <tbody>
              {mensual.map((m) => {
                const p = Number(m.facturado) ? Number(m.cobrado) / Number(m.facturado) : 0;
                return (
                  <tr key={m.mes}>
                    <td>{mesTexto(m.mes)}</td>
                    <td className="num">{usd(m.facturado)}</td>
                    <td className="num">{usd(m.cobrado)}</td>
                    <td className="num">{usd(m.pendiente)}</td>
                    <td className="num">{usd(m.gastos)}</td>
                    <td>
                      <div style={{ background: 'var(--panel-2)', borderRadius: 6, height: 14, width: `${(Number(m.facturado) / maximo) * 100}%`, minWidth: 40 }}>
                        <div style={{ background: 'var(--peacock)', height: 14, borderRadius: 6, width: `${p * 100}%` }} />
                      </div>
                      <span className="small muted">{(p * 100).toFixed(0)} % cobrado</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>Familias con saldo pendiente ({familias.length})</h2>
        {familias.length === 0 ? <p className="muted">Nadie tiene saldo pendiente.</p> : (
          <div className="tabla-wrap"><table>
            <thead><tr><th>Representante</th><th>Estudiantes</th><th className="num">Saldo</th><th>Estado</th></tr></thead>
            <tbody>{familias.map((f) => (
              <tr key={f.clave}>
                <td>{f.representante}</td>
                <td>{f.estudiantes.map((e) => e.nombre).join(', ')}</td>
                <td className="num">{usd(f.saldo)}</td>
                <td><span className={'etq ' + (f.vencido ? 'vencido' : 'pendiente')}>{f.vencido ? 'vencido' : 'por vencer'}</span></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </div>
    </>
  );
}
