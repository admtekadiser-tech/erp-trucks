-- =====================================================================
--  ERP TRUCKS CROS · Migración v0.2 (30/10/2026)
--  Viajes con importes por concepto (ruta, manipulación, retorno,
--  paralización, peaje), Nº de expedición y detalle de clientes/albaranes.
--  Se quita la necesidad de asignar rutas antes de importar.
--  Cómo usarlo: Supabase → SQL Editor → pegar todo → Run. No toca TransControl.
-- =====================================================================
set search_path to erp, public, extensions;

alter table erp.viajes
  add column if not exists num_expedicion text,
  add column if not exists detalle_clientes text[],
  add column if not exists importe_ruta numeric(10,2),
  add column if not exists importe_manipulacion numeric(10,2),
  add column if not exists importe_retorno numeric(10,2),
  add column if not exists importe_paralizacion numeric(10,2),
  add column if not exists importe_peaje numeric(10,2);
alter table erp.viajes alter column cliente_id drop not null;

-- Importe = suma de los 5 conceptos (si no hay importe de ruta, usa el precio especial antiguo)
create or replace function erp.importe_viaje(p_viaje uuid)
returns numeric language sql stable set search_path = erp, public, extensions as $$
  select round(coalesce(importe_ruta, precio_manual, 0) + coalesce(importe_manipulacion,0) + coalesce(importe_retorno,0)
             + coalesce(importe_paralizacion,0) + coalesce(importe_peaje,0), 2)
    from erp.viajes where id = p_viaje;
$$;

drop view if exists erp.v_viajes;
create view erp.v_viajes with (security_invoker = true) as
select v.*, c.nombre as cliente_nombre, r.nombre as ruta_nombre, co.nombre as conductor_nombre,
       t.matricula as tractora, f.codigo as factura_codigo, erp.importe_viaje(v.id) as importe
  from erp.viajes v
  left join erp.clientes c on c.id = v.cliente_id
  left join erp.rutas r on r.id = v.ruta_id
  left join erp.conductores co on co.id = v.conductor_id
  left join erp.vehiculos t on t.id = v.tractora_id
  left join erp.facturas f on f.id = v.factura_id;
grant select on erp.v_viajes to authenticated, service_role;

-- Al poner cliente a un viaje, la ruta lo recuerda para las próximas importaciones
create or replace function erp.recordar_cliente_ruta() returns trigger
language plpgsql set search_path = erp, public, extensions as $$
begin
  if new.cliente_id is not null and new.ruta_id is not null then
    update erp.rutas set cliente_id = new.cliente_id where id = new.ruta_id and cliente_id is null;
  end if;
  return new;
end $$;
drop trigger if exists t_viajes_cliente_ruta on erp.viajes;
create trigger t_viajes_cliente_ruta after insert or update of cliente_id on erp.viajes
  for each row execute function erp.recordar_cliente_ruta();

-- Importación: entran TODOS los viajes de TransControl.
-- Cliente, importe de ruta y peaje se proponen según el último viaje de esa misma ruta.
create or replace function erp.importar_viajes_transcontrol(p_desde date default current_date - 60,
                                                            p_hasta date default current_date)
