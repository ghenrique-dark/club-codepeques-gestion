import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { configurado, supabase } from './supabase.js';
import { AvisoProvider } from './lib/ui.jsx';
import Login from './pages/Login.jsx';
import Panel from './pages/Panel.jsx';
import Estudiantes from './pages/Estudiantes.jsx';
import Pagos from './pages/Pagos.jsx';
import Notificaciones from './pages/Notificaciones.jsx';
import Patrocinantes from './pages/Patrocinantes.jsx';
import Gastos from './pages/Gastos.jsx';
import Configuracion from './pages/Configuracion.jsx';

const MENU = [
  ['/', 'Panel'],
  ['/estudiantes', 'Estudiantes'],
  ['/pagos', 'Mensualidades y pagos'],
  ['/notificaciones', 'Notificaciones'],
  ['/patrocinantes', 'Patrocinantes'],
  ['/gastos', 'Gastos y presupuesto'],
  ['/configuracion', 'Configuración']
];

export default function App() {
  const [sesion, setSesion] = useState(undefined);
  const [esAdmin, setEsAdmin] = useState(null);
  const [recuperando, setRecuperando] = useState(false);
  const [errorAcceso, setErrorAcceso] = useState('');

  useEffect(() => {
    if (!configurado) return;
    supabase.auth.getSession().then(({ data }) => setSesion(data.session));
    const { data } = supabase.auth.onAuthStateChange((evento, s) => {
      setSesion(s);
      if (evento === 'PASSWORD_RECOVERY') setRecuperando(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) { setEsAdmin(null); return; }
    supabase.from('admins').select('user_id').eq('user_id', sesion.user.id).maybeSingle()
      .then(({ data, error }) => {
        if (error) { setErrorAcceso([error.code, error.message, error.hint].filter(Boolean).join(' · ')); setEsAdmin('error'); return; }
        setEsAdmin(Boolean(data));
        // crea las mensualidades que falten hasta el mes actual
        if (data) supabase.rpc('asegurar_cargos');
      });
  }, [sesion]);

  if (!configurado) {
    return (
      <div className="login"><div className="card">
        <h2>Falta la configuración</h2>
        <p>Crea el archivo <code>.env</code> con <code>VITE_SUPABASE_URL</code> y <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (ver README) y reinicia el servidor.</p>
      </div></div>
    );
  }
  if (sesion === undefined) return null;
  if (sesion && recuperando) return <NuevaClave onListo={() => setRecuperando(false)} />;
  if (!sesion) return <AvisoProvider><Login /></AvisoProvider>;
  if (esAdmin === null) return null;
  if (esAdmin === 'error') {
    return (
      <div className="login"><div className="card">
        <h2>No se pudo conectar</h2>
        <p>No fue posible verificar tu acceso con la base de datos.</p>
        {/permission denied|42501/i.test(errorAcceso) && (
          <div className="aviso warn">Faltan los permisos de las tablas en Supabase. Ejecuta el archivo <code>supabase/permisos.sql</code> en el SQL Editor de Supabase (ver README).</div>
        )}
        {/admins|PGRST205|does not exist/i.test(errorAcceso) && !/permission denied/i.test(errorAcceso) && (
          <div className="aviso warn">La base de datos no tiene las tablas del sistema. Ejecuta <code>supabase/schema.sql</code> en el SQL Editor de Supabase.</div>
        )}
        {errorAcceso && <p className="small muted">Detalle técnico: {errorAcceso}</p>}
        <div className="acciones">
          <button className="btn prim" onClick={() => window.location.reload()}>Reintentar</button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
        </div>
      </div></div>
    );
  }
  if (!esAdmin) {
    return (
      <div className="login"><div className="card">
        <h2>Sin permiso</h2>
        <p>La cuenta <b>{sesion.user.email}</b> no está registrada como administradora del sistema.</p>
        <p className="muted small">Un administrador debe agregarla a la tabla <code>admins</code> en Supabase (ver README).</p>
        <button className="btn" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
      </div></div>
    );
  }

  return (
    <AvisoProvider>
      <div className="app">
        <nav className="side" aria-label="Menú principal">
          <div className="brand">
            <img src="/favicon.svg" alt="" />
            <div><b>Club de Ingeniería Codepeques</b><span>Gestión administrativa</span></div>
          </div>
          {MENU.map(([to, t]) => <NavLink key={to} to={to} end={to === '/'}>{t}</NavLink>)}
          <div className="foot">
            {sesion.user.email}
            <button className="btn sm" onClick={() => supabase.auth.signOut()}>Cerrar sesión</button>
          </div>
        </nav>
        <main className="main">
          <Routes>
            <Route path="/" element={<Panel />} />
            <Route path="/estudiantes" element={<Estudiantes />} />
            <Route path="/pagos" element={<Pagos />} />
            <Route path="/notificaciones" element={<Notificaciones />} />
            <Route path="/patrocinantes" element={<Patrocinantes />} />
            <Route path="/gastos" element={<Gastos />} />
            <Route path="/configuracion" element={<Configuracion />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
      </div>
    </AvisoProvider>
  );
}

function NuevaClave({ onListo }) {
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  async function guardar(e) {
    e.preventDefault();
    if (clave.length < 8) { setError('Usa al menos 8 caracteres.'); return; }
    const { error } = await supabase.auth.updateUser({ password: clave });
    if (error) setError(error.message); else onListo();
  }
  return (
    <div className="login">
      <form className="card f" onSubmit={guardar}>
        <h2>Nueva contraseña</h2>
        {error && <div className="aviso err">{error}</div>}
        <label className="c">Contraseña nueva
          <input type="password" autoComplete="new-password" value={clave} onChange={(e) => setClave(e.target.value)} />
        </label>
        <button className="btn prim">Guardar</button>
      </form>
    </div>
  );
}
