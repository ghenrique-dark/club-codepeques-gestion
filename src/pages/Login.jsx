import { useState } from 'react';
import { supabase } from '../supabase.js';

export default function Login() {
  const [correo, setCorreo] = useState('');
  const [clave, setClave] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [modo, setModo] = useState('entrar');
  const [mensaje, setMensaje] = useState('');

  async function entrar(e) {
    e.preventDefault();
    setEnviando(true); setError(''); setMensaje('');
    if (modo === 'entrar') {
      const { error } = await supabase.auth.signInWithPassword({ email: correo.trim(), password: clave });
      if (error) setError(error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message);
    } else {
      const { error } = await supabase.auth.resetPasswordForEmail(correo.trim(), { redirectTo: window.location.origin });
      if (error) setError(error.message); else setMensaje('Si el correo está registrado, recibirás un enlace para cambiar la contraseña.');
    }
    setEnviando(false);
  }

  return (
    <div className="login">
      <form className="card f" onSubmit={entrar}>
        <div className="logo-login"><img src="/favicon.svg" alt="" /></div>
        <h2 style={{ textAlign: 'center' }}>Club de Ingeniería Codepeques</h2>
        <p className="muted small" style={{ textAlign: 'center' }}>Acceso solo para administradores</p>
        {error && <div className="aviso err">{error}</div>}
        {mensaje && <div className="aviso ok">{mensaje}</div>}
        <label className="c">Correo
          <input type="email" autoComplete="username" required value={correo} onChange={(e) => setCorreo(e.target.value)} />
        </label>
        {modo === 'entrar' && (
          <label className="c">Contraseña
            <input type="password" autoComplete="current-password" required value={clave} onChange={(e) => setClave(e.target.value)} />
          </label>
        )}
        <button className="btn prim" disabled={enviando}>{modo === 'entrar' ? 'Entrar' : 'Enviar enlace'}</button>
        <button type="button" className="btn sm" onClick={() => { setModo(modo === 'entrar' ? 'recuperar' : 'entrar'); setError(''); setMensaje(''); }}>
          {modo === 'entrar' ? 'Olvidé mi contraseña' : 'Volver a iniciar sesión'}
        </button>
      </form>
    </div>
  );
}
