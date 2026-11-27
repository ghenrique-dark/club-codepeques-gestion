import { useState } from 'react';
import { supabase } from '../supabase.js';
import { useConsulta, ok, urlLogo } from '../lib/datos.js';
import { Campo, Etiqueta, Modal, limpiar, usd, useAviso, fechaCorta } from '../lib/ui.jsx';

const ESTADOS = { prospecto: 'Prospecto', contactado: 'Contactado', negociando: 'Negociando', activo: 'Activo', finalizado: 'Finalizado', no_acepto: 'No aceptó' };
const TIPOS = { empresa: 'Empresa', persona: 'Persona', institucion: 'Institución', fundacion: 'Fundación' };
const APORTE = { dinero: 'Dinero', especie: 'Especie', servicio: 'Servicio', mixto: 'Mixto' };
const FORMA = { unico: 'Pago único', mensual: 'Mensual', cuotas: 'En cuotas', especie: 'En especie' };
const VACIO = { nombre: '', tipo: 'empresa', rif: '', contacto: '', telefono: '', correo: '', sitio_web: '', estado: 'prospecto', destino: 'team', notas: '', logo_path: null };

function nombreArchivo(file) {
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  return `${crypto.randomUUID()}.${ext}`;
}

export default function Patrocinantes() {
  const aviso = useAviso();
  const [edit, setEdit] = useState(null);
  const [detalle, setDetalle] = useState(null);
  const { datos, error, recargar } = useConsulta(async () => {
    const [lista, contratos, aportes] = await Promise.all([
      supabase.from('patrocinantes').select('*').order('nombre').then(ok),
      supabase.from('contratos_patrocinio').select('patrocinante_id,monto_comprometido,estado').then(ok),
      supabase.from('aportes').select('patrocinante_id,monto,tipo').then(ok)
    ]);
    return { lista, contratos, aportes };
  });

  if (error) return <div className="aviso err">{error}</div>;
  if (!datos) return <p className="muted">Cargando…</p>;
  const { lista, contratos, aportes } = datos;
  const comprometido = (id) => contratos.filter((c) => c.patrocinante_id === id && c.estado !== 'cancelado').reduce((s, c) => s + Number(c.monto_comprometido), 0);
  const recibido = (id) => aportes.filter((a) => a.patrocinante_id === id).reduce((s, a) => s + Number(a.monto), 0);
  const totC = lista.reduce((s, p) => s + comprometido(p.id), 0);
  const totR = lista.reduce((s, p) => s + recibido(p.id), 0);

  return (
    <>
      <div className="head">
        <div><h1>Patrocinantes del Team</h1>
          <p className="muted">Comprometido en contratos: <b>{usd(totC)}</b> · Recibido: <b>{usd(totR)}</b> · Por recibir: <b>{usd(Math.max(totC - totR, 0))}</b></p></div>
        <button className="btn prim" onClick={() => setEdit({ ...VACIO })}>Agregar patrocinante</button>
      </div>
      {lista.length === 0 ? <div className="card"><p className="muted">Aún no hay patrocinantes. Registra también los prospectos para dar seguimiento a cada contacto.</p></div> : (
        <div className="grid sponsors">
          {lista.map((p) => (
            <div key={p.id} className="sponsor" onClick={() => setDetalle(p)} role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && setDetalle(p)}>
              <div className="logo">{p.logo_path ? <img src={urlLogo(p.logo_path)} alt={`Logo de ${p.nombre}`} /> : 'Sin logo'}</div>
              <b>{p.nombre}</b>
              <div className="acciones"><Etiqueta valor={p.estado} texto={ESTADOS[p.estado]} /><span className="small muted">{TIPOS[p.tipo]} · {p.destino === 'team' ? 'Team 21570' : 'Club'}</span></div>
              <div className="small">Comprometido {usd(comprometido(p.id))}<br />Recibido {usd(recibido(p.id))}</div>
            </div>
          ))}
        </div>
      )}
      {edit && <FormPatrocinante inicial={edit} onCerrar={() => setEdit(null)} onGuardado={(m) => { setEdit(null); aviso(m); recargar(); }} />}
      {detalle && <Detalle p={detalle} onCerrar={() => { setDetalle(null); recargar(); }}
        onEditar={() => { setEdit(detalle); setDetalle(null); }} />}
    </>
  );
}

