// Se ejecuta sola cada hora en Netlify y envía las programaciones cuya fecha ya llegó.
import { procesarPendientes } from '../lib/notificador.mjs';

export default async () => {
  try {
    const resultados = await procesarPendientes();
    console.log('Programaciones procesadas:', JSON.stringify(resultados));
    return new Response(JSON.stringify({ ok: true, resultados }), { headers: { 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('Error en envío programado:', e);
    return new Response(JSON.stringify({ ok: false, error: String(e.message || e) }), { status: 500 });
  }
};

export const config = { schedule: '@hourly' };
