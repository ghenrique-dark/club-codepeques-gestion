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
