-- =====================================================================
-- Permisos explícitos para la API de datos de Supabase.
-- Desde 2026, en los proyectos nuevos de Supabase las tablas NO quedan
-- accesibles automáticamente: hay que concederlas. Las reglas de seguridad
-- (RLS) siguen decidiendo QUÉ filas ve cada usuario: solo los administradores.
-- Se puede ejecutar varias veces sin problema.
-- =====================================================================

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