function FormPatrocinante({ inicial, onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState(inicial);
  const [logo, setLogo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const nuevo = !inicial.id;

  async function guardar(e) {
    e.preventDefault();
    setGuardando(true);
    try {
      let logo_path = f.logo_path;
      if (logo) {
        if (logo.size > 2 * 1024 * 1024) throw new Error('El logo pesa más de 2 MB.');
        const ruta = nombreArchivo(logo);
        ok(await supabase.storage.from('logos').upload(ruta, logo, { contentType: logo.type }));
        if (f.logo_path) await supabase.storage.from('logos').remove([f.logo_path]);
        logo_path = ruta;
      }
      const { id, creado_en, ...resto } = f;
      const datos = limpiar({ ...resto, logo_path });
      if (nuevo) ok(await supabase.from('patrocinantes').insert(datos));
      else ok(await supabase.from('patrocinantes').update(datos).eq('id', id));
      onGuardado('Patrocinante guardado.');
    } catch (err) { aviso('No se pudo guardar: ' + err.message, 'err'); }
    setGuardando(false);
  }

  async function eliminar() {
    if (!confirm(`¿Eliminar a ${inicial.nombre} con sus contratos y aportes?`)) return;
    try {
      if (inicial.logo_path) await supabase.storage.from('logos').remove([inicial.logo_path]);
      ok(await supabase.from('patrocinantes').delete().eq('id', inicial.id));
      onGuardado('Patrocinante eliminado.');
    } catch (err) { aviso(err.message, 'err'); }
  }

  return (
    <Modal titulo={nuevo ? 'Agregar patrocinante' : `Editar: ${inicial.nombre}`} onCerrar={onCerrar}>
      <form className="f" onSubmit={guardar}>
        <div className="fila">
          <Campo label="Nombre o razón social"><input required value={f.nombre} onChange={set('nombre')} /></Campo>
          <Campo label="Tipo"><select value={f.tipo} onChange={set('tipo')}>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          <Campo label="RIF"><input value={f.rif || ''} onChange={set('rif')} /></Campo>
        </div>
        <div className="fila">
          <Campo label="Persona de contacto"><input value={f.contacto || ''} onChange={set('contacto')} /></Campo>
          <Campo label="Teléfono"><input value={f.telefono || ''} onChange={set('telefono')} /></Campo>
          <Campo label="Correo"><input type="email" value={f.correo || ''} onChange={set('correo')} /></Campo>
        </div>
        <div className="fila">
          <Campo label="Sitio web o red social"><input value={f.sitio_web || ''} onChange={set('sitio_web')} /></Campo>
          <Campo label="Estado"><select value={f.estado} onChange={set('estado')}>{Object.entries(ESTADOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          <Campo label="Destino"><select value={f.destino} onChange={set('destino')}><option value="team">Team 21570</option><option value="club">Club</option></select></Campo>
        </div>
        <Campo label="Logo (PNG, JPG, SVG o WebP, máximo 2 MB)">
          <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={(e) => setLogo(e.target.files[0] || null)} />
        </Campo>
        {f.logo_path && !logo && <div className="logo" style={{ maxWidth: 260 }}><img src={urlLogo(f.logo_path)} alt="Logo actual" /></div>}
        <Campo label="Notas"><textarea value={f.notas || ''} onChange={set('notas')} /></Campo>
        <div className="acciones">
          <button className="btn prim" disabled={guardando}>{guardando ? 'Guardando…' : 'Guardar'}</button>
          {!nuevo && <button type="button" className="btn peligro" onClick={eliminar}>Eliminar</button>}
        </div>
      </form>
    </Modal>
  );
}

function Detalle({ p, onCerrar, onEditar }) {
  const aviso = useAviso();
  const [contrato, setContrato] = useState(null);
  const [aporte, setAporte] = useState(null);
  const { datos, recargar } = useConsulta(async () => {
    const [contratos, aportes] = await Promise.all([
      supabase.from('contratos_patrocinio').select('*').eq('patrocinante_id', p.id).order('fecha_inicio', { ascending: false }).then(ok),
      supabase.from('aportes').select('*').eq('patrocinante_id', p.id).order('fecha', { ascending: false }).then(ok)
    ]);
    return { contratos, aportes };
  }, [p.id]);

  async function verArchivo(path) {
    const { data, error } = await supabase.storage.from('contratos').createSignedUrl(path, 300);
    if (error) aviso(error.message, 'err'); else window.open(data.signedUrl, '_blank', 'noopener');
  }
  async function borrarAporte(id) {
    if (!confirm('¿Eliminar este aporte?')) return;
    try { ok(await supabase.from('aportes').delete().eq('id', id)); recargar(); } catch (e) { aviso(e.message, 'err'); }
  }

  return (
    <Modal titulo={p.nombre} onCerrar={onCerrar} ancho>
      <div className="acciones" style={{ marginBottom: 14, justifyContent: 'space-between' }}>
        <div className="acciones">
          {p.logo_path && <div className="logo" style={{ width: 160, height: 70 }}><img src={urlLogo(p.logo_path)} alt={`Logo de ${p.nombre}`} /></div>}
          <div className="small">
            <Etiqueta valor={p.estado} texto={ESTADOS[p.estado]} /> {TIPOS[p.tipo]} {p.rif && `· RIF ${p.rif}`}<br />
            {[p.contacto, p.telefono, p.correo].filter(Boolean).join(' · ')}<br />
            {p.sitio_web && <a href={/^https?:/.test(p.sitio_web) ? p.sitio_web : `https://${p.sitio_web}`} target="_blank" rel="noreferrer">{p.sitio_web}</a>}
          </div>
        </div>
        <button className="btn" onClick={onEditar}>Editar datos y logo</button>
      </div>
      {p.notas && <p className="small muted">{p.notas}</p>}
      {!datos ? <p className="muted">Cargando…</p> : (
        <>
          <div className="head" style={{ marginBottom: 6 }}><h3>Contratos</h3><button className="btn sm prim" onClick={() => setContrato({})}>Agregar contrato</button></div>
          {datos.contratos.length === 0 ? <p className="muted small">Sin contratos.</p> : (
            <div className="tabla-wrap" style={{ marginBottom: 16 }}><table>
              <thead><tr><th>Contrato</th><th>Vigencia</th><th>Aporte</th><th className="num">Monto</th><th>Contrapartidas</th><th>Estado</th><th /></tr></thead>
              <tbody>{datos.contratos.map((c) => (
                <tr key={c.id}>
                  <td><b>{c.titulo}</b><div className="small muted">{FORMA[c.forma_pago]}</div></td>
                  <td className="small">{fechaCorta(c.fecha_inicio)}{c.fecha_fin && ` al ${fechaCorta(c.fecha_fin)}`}</td>
                  <td>{APORTE[c.tipo_aporte]}</td>
                  <td className="num">{usd(c.monto_comprometido)}</td>
                  <td className="small" style={{ maxWidth: 260 }}>{c.contrapartidas}</td>
                  <td><Etiqueta valor={c.estado} /></td>
                  <td><div className="acciones">
                    {c.archivo_path && <button className="btn sm" onClick={() => verArchivo(c.archivo_path)}>Ver archivo</button>}
                    <button className="btn sm" onClick={() => setContrato(c)}>Editar</button>
                  </div></td>
                </tr>))}
              </tbody>
            </table></div>
          )}
          <div className="head" style={{ marginBottom: 6 }}><h3>Aportes recibidos</h3><button className="btn sm prim" onClick={() => setAporte({})}>Registrar aporte</button></div>
          {datos.aportes.length === 0 ? <p className="muted small">Sin aportes registrados.</p> : (
            <div className="tabla-wrap"><table>
              <thead><tr><th>Fecha</th><th>Tipo</th><th className="num">Monto (USD)</th><th>Descripción</th><th>Referencia</th><th /></tr></thead>
              <tbody>{datos.aportes.map((a) => (
                <tr key={a.id}>
                  <td>{fechaCorta(a.fecha)}</td><td>{APORTE[a.tipo]}</td><td className="num">{usd(a.monto)}</td>
                  <td className="small">{a.descripcion}</td><td className="small">{a.referencia}</td>
                  <td><button className="btn sm peligro" onClick={() => borrarAporte(a.id)}>Eliminar</button></td>
                </tr>))}
              </tbody>
            </table></div>
          )}
        </>
      )}
      {contrato && <FormContrato p={p} inicial={contrato} onCerrar={() => setContrato(null)} onGuardado={() => { setContrato(null); aviso('Contrato guardado.'); recargar(); }} />}
      {aporte && <FormAporte p={p} contratos={datos?.contratos || []} onCerrar={() => setAporte(null)} onGuardado={() => { setAporte(null); aviso('Aporte registrado.'); recargar(); }} />}
    </Modal>
  );
}

function FormContrato({ p, inicial, onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState({
    titulo: '', fecha_inicio: '', fecha_fin: '', tipo_aporte: 'dinero', monto_comprometido: '', forma_pago: 'unico',
    contrapartidas: '', obligaciones: '', estado: 'borrador', notas: '', archivo_path: null, ...inicial
  });
  const [archivo, setArchivo] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault();
    try {
      let archivo_path = f.archivo_path;
      if (archivo) {
        if (archivo.size > 10 * 1024 * 1024) throw new Error('El archivo pesa más de 10 MB.');
        const ruta = `${p.id}/${nombreArchivo(archivo)}`;
        ok(await supabase.storage.from('contratos').upload(ruta, archivo, { contentType: archivo.type }));
        if (f.archivo_path) await supabase.storage.from('contratos').remove([f.archivo_path]);
        archivo_path = ruta;
      }
      const { id, creado_en, ...resto } = f;
      const datos = limpiar({ ...resto, archivo_path, patrocinante_id: p.id, monto_comprometido: Number(f.monto_comprometido || 0) });
      if (id) ok(await supabase.from('contratos_patrocinio').update(datos).eq('id', id));
      else ok(await supabase.from('contratos_patrocinio').insert(datos));
      onGuardado();
    } catch (err) { aviso('No se pudo guardar: ' + err.message, 'err'); }
  }
  async function eliminar() {
    if (!confirm('¿Eliminar este contrato?')) return;
    try {
      if (f.archivo_path) await supabase.storage.from('contratos').remove([f.archivo_path]);
      ok(await supabase.from('contratos_patrocinio').delete().eq('id', f.id));
      onGuardado();
    } catch (err) { aviso(err.message, 'err'); }
  }
  return (
    <Modal titulo={f.id ? 'Editar contrato' : 'Nuevo contrato'} onCerrar={onCerrar}>
      <form className="f" onSubmit={guardar}>
        <Campo label="Título del contrato"><input required value={f.titulo} onChange={set('titulo')} placeholder="Patrocinio temporada 2026–2027" /></Campo>
        <div className="fila">
          <Campo label="Inicio"><input type="date" value={f.fecha_inicio || ''} onChange={set('fecha_inicio')} /></Campo>
          <Campo label="Fin"><input type="date" value={f.fecha_fin || ''} onChange={set('fecha_fin')} /></Campo>
          <Campo label="Estado"><select value={f.estado} onChange={set('estado')}><option value="borrador">Borrador</option><option value="vigente">Vigente</option><option value="vencido">Vencido</option><option value="cancelado">Cancelado</option></select></Campo>
        </div>
        <div className="fila">
          <Campo label="Tipo de aporte"><select value={f.tipo_aporte} onChange={set('tipo_aporte')}>{Object.entries(APORTE).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
          <Campo label="Monto comprometido (USD; en especie, valor estimado)"><input type="number" min="0" step="0.01" value={f.monto_comprometido} onChange={set('monto_comprometido')} /></Campo>
          <Campo label="Forma de pago"><select value={f.forma_pago} onChange={set('forma_pago')}>{Object.entries(FORMA).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Campo>
        </div>
        <Campo label="Contrapartidas del Team (logo en camiseta, robot, redes, menciones…)"><textarea value={f.contrapartidas || ''} onChange={set('contrapartidas')} /></Campo>
        <Campo label="Obligaciones y condiciones del patrocinante"><textarea value={f.obligaciones || ''} onChange={set('obligaciones')} /></Campo>
        <Campo label="Archivo del contrato (PDF o imagen, máximo 10 MB, privado)">
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setArchivo(e.target.files[0] || null)} />
        </Campo>
        {f.archivo_path && !archivo && <p className="small muted">Ya hay un archivo cargado; si eliges otro, se reemplaza.</p>}
        <Campo label="Notas"><textarea value={f.notas || ''} onChange={set('notas')} /></Campo>
        <div className="acciones">
          <button className="btn prim">Guardar contrato</button>
          {f.id && <button type="button" className="btn peligro" onClick={eliminar}>Eliminar</button>}
        </div>
      </form>
    </Modal>
  );
}

function FormAporte({ p, contratos, onCerrar, onGuardado }) {
  const aviso = useAviso();
  const [f, setF] = useState({ fecha: new Date().toISOString().slice(0, 10), tipo: 'dinero', monto: '', descripcion: '', referencia: '', contrato_id: '' });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  async function guardar(e) {
    e.preventDefault();
    try {
      ok(await supabase.from('aportes').insert(limpiar({ ...f, patrocinante_id: p.id, monto: Number(f.monto) })));
      onGuardado();
    } catch (err) { aviso(err.message, 'err'); }
  }
  return (
    <Modal titulo={`Registrar aporte de ${p.nombre}`} onCerrar={onCerrar}>
      <form className="f" onSubmit={guardar}>
        <div className="fila">
          <Campo label="Fecha"><input type="date" required value={f.fecha} onChange={set('fecha')} /></Campo>
          <Campo label="Tipo"><select value={f.tipo} onChange={set('tipo')}><option value="dinero">Dinero</option><option value="especie">Especie</option><option value="servicio">Servicio</option></select></Campo>
          <Campo label="Monto en USD (en especie, valor estimado)"><input type="number" min="0" step="0.01" required value={f.monto} onChange={set('monto')} /></Campo>
        </div>
        <div className="fila">
          <Campo label="Contrato (opcional)"><select value={f.contrato_id} onChange={set('contrato_id')}><option value="">Sin contrato</option>{contratos.map((c) => <option key={c.id} value={c.id}>{c.titulo}</option>)}</select></Campo>
          <Campo label="Referencia"><input value={f.referencia} onChange={set('referencia')} /></Campo>
        </div>
        <Campo label="Descripción"><input value={f.descripcion} onChange={set('descripcion')} placeholder="Ej.: 4 motores goBILDA 312 RPM" /></Campo>
        <div><button className="btn prim">Registrar</button></div>
      </form>
    </Modal>
  );
}
