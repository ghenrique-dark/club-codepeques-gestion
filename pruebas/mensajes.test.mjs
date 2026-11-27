// Pruebas de la lógica de mensajes. Ejecutar con: npm run probar-mensajes
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agruparFamilias, construirMensaje, normalizarTelefono, cuotaDe, mesTexto, mesDeCorte, resumenUnaLinea } from '../shared/mensajes.js';

const config = {
  nombre_club: 'Club de Ingeniería Codepeques', firma: 'Firma', zona_horaria: 'America/Caracas',
  cuota_activo: 70, cuota_egresado: 140, cuota_regimen_especial: 0, datos_pago: 'Pago móvil X',
  plantilla_mensaje: 'Hola, {representante}. {estudiantes} al {fecha}.\n{detalle}\n{cierre}\n{firma}',
  texto_solicitud_pago: 'Saldo: {saldo} USD. {datos_pago}', texto_al_dia: 'Al día.'
};
const est = [
  { id: 'a', nombre: 'Pablo', estatus: 'activo', representante: 'Carmen', telefono: '0414-1111111', correo: '' },
  { id: 'b', nombre: 'Sofía', estatus: 'activo', representante: 'Carmen', telefono: '0414 111 1111', correo: 'm@x.com' },
  { id: 'c', nombre: 'Mateo', estatus: 'egresado', representante: 'Elena', telefono: '0412-2222222', correo: '' },
  { id: 'd', nombre: 'Ana', estatus: 'regimen_especial', representante: 'Rosa', telefono: '', correo: 'rosa@x.com' }
];
const cargos = [
  { estudiante_id: 'a', mes: '2026-10-01', saldo: 70, vencido: true },
  { estudiante_id: 'b', mes: '2026-10-01', saldo: 0, vencido: false },
  { estudiante_id: 'c', mes: '2026-11-01', saldo: 140, vencido: false },
  { estudiante_id: 'c', mes: '2026-12-01', saldo: 140, vencido: false },
  { estudiante_id: 'd', mes: '2026-11-01', saldo: 0, vencido: false }
];

test('cuotas por estatus: 70 / 140 / 0', () => {
  assert.equal(cuotaDe('activo', config), 70);
  assert.equal(cuotaDe('egresado', config), 140);
  assert.equal(cuotaDe('regimen_especial', config), 0);
});

test('teléfonos venezolanos a formato internacional', () => {
  assert.equal(normalizarTelefono('0414-3333333'), '584143333333');
  assert.equal(normalizarTelefono('+58 412 4444444'), '584124444444');
  assert.equal(normalizarTelefono(''), '');
});

test('hermanos con el mismo teléfono forman una sola familia', () => {
  const f = agruparFamilias(est, cargos, { corte: '2026-11-01' });
  const mayli = f.find((x) => x.representante === 'Carmen');
  assert.equal(mayli.estudiantes.length, 2);
  assert.equal(mayli.saldo, 70);
  assert.equal(mayli.correo, 'm@x.com');
  assert.equal(mayli.vencido, true);
});

test('el mes de corte excluye mensualidades futuras', () => {
  const f = agruparFamilias(est, cargos, { corte: '2026-11-01' });
  assert.equal(f.find((x) => x.representante === 'Elena').saldo, 140);
});

test('mensaje con saldo incluye la solicitud de pago; al día no', () => {
  const f = agruparFamilias(est, cargos, { corte: '2026-11-01' });
  const m1 = construirMensaje(f.find((x) => x.representante === 'Elena'), config, { fecha: '2026-11-24T12:00:00Z' });
  assert.match(m1, /Saldo: 140\.00 USD\. Pago móvil X/);
  assert.match(m1, /Mateo \(Egresado, 140\.00 USD al mes\): pendiente noviembre de 2026/);
  assert.match(m1, /24 de noviembre de 2026/);
  const m2 = construirMensaje(f.find((x) => x.representante === 'Rosa'), config);
  assert.match(m2, /exonerado/);
  assert.match(m2, /Al día\./);
});

test('resumen de una línea para plantillas de WhatsApp (sin saltos de línea)', () => {
  const f = agruparFamilias(est, cargos, { corte: '2026-11-01' });
  const r = resumenUnaLinea(f.find((x) => x.representante === 'Carmen'), config);
  assert.ok(!r.includes('\n'));
  assert.match(r, /Pablo: octubre de 2026 \(70\.00 USD\); Sofía: al día/);
});

test('fechas', () => {
  assert.equal(mesTexto('2026-09-01'), 'septiembre de 2026');
  assert.equal(mesDeCorte('2026-12-01T02:00:00Z', 'America/Caracas'), '2026-11-01'); // aún es 30 nov en Caracas
});
