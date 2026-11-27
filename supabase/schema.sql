-- =====================================================================
-- Club de Ingeniería Codepeques · Sistema de gestión
-- Esquema de base de datos para Supabase (PostgreSQL)
-- Ejecutar completo, una sola vez, en Supabase > SQL Editor > New query.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Administradores: solo los usuarios de esta tabla pueden usar el sistema
-- ---------------------------------------------------------------------
create table if not exists public.admins (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  nombre    text,
  creado_en timestamptz not null default now()
);

create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- ---------------------------------------------------------------------
-- Configuración general (una sola fila)
-- ---------------------------------------------------------------------
create table if not exists public.configuracion (
  id                       int primary key default 1 check (id = 1),
  nombre_club              text not null default 'Club de Ingeniería Codepeques',
  firma                    text not null default 'Club de Ingeniería Codepeques, by Team Codepeques 21570',
  cuota_activo             numeric(10,2) not null default 70  check (cuota_activo >= 0),
  cuota_egresado           numeric(10,2) not null default 140 check (cuota_egresado >= 0),
  cuota_regimen_especial   numeric(10,2) not null default 0   check (cuota_regimen_especial >= 0),
  mes_inicio               date not null default '2026-09-01',
  dia_limite               int  not null default 5 check (dia_limite between 1 and 28),
  zona_horaria             text not null default 'America/Caracas',
  datos_pago               text not null default '[Pago móvil: banco, teléfono y cédula] · [Zelle: correo y titular] · [Efectivo en la sede]',
  correo_admin             text,
  asunto_correo            text not null default 'Estado de cuenta – {club}',
  plantilla_mensaje        text not null default
    'Hola, {representante}. Le escribimos del {club} con el estado de cuenta de {estudiantes} al {fecha}.' || chr(10) || chr(10) ||
    '{detalle}' || chr(10) || chr(10) || '{cierre}' || chr(10) || chr(10) || '{firma}',
  texto_solicitud_pago     text not null default
    'Saldo pendiente total: {saldo} USD. Le agradecemos realizar el pago a la brevedad. Datos de pago: {datos_pago}. Si ya realizó el pago, por favor envíenos el comprobante para actualizar nuestro registro.',
  texto_al_dia             text not null default
    '¡Todo está al día! Muchas gracias por su apoyo al Club.',
  actualizado_en           timestamptz not null default now(),
  constraint mes_inicio_dia_1 check (extract(day from mes_inicio) = 1)
);
insert into public.configuracion (id) values (1) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Estudiantes
-- ---------------------------------------------------------------------
do $$ begin
  create type public.estatus_estudiante as enum ('activo', 'egresado', 'regimen_especial');
exception when duplicate_object then null; end $$;

create table if not exists public.estudiantes (
  id                    uuid primary key default gen_random_uuid(),
  codigo                text unique,
  nombre                text not null,
  edad                  int check (edad between 5 and 25),
  estatus               public.estatus_estudiante not null default 'activo',
  fecha_ingreso         date not null default '2026-09-01',
  fecha_retiro          date,                 -- primer mes en que ya NO se cobra
  representante         text not null,
  telefono              text,
  correo                text,
  fact_rif              text,
  fact_razon_social     text,
  cedula_representante  text,
  notas                 text,
  creado_en             timestamptz not null default now()
);

create or replace function public.cuota_para(e public.estatus_estudiante)
returns numeric
language sql
stable
set search_path = public
as $$
  select case e
           when 'activo'   then cuota_activo
           when 'egresado' then cuota_egresado
           else cuota_regimen_especial
         end
  from public.configuracion where id = 1;
$$;

-- ---------------------------------------------------------------------
-- Mensualidades (cargos) y pagos
-- ---------------------------------------------------------------------
create table if not exists public.cargos (
  id                  uuid primary key default gen_random_uuid(),
  estudiante_id       uuid not null references public.estudiantes (id) on delete cascade,
  mes                 date not null,
  monto               numeric(10,2) not null check (monto >= 0),
  estatus_al_generar  public.estatus_estudiante,
  nota                text,
  creado_en           timestamptz not null default now(),
  unique (estudiante_id, mes),
  constraint cargo_mes_dia_1 check (extract(day from mes) = 1),
  constraint cargo_desde_sep_2026 check (mes >= date '2026-09-01')
);

