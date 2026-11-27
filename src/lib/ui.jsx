import { createContext, useCallback, useContext, useEffect, useState } from 'react';

export const usd = (n) =>
  (Number(n) || 0).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' USD';

export const fechaCorta = (iso) => {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
};

export const fechaHora = (iso) => (iso ? new Date(iso).toLocaleString('es-VE', { dateStyle: 'short', timeStyle: 'short' }) : '');

export function Modal({ titulo, onCerrar, children, ancho }) {
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onCerrar]);
  return (
    <div className="velo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className={'modal' + (ancho ? ' ancho' : '')} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-head">
          <h2 style={{ margin: 0 }}>{titulo}</h2>
          <button className="btn sm" onClick={onCerrar} aria-label="Cerrar">Cerrar</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Campo({ label, children }) {
  return <label className="c">{label}{children}</label>;
}

export function Etiqueta({ valor, texto }) {
  return <span className={'etq ' + valor}>{texto || String(valor).replace(/_/g, ' ')}</span>;
}

// Avisos flotantes
const AvisoCtx = createContext(() => {});
export function useAviso() { return useContext(AvisoCtx); }
export function AvisoProvider({ children }) {
  const [aviso, setAviso] = useState(null);
  const mostrar = useCallback((texto, tipo = 'ok') => {
    setAviso({ texto, tipo });
    setTimeout(() => setAviso(null), tipo === 'err' ? 7000 : 3500);
  }, []);
  return (
    <AvisoCtx.Provider value={mostrar}>
      {children}
      {aviso && <div className={'aviso toast ' + aviso.tipo} role="status">{aviso.texto}</div>}
    </AvisoCtx.Provider>
  );
}

/** Convierte "" en null antes de guardar */
export function limpiar(obj) {
  const o = {};
  for (const [k, v] of Object.entries(obj)) o[k] = v === '' ? null : v;
  return o;
}