returns table (rutas_nuevas int, viajes_nuevos int)
language plpgsql set search_path = erp, public, extensions as $$
declare rn int; vn int;
begin
  perform sincronizar_conductores();

  insert into erp.rutas (nombre, nombre_transcontrol)
  select distinct r.nombre_ruta, r.nombre_ruta
    from public.registros r
   where coalesce(r.nombre_ruta,'') <> ''
     and r.fecha ~ '^\d{2}/\d{2}/\d{4}$'
     and to_date(r.fecha,'DD/MM/YYYY') between p_desde and p_hasta
  on conflict (nombre_transcontrol) do nothing;
  get diagnostics rn = row_count;

  insert into erp.viajes (transcontrol_id, fecha, cliente_id, ruta_id, conductor_id,
                          num_entregas, num_paradas, palets_entregados, palets_recogidos,
                          detalle_clientes, albaranes, importe_ruta, importe_peaje)
  select g.tc_id, g.fecha, coalesce(g.cliente_ruta, ult.cliente_id), g.ruta_id, g.conductor_id,
         g.n, greatest(g.n - 1, 0), g.pe, g.pr, g.clientes,
         case when array_to_string(g.albs, '') = '' then null else g.albs end,
         ult.importe_ruta, ult.importe_peaje
    from (
      select s.fecha || '|' || s.conductor || '|' || s.nombre_ruta as tc_id,
             to_date(s.fecha,'DD/MM/YYYY') as fecha, pr.cliente_id as cliente_ruta, pr.id as ruta_id, co.id as conductor_id,
             count(*)::int n, sum(s.pe)::int pe, sum(s.pr)::int pr,
             array_agg(s.cliente order by s.orden) clientes,
             array_agg(coalesce(s.ev,'') order by s.orden) albs
        from ( -- una fila por parada (cliente de descarga)
          select fecha, conductor, nombre_ruta, coalesce(cliente,'') cliente,
                 max(palets_entregados) pe, max(palets_recogidos) pr,
                 max(nullif(evoucher,'')) ev, min(created_at) orden
            from public.registros
           where fecha ~ '^\d{2}/\d{2}/\d{4}$' and coalesce(nombre_ruta,'') <> ''
             and to_date(fecha,'DD/MM/YYYY') between p_desde and p_hasta
           group by fecha, conductor, nombre_ruta, coalesce(cliente,'')
        ) s
        join erp.rutas ru on ru.nombre_transcontrol = s.nombre_ruta and not ru.ignorar
        join erp.rutas pr on pr.id = coalesce(ru.agrupar_en, ru.id) and not pr.ignorar
        left join erp.conductores co on co.nombre = s.conductor
       group by s.fecha, s.conductor, s.nombre_ruta, pr.cliente_id, pr.id, co.id
    ) g
    left join lateral (
      select v.cliente_id, v.importe_ruta, v.importe_peaje from erp.viajes v
       where v.ruta_id = g.ruta_id and v.importe_ruta is not null and v.estado <> 'anulado'
       order by v.fecha desc limit 1
    ) ult on true
  on conflict (transcontrol_id) do nothing;
  get diagnostics vn = row_count;

  return query select rn, vn;
end $$;

-- Prefactura: una línea por viaje (importe ruta) + una línea por cada concepto con importe
create or replace function erp.crear_prefactura(p_cliente uuid, p_desde date, p_hasta date)
returns uuid language plpgsql set search_path = erp, public, extensions as $$
declare
  fid uuid; v record; n int := 0; recargo numeric; base_viajes numeric := 0; emp empresa; pr numeric;
begin
  select * into emp from empresa where id = 1;
  insert into facturas (serie, cliente_id, periodo_desde, periodo_hasta, iva_pct)
  values (emp.serie_facturas, p_cliente, p_desde, p_hasta, emp.iva_defecto)
  returning id into fid;

  for v in
    select vi.*, r.nombre as ruta_nombre from viajes vi left join rutas r on r.id = vi.ruta_id
     where vi.cliente_id = p_cliente and vi.fecha between p_desde and p_hasta
       and vi.estado in ('pendiente','revisado') and vi.factura_id is null
     order by vi.fecha, r.nombre
  loop
    n := n + 1;
    pr := coalesce(v.importe_ruta, v.precio_manual, 0);
    insert into factura_lineas (factura_id, orden, viaje_id, concepto, cantidad, precio)
    values (fid, n*10, v.id,
            to_char(v.fecha,'DD/MM/YYYY') || ' · ' || coalesce(v.ruta_nombre,'Servicio de transporte')
              || coalesce(' · Exp. ' || nullif(v.num_expedicion,''), '')
              || coalesce(' · Alb. ' || nullif(array_to_string(array_remove(v.albaranes, ''), ', '), ''), ''),
            1, pr);
    base_viajes := base_viajes + pr;

    insert into factura_lineas (factura_id, orden, viaje_id, concepto, cantidad, precio)
    select fid, n*10 + x.o, v.id, '   ' || x.c, 1, x.p
      from (values (1, 'Manipulación', v.importe_manipulacion), (2, 'Retorno', v.importe_retorno),
                   (3, 'Paralización', v.importe_paralizacion), (4, 'Peaje', v.importe_peaje)) x(o, c, p)
     where coalesce(x.p, 0) <> 0;

    update viajes set factura_id = fid where id = v.id;
  end loop;

  if n = 0 then
    delete from facturas where id = fid;
    raise exception 'No hay viajes pendientes de facturar para ese cliente y periodo';
  end if;

  recargo := precio_tarifa(p_cliente, null, 'recargo_gasoil_pct', p_hasta);
  if coalesce(recargo, 0) <> 0 then
    insert into factura_lineas (factura_id, orden, concepto, cantidad, precio)
    values (fid, 999999, 'Recargo gasoil ' || recargo || '%', 1, round(base_viajes * recargo / 100, 2));
  end if;

  perform recalcular_factura(fid);
  return fid;
end $$;

revoke execute on all functions in schema erp from public, anon;
grant execute on all functions in schema erp to authenticated, service_role;