create table if not exists public.pagos (
  id             uuid primary key default gen_random_uuid(),
  estudiante_id  uuid not null references public.estudiantes (id) on delete cascade,
  mes            date not null,
  fecha_pago     date not null default current_date,
  monto          numeric(10,2) not null check (monto > 0),
  metodo         text,
  referencia     text,
  monto_bs       numeric(14,2),
  tasa           numeric(14,4),
  nota           text,
  registrado_por uuid default auth.uid(),
  creado_en      timestamptz not null default now(),
  constraint pago_mes_dia_1 check (extract(day from mes) = 1),
  constraint pago_desde_sep_2026 check (mes >= date '2026-09-01')
);
create index if not exists pagos_est_mes on public.pagos (estudiante_id, mes);

-- Crea las mensualidades que falten, desde el mes de inicio hasta "hasta",
-- según el estatus actual de cada estudiante. No toca las que ya existen.
create or replace function public.asegurar_cargos(hasta date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz     text;
  v_hasta  date;
  v_inicio date;
  n        int;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'No autorizado';
  end if;
  select zona_horaria, mes_inicio into v_tz, v_inicio from configuracion where id = 1;
  v_hasta := date_trunc('month', coalesce(hasta, (now() at time zone v_tz)::date))::date;

  insert into cargos (estudiante_id, mes, monto, estatus_al_generar)
  select e.id, m.mes::date, public.cuota_para(e.estatus), e.estatus
  from estudiantes e
  cross join lateral generate_series(
           greatest(v_inicio, date_trunc('month', e.fecha_ingreso)::date),
           v_hasta, interval '1 month') as m(mes)
  where e.fecha_retiro is null or m.mes::date < date_trunc('month', e.fecha_retiro)::date
  on conflict (estudiante_id, mes) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;
revoke execute on function public.asegurar_cargos(date) from public, anon;
grant execute on function public.asegurar_cargos(date) to authenticated, service_role;

-- Vista con lo pagado, el saldo y el estado de cada mensualidad
create or replace view public.v_cargos
with (security_invoker = true) as
with cfg as (select dia_limite, zona_horaria from public.configuracion where id = 1),
pag as (select estudiante_id, mes, sum(monto) as pagado from public.pagos group by 1, 2)
select
  c.id, c.estudiante_id, c.mes, c.monto, c.estatus_al_generar, c.nota,
  e.codigo, e.nombre, e.estatus, e.representante, e.telefono, e.correo,
  coalesce(p.pagado, 0)::numeric(10,2)                          as pagado,
  greatest(c.monto - coalesce(p.pagado, 0), 0)::numeric(10,2)   as saldo,
  (c.mes + (cfg.dia_limite - 1))                                as vence,
  (c.monto - coalesce(p.pagado, 0) > 0
     and (now() at time zone cfg.zona_horaria)::date > c.mes + (cfg.dia_limite - 1)) as vencido,
  case
    when c.monto = 0                              then 'exonerado'
    when c.monto - coalesce(p.pagado, 0) <= 0     then 'pagado'
    when coalesce(p.pagado, 0) > 0                then 'parcial'
    when (now() at time zone cfg.zona_horaria)::date > c.mes + (cfg.dia_limite - 1) then 'vencido'
    else 'pendiente'
  end as estado
from public.cargos c
join public.estudiantes e on e.id = c.estudiante_id
cross join cfg
left join pag p on p.estudiante_id = c.estudiante_id and p.mes = c.mes;

-- ---------------------------------------------------------------------
-- Patrocinantes, contratos y aportes
-- ---------------------------------------------------------------------
create table if not exists public.patrocinantes (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null,
  tipo        text not null default 'empresa' check (tipo in ('empresa','persona','institucion','fundacion')),
  rif         text,
  contacto    text,
  telefono    text,
  correo      text,
  sitio_web   text,
  logo_path   text,
  estado      text not null default 'prospecto'
              check (estado in ('prospecto','contactado','negociando','activo','finalizado','no_acepto')),
  destino     text not null default 'team' check (destino in ('team','club')),
  notas       text,
  creado_en   timestamptz not null default now()
);

create table if not exists public.contratos_patrocinio (
  id                  uuid primary key default gen_random_uuid(),
  patrocinante_id     uuid not null references public.patrocinantes (id) on delete cascade,
  titulo              text not null,
  fecha_inicio        date,
  fecha_fin           date,
  tipo_aporte         text not null default 'dinero' check (tipo_aporte in ('dinero','especie','servicio','mixto')),
  monto_comprometido  numeric(12,2) not null default 0 check (monto_comprometido >= 0),
  forma_pago          text not null default 'unico' check (forma_pago in ('unico','mensual','cuotas','especie')),
  contrapartidas      text,
  obligaciones        text,
  estado              text not null default 'borrador' check (estado in ('borrador','vigente','vencido','cancelado')),
  archivo_path        text,
  notas               text,
  creado_en           timestamptz not null default now(),
  constraint fechas_contrato check (fecha_fin is null or fecha_inicio is null or fecha_fin >= fecha_inicio)
);

create table if not exists public.aportes (
  id               uuid primary key default gen_random_uuid(),
  patrocinante_id  uuid not null references public.patrocinantes (id) on delete cascade,
  contrato_id      uuid references public.contratos_patrocinio (id) on delete set null,
  fecha            date not null default current_date,
  tipo             text not null default 'dinero' check (tipo in ('dinero','especie','servicio')),
  monto            numeric(12,2) not null check (monto >= 0),
  descripcion      text,
  referencia       text,
  creado_en        timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Gastos y presupuesto
-- ---------------------------------------------------------------------
create table if not exists public.gastos (
  id           uuid primary key default gen_random_uuid(),
  fecha        date not null default current_date,
  categoria    text not null,
  descripcion  text not null,
  proveedor    text,
  monto        numeric(12,2) not null check (monto > 0),
  metodo       text,
  referencia   text,
  fondo        text not null default 'mensualidades' check (fondo in ('mensualidades','patrocinio','otro')),
  responsable  text,
  monto_bs     numeric(14,2),
  tasa         numeric(14,4),
  notas        text,
  creado_en    timestamptz not null default now()
);

create table if not exists public.presupuesto (
  categoria  text primary key,
  monto      numeric(12,2) not null default 0 check (monto >= 0)
);
insert into public.presupuesto (categoria) values
  ('Componentes del robot'), ('Herramientas'), ('Inscripciones y competencias'),
  ('Viajes y traslados'), ('Material didáctico'), ('Impresiones y papelería'),
  ('Camisetas y marketing'), ('Servicios (internet, VPN, software)'), ('Mantenimiento'), ('Otros')
on conflict (categoria) do nothing;

-- ---------------------------------------------------------------------
-- Notificaciones programadas y su registro
-- ---------------------------------------------------------------------
create table if not exists public.programaciones (
  id               uuid primary key default gen_random_uuid(),
  nombre           text not null,
  fecha_envio      timestamptz not null,
  alcance          text not null default 'todas' check (alcance in ('todas','solo_con_saldo')),
  canales          text[] not null default array['correo','whatsapp'],
  repetir_mensual  boolean not null default false,
  estado           text not null default 'pendiente'
                   check (estado in ('pendiente','procesando','enviada','con_errores','cancelada')),
  ejecutada_en     timestamptz,
  resumen          jsonb,
  creado_en        timestamptz not null default now(),
  constraint canales_validos check (canales <@ array['correo','whatsapp'] and cardinality(canales) > 0)
);

create table if not exists public.notificaciones (
  id               uuid primary key default gen_random_uuid(),
  programacion_id  uuid references public.programaciones (id) on delete cascade,
  canal            text not null check (canal in ('correo','whatsapp')),
  representante    text,
  destino          text,
  estudiantes      text,
  saldo            numeric(10,2),
  mensaje          text,
  estado           text not null check (estado in ('enviado','manual','sin_destino','error','omitido')),
  detalle          text,
  creado_en        timestamptz not null default now()
);
create index if not exists notif_prog on public.notificaciones (programacion_id);

-- Toma de forma segura las programaciones vencidas (evita envíos dobles)
create or replace function public.tomar_programaciones()
returns setof public.programaciones
language sql
security definer
set search_path = public
as $$
  update public.programaciones
     set estado = 'procesando'
   where id in (select id from public.programaciones
                 where estado = 'pendiente' and fecha_envio <= now()
                 order by fecha_envio
                 for update skip locked)
  returning *;
$$;
revoke execute on function public.tomar_programaciones() from public, anon, authenticated;
grant execute on function public.tomar_programaciones() to service_role;

-- ---------------------------------------------------------------------
-- Resúmenes para el panel
-- ---------------------------------------------------------------------
create or replace view public.v_resumen
with (security_invoker = true) as
select
  (select count(*) from public.estudiantes where fecha_retiro is null and estatus = 'activo')            as activos,
  (select count(*) from public.estudiantes where fecha_retiro is null and estatus = 'egresado')          as egresados,
  (select count(*) from public.estudiantes where fecha_retiro is null and estatus = 'regimen_especial')  as regimen_especial,
  (select coalesce(sum(public.cuota_para(estatus)), 0) from public.estudiantes where fecha_retiro is null) as ingreso_mensual_previsto,
  (select coalesce(sum(monto), 0)  from public.cargos)                     as facturado,
  (select coalesce(sum(monto), 0)  from public.pagos)                      as cobrado,
  (select coalesce(sum(saldo), 0)  from public.v_cargos)                   as por_cobrar,
  (select coalesce(sum(saldo), 0)  from public.v_cargos where vencido)     as vencido,
  (select coalesce(sum(monto), 0)  from public.aportes where tipo = 'dinero')   as patrocinio_dinero,
  (select coalesce(sum(monto), 0)  from public.aportes where tipo <> 'dinero')  as patrocinio_especie,
  (select coalesce(sum(monto_comprometido), 0) from public.contratos_patrocinio where estado in ('vigente','borrador')) as patrocinio_comprometido,
  (select coalesce(sum(monto), 0)  from public.gastos)                     as gastos;

create or replace view public.v_resumen_mensual
with (security_invoker = true) as
select
  c.mes,
  sum(c.monto)  as facturado,
  sum(c.pagado) as cobrado,
  sum(c.saldo)  as pendiente,
  (select coalesce(sum(g.monto), 0) from public.gastos g
    where date_trunc('month', g.fecha) = c.mes) as gastos
from public.v_cargos c
group by c.mes
order by c.mes;

-- ---------------------------------------------------------------------
-- Seguridad: Row Level Security (solo administradores)
-- ---------------------------------------------------------------------
alter table public.admins               enable row level security;
alter table public.configuracion        enable row level security;
alter table public.estudiantes          enable row level security;
alter table public.cargos               enable row level security;
alter table public.pagos                enable row level security;
alter table public.patrocinantes        enable row level security;
alter table public.contratos_patrocinio enable row level security;
alter table public.aportes              enable row level security;
alter table public.gastos               enable row level security;
alter table public.presupuesto          enable row level security;
alter table public.programaciones       enable row level security;
alter table public.notificaciones       enable row level security;

drop policy if exists "admin ve su fila" on public.admins;
create policy "admin ve su fila" on public.admins for select to authenticated using (user_id = auth.uid());

do $$
declare t text;
begin
  foreach t in array array['configuracion','estudiantes','cargos','pagos','patrocinantes',
                           'contratos_patrocinio','aportes','gastos','presupuesto',
                           'programaciones','notificaciones']
  loop
    execute format('drop policy if exists "solo admins" on public.%I', t);
    execute format('create policy "solo admins" on public.%I for all to authenticated using (public.es_admin()) with check (public.es_admin())', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Almacenamiento: logos (públicos) y contratos (privados)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values ('logos', 'logos', true)
  on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('contratos', 'contratos', false)
  on conflict (id) do nothing;

drop policy if exists "admins suben archivos" on storage.objects;
create policy "admins suben archivos" on storage.objects for insert to authenticated
  with check (bucket_id in ('logos', 'contratos') and public.es_admin());
drop policy if exists "admins editan archivos" on storage.objects;
create policy "admins editan archivos" on storage.objects for update to authenticated
  using (bucket_id in ('logos', 'contratos') and public.es_admin());
drop policy if exists "admins borran archivos" on storage.objects;
create policy "admins borran archivos" on storage.objects for delete to authenticated
  using (bucket_id in ('logos', 'contratos') and public.es_admin());
drop policy if exists "admins leen contratos" on storage.objects;
create policy "admins leen contratos" on storage.objects for select to authenticated
  using (bucket_id in ('logos', 'contratos') and public.es_admin());

-- ---------------------------------------------------------------------
-- PERMISOS EXPLÍCITOS (necesarios en proyectos de Supabase creados desde 2026)
-- ---------------------------------------------------------------------
grant usage on schema public to authenticated, service_role;

-- Tablas y vistas: usuarios con sesión (filtrados por RLS) y funciones de envío
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;

-- Funciones usadas por las reglas de seguridad y por la web
grant execute on function public.es_admin() to authenticated, service_role;
grant execute on function public.cuota_para(public.estatus_estudiante) to authenticated, service_role;
grant execute on function public.asegurar_cargos(date) to authenticated, service_role;
grant execute on function public.tomar_programaciones() to service_role;

-- Los visitantes sin sesión no tienen acceso a nada
revoke all on all tables in schema public from anon;

-- ESTATUS POR MES (incluido)
-- =====================================================================
-- Actualización: estatus del estudiante a partir de un mes
-- Ejecutar UNA VEZ en Supabase > SQL Editor si tu base de datos ya existía.
-- (Las instalaciones nuevas ya lo traen dentro de schema.sql.)
-- Se puede ejecutar más de una vez sin problema.
-- =====================================================================

-- Historial: cada fila dice "desde este mes, el estudiante tiene este estatus"
create table if not exists public.estatus_historial (
  id             uuid primary key default gen_random_uuid(),
  estudiante_id  uuid not null references public.estudiantes (id) on delete cascade,
  estatus        public.estatus_estudiante not null,
  desde          date not null,
  nota           text,
  creado_en      timestamptz not null default now(),
  unique (estudiante_id, desde),
  constraint historial_dia_1 check (extract(day from desde) = 1)
);

alter table public.estatus_historial enable row level security;
drop policy if exists "solo admins" on public.estatus_historial;
create policy "solo admins" on public.estatus_historial for all to authenticated
  using (public.es_admin()) with check (public.es_admin());

-- Estatus vigente de un estudiante en un mes dado
create or replace function public.estatus_en(p_est uuid, p_mes date)
returns public.estatus_estudiante
language sql
stable
set search_path = public
as $$
  select coalesce(
    (select h.estatus from public.estatus_historial h
      where h.estudiante_id = p_est and h.desde <= p_mes
      order by h.desde desc limit 1),
    (select h.estatus from public.estatus_historial h
      where h.estudiante_id = p_est
      order by h.desde asc limit 1),
    (select e.estatus from public.estudiantes e where e.id = p_est)
  );
$$;

-- Recalcula el monto de las mensualidades desde un mes, según el estatus de cada mes (uso interno)
create or replace function public.recalcular_cargos_(p_est uuid, p_desde date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  update public.cargos c
     set monto = public.cuota_para(public.estatus_en(c.estudiante_id, c.mes)),
         estatus_al_generar = public.estatus_en(c.estudiante_id, c.mes)
   where c.estudiante_id = p_est
     and c.mes >= date_trunc('month', p_desde)::date
     and (c.monto is distinct from public.cuota_para(public.estatus_en(c.estudiante_id, c.mes))
          or c.estatus_al_generar is distinct from public.estatus_en(c.estudiante_id, c.mes));
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Mantiene estudiantes.estatus igual al estatus del mes actual (uso interno)
create or replace function public.sincronizar_estatus_(p_est uuid default null)
returns void
language sql
security definer
set search_path = public
as $$
  update public.estudiantes e
     set estatus = public.estatus_en(e.id, date_trunc('month',
           (now() at time zone (select zona_horaria from public.configuracion where id = 1)))::date)
   where (p_est is null or e.id = p_est)
     and exists (select 1 from public.estatus_historial h where h.estudiante_id = e.id)
     and e.estatus is distinct from public.estatus_en(e.id, date_trunc('month',
           (now() at time zone (select zona_horaria from public.configuracion where id = 1)))::date);
$$;

-- Cambia el estatus de un estudiante a partir de un mes y ajusta sus mensualidades desde ese mes
create or replace function public.cambiar_estatus(p_est uuid, p_estatus public.estatus_estudiante, p_desde date, p_nota text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_desde   date := date_trunc('month', p_desde)::date;
  v_inicio  date;
  v_ingreso date;
  v_actual  public.estatus_estudiante;
  n         int;
  m         int;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'No autorizado';
  end if;
  select mes_inicio into v_inicio from public.configuracion where id = 1;
  select greatest(v_inicio, date_trunc('month', fecha_ingreso)::date), estatus
    into v_ingreso, v_actual
    from public.estudiantes where id = p_est;
  if not found then raise exception 'Estudiante no encontrado'; end if;
  if v_desde < v_ingreso then
    raise exception 'El cambio no puede ser anterior al mes de ingreso del estudiante (%).', to_char(v_ingreso, 'MM/YYYY');
  end if;

  -- la primera vez, se guarda el estatus original desde el mes de ingreso
  if not exists (select 1 from public.estatus_historial where estudiante_id = p_est) then
    insert into public.estatus_historial (estudiante_id, estatus, desde, nota)
    values (p_est, v_actual, v_ingreso, 'Estatus de ingreso');
  end if;

  insert into public.estatus_historial (estudiante_id, estatus, desde, nota)
  values (p_est, p_estatus, v_desde, p_nota)
  on conflict (estudiante_id, desde) do update set estatus = excluded.estatus, nota = excluded.nota;

  perform public.sincronizar_estatus_(p_est);
  n := public.recalcular_cargos_(p_est, v_desde);
  select count(*) into m from public.cargos c
    where c.estudiante_id = p_est and c.mes >= v_desde
      and (select coalesce(sum(p.monto), 0) from public.pagos p where p.estudiante_id = c.estudiante_id and p.mes = c.mes) > c.monto;
  return json_build_object('mensualidades_actualizadas', n, 'meses_con_saldo_a_favor', m);
end;
$$;

-- Elimina un cambio de estatus y recalcula las mensualidades desde ese mes
create or replace function public.eliminar_cambio_estatus(p_id uuid)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_est   uuid;
  v_desde date;
  v_min   date;
  n       int;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'No autorizado';
  end if;
  select estudiante_id, desde into v_est, v_desde from public.estatus_historial where id = p_id;
  if not found then raise exception 'Cambio no encontrado'; end if;
  select min(desde) into v_min from public.estatus_historial where estudiante_id = v_est;
  if v_desde = v_min then
    raise exception 'Ese es el estatus de ingreso y no se elimina. Para corregirlo, registra el estatus correcto desde ese mismo mes.';
  end if;
  delete from public.estatus_historial where id = p_id;
  perform public.sincronizar_estatus_(v_est);
  n := public.recalcular_cargos_(v_est, v_desde);
  return json_build_object('mensualidades_actualizadas', n);
end;
$$;

-- asegurar_cargos ahora usa el estatus vigente en CADA mes
create or replace function public.asegurar_cargos(hasta date default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tz     text;
  v_hasta  date;
  v_inicio date;
  n        int;
begin
  if auth.uid() is not null and not public.es_admin() then
    raise exception 'No autorizado';
  end if;
  select zona_horaria, mes_inicio into v_tz, v_inicio from configuracion where id = 1;
  v_hasta := date_trunc('month', coalesce(hasta, (now() at time zone v_tz)::date))::date;

  perform public.sincronizar_estatus_(null);

  insert into cargos (estudiante_id, mes, monto, estatus_al_generar)
  select e.id, m.mes::date,
         public.cuota_para(public.estatus_en(e.id, m.mes::date)),
         public.estatus_en(e.id, m.mes::date)
  from estudiantes e
  cross join lateral generate_series(
           greatest(v_inicio, date_trunc('month', e.fecha_ingreso)::date),
           v_hasta, interval '1 month') as m(mes)
  where e.fecha_retiro is null or m.mes::date < date_trunc('month', e.fecha_retiro)::date
  on conflict (estudiante_id, mes) do nothing;

  get diagnostics n = row_count;
  return n;
end;
$$;

-- v_cargos: se agrega "a_favor" (pagado de más, por ejemplo tras un cambio de estatus)
create or replace view public.v_cargos
with (security_invoker = true) as
with cfg as (select dia_limite, zona_horaria from public.configuracion where id = 1),
pag as (select estudiante_id, mes, sum(monto) as pagado from public.pagos group by 1, 2)
select
  c.id, c.estudiante_id, c.mes, c.monto, c.estatus_al_generar, c.nota,
  e.codigo, e.nombre, e.estatus, e.representante, e.telefono, e.correo,
  coalesce(p.pagado, 0)::numeric(10,2)                          as pagado,
  greatest(c.monto - coalesce(p.pagado, 0), 0)::numeric(10,2)   as saldo,
  (c.mes + (cfg.dia_limite - 1))                                as vence,
  (c.monto - coalesce(p.pagado, 0) > 0
     and (now() at time zone cfg.zona_horaria)::date > c.mes + (cfg.dia_limite - 1)) as vencido,
  case
    when c.monto = 0                              then 'exonerado'
    when c.monto - coalesce(p.pagado, 0) <= 0     then 'pagado'
    when coalesce(p.pagado, 0) > 0                then 'parcial'
    when (now() at time zone cfg.zona_horaria)::date > c.mes + (cfg.dia_limite - 1) then 'vencido'
    else 'pendiente'
  end as estado,
  greatest(coalesce(p.pagado, 0) - c.monto, 0)::numeric(10,2)   as a_favor
from public.cargos c
join public.estudiantes e on e.id = c.estudiante_id
cross join cfg
left join pag p on p.estudiante_id = c.estudiante_id and p.mes = c.mes;

-- Permisos (necesarios en proyectos de Supabase creados desde 2026)
grant select, insert, update, delete on public.estatus_historial to authenticated, service_role;
grant select on public.v_cargos to authenticated, service_role;
revoke all on public.estatus_historial from anon;
revoke execute on function public.recalcular_cargos_(uuid, date) from public, anon, authenticated;
revoke execute on function public.sincronizar_estatus_(uuid) from public, anon, authenticated;
revoke execute on function public.cambiar_estatus(uuid, public.estatus_estudiante, date, text) from public, anon;
revoke execute on function public.eliminar_cambio_estatus(uuid) from public, anon;
grant execute on function public.estatus_en(uuid, date) to authenticated, service_role;
grant execute on function public.cambiar_estatus(uuid, public.estatus_estudiante, date, text) to authenticated, service_role;
grant execute on function public.eliminar_cambio_estatus(uuid) to authenticated, service_role;
grant execute on function public.asegurar_cargos(date) to authenticated, service_role;
