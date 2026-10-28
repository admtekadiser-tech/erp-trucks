/* ERP TRUCKS CROS TRANSPORT · v0.1
   App web para administración: viajes (desde TransControl), rutas y tarifas,
   clientes, prefacturas, facturas, cobros y alertas. Datos en Supabase (esquema erp). */
'use strict';

const CFG = window.ERP_CONFIG;
const sb = supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey);
const db = () => sb.schema('erp');

const S = { usuario: null, empresa: null, clientes: [], conductores: [], vehiculos: [] };

/* ---------------------------------------------------------------- utilidades */
const $ = (sel) => document.querySelector(sel);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const eur = (n) => (Number(n) || 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
const num = (n, d = 2) => (Number(n) || 0).toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d });
const hoy = () => new Date().toLocaleDateString('sv-SE');
const fecha = (d) => (d ? d.slice(8, 10) + '/' + d.slice(5, 7) + '/' + d.slice(0, 4) : '');
const sumarDias = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('sv-SE'); };
const inicioMes = (d = hoy()) => d.slice(0, 8) + '01';
const finMes = (d = hoy()) => { const x = new Date(d.slice(0, 8) + '01T12:00:00'); x.setMonth(x.getMonth() + 1); x.setDate(0); return x.toLocaleDateString('sv-SE'); };
const mesAnterior = () => { const x = new Date(inicioMes() + 'T12:00:00'); x.setDate(0); return x.toLocaleDateString('sv-SE'); };
const val = (id) => { const e = document.getElementById(id); if (!e) return null; if (e.type === 'checkbox') return e.checked; const v = e.value.trim(); return v === '' ? null : v; };
const opciones = (lista, sel, vacio = '— elegir —', etq = (x) => x.nombre) =>
  `<option value="">${esc(vacio)}</option>` + lista.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(etq(x))}</option>`).join('');

function aviso(msg, err = false) {
  const a = $('#aviso'); a.textContent = msg; a.className = err ? 'err' : '';
  clearTimeout(aviso.t); aviso.t = setTimeout(() => a.classList.add('oculto'), err ? 7000 : 3500);
}
async function q(promesa) {
  const { data, error } = await promesa;
  if (error) { aviso(traducirError(error), true); throw error; }
  return data;
}
function traducirError(e) {
  const m = e.message || String(e);
  if (/Invalid login credentials/i.test(m)) return 'Usuario o contraseña incorrectos';
  if (/duplicate key/i.test(m)) return 'Ya existe un registro con esos datos';
  if (/violates foreign key/i.test(m)) return 'No se puede: hay otros datos que dependen de este registro';
  if (/JWT expired|not authenticated/i.test(m)) return 'La sesión ha caducado. Vuelve a entrar.';
  if (/Password should be at least/i.test(m)) return 'La contraseña es demasiado corta (mínimo 8 caracteres)';
  return m;
}
function modal(html) { $('#modal').innerHTML = html; $('#modal-fondo').classList.remove('oculto'); const f = $('#modal input, #modal select'); if (f) f.focus(); }
function cerrarModal() { $('#modal-fondo').classList.add('oculto'); $('#modal').innerHTML = ''; }
$('#modal-fondo').addEventListener('mousedown', (e) => { if (e.target.id === 'modal-fondo') cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

const ESTADO_VIAJE = { pendiente: 'ambar', revisado: 'azul', facturado: 'verde', anulado: 'gris' };
const ESTADO_FACT = { borrador: ['gris', 'Borrador'], pendiente: ['ambar', 'Pendiente cobro'], vencida: ['rojo', 'Vencida'], cobrada: ['verde', 'Cobrada'], anulada: ['gris', 'Anulada'] };
const TIPOS_TARIFA = { viaje: 'Precio del viaje', parada: 'Por parada adicional', hora_espera: 'Por hora de espera', festivo: 'Plus festivo', recargo_gasoil_pct: 'Recargo gasoil (%)', otro: 'Otro' };
const et = (cls, txt) => `<span class="et ${cls}">${esc(txt)}</span>`;

/* ---------------------------------------------------------------- sesión */
async function arrancar() {
  const { data } = await sb.auth.getSession();
  S.usuario = data.session?.user || null;
  sb.auth.onAuthStateChange((_ev, sesion) => { const antes = S.usuario?.id; S.usuario = sesion?.user || null; if (antes !== S.usuario?.id) pintar(); });
  window.addEventListener('hashchange', pintar);
  pintar();
}

function pantallaLogin(msg = '') {
  $('#app').innerHTML = `
  <form class="login" id="f-login">
    <h1>ERP Trucks Cros</h1>
    <label>Usuario</label><input id="l-usuario" autocomplete="username" autocapitalize="none" required>
    <label>Contraseña</label><input id="l-pass" type="password" autocomplete="current-password" required>
    <button type="submit">Entrar</button>
    <div class="error">${esc(msg)}</div>
  </form>`;
  $('#l-usuario').focus();
  $('#f-login').onsubmit = async (e) => {
    e.preventDefault();
    const usuario = val('l-usuario').toLowerCase().replace(/\s+/g, '');
    const email = usuario.includes('@') ? usuario : `${usuario}@${CFG.dominioUsuarios}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: $('#l-pass').value });
    if (error) return pantallaLogin(traducirError(error));
  };
}

function pantallaCambioPass(obligatorio) {
  const html = `
  <form class="login" id="f-pass" style="${obligatorio ? '' : 'margin:0;box-shadow:none;padding:0'}">
    <h1>${obligatorio ? 'Pon tu contraseña' : 'Cambiar contraseña'}</h1>
    ${obligatorio ? '<p class="ayuda">Es tu primer acceso: cambia la contraseña temporal por una tuya (mínimo 8 caracteres).</p>' : ''}
    <label>Nueva contraseña</label><input id="p1" type="password" autocomplete="new-password" minlength="8" required>
    <label>Repítela</label><input id="p2" type="password" autocomplete="new-password" minlength="8" required>
    <button type="submit">Guardar contraseña</button>
    ${obligatorio ? '' : '<button type="button" class="sec" onclick="cerrarModal()">Cancelar</button>'}
    <div class="error" id="p-err"></div>
  </form>`;
  if (obligatorio) $('#app').innerHTML = html; else modal(html);
  $('#f-pass').onsubmit = async (e) => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) { $('#p-err').textContent = 'Las dos contraseñas no coinciden'; return; }
    const { data, error } = await sb.auth.updateUser({ password: $('#p1').value, data: { debe_cambiar_password: false } });
    if (error) { $('#p-err').textContent = traducirError(error); return; }
    S.usuario = data.user; cerrarModal(); aviso('Contraseña cambiada'); pintar();
  };
}

/* ---------------------------------------------------------------- estructura */
const MENU = [
  ['inicio', 'Inicio'], ['viajes', 'Viajes'], ['facturas', 'Facturas'], ['rutas', 'Rutas y tarifas'],
  ['clientes', 'Clientes'], ['empresa', 'Empresa'],
  ['flota', 'Flota', 1], ['conductores', 'Conductores', 1], ['gastos', 'Gastos', 1], ['gestoria', 'Gestoría', 1]
];

async function pintar() {
  if (!S.usuario) return pantallaLogin();
  if (S.usuario.user_metadata?.debe_cambiar_password) return pantallaCambioPass(true);
  if (!S.cargado) {
    const admin = await sb.schema('erp').rpc('es_admin');
    if (admin.error || !admin.data) { await sb.auth.signOut(); return pantallaLogin('Este usuario no tiene acceso al ERP'); }
    await recargarMaestros(); S.cargado = true;
  }
  const [pag, id] = (location.hash.slice(1) || 'inicio').split('/');
  const nombre = S.usuario.user_metadata?.nombre || S.usuario.email.split('@')[0];
  $('#app').innerHTML = `
  <div class="layout">
    <nav class="menu">
      <div class="marca">Trucks Cros · ERP</div>
      ${MENU.map(([k, t, prox]) => `<a href="#${k}" class="${(pag === k || (pag === 'factura' && k === 'facturas')) ? 'activo' : ''} ${prox ? 'prox' : ''}">${t}</a>`).join('')}
      <div class="pie"><span>${esc(nombre)}<br></span><a onclick="pantallaCambioPass(false)">Contraseña</a> · <a onclick="salir()">Salir</a></div>
    </nav>
    <main class="contenido" id="pagina"><div class="cargando">Cargando…</div></main>
  </div>`;
  const PAG = { inicio: pInicio, viajes: pViajes, facturas: pFacturas, factura: pFactura, rutas: pRutas, clientes: pClientes, empresa: pEmpresa };
  try { await (PAG[pag] || pProximamente)(id, pag); }
  catch (e) { console.error(e); $('#pagina').innerHTML = `<div class="tarjeta error">Error al cargar: ${esc(traducirError(e))}</div>`; }
}
async function salir() { S.cargado = false; await sb.auth.signOut(); location.hash = ''; }

async function recargarMaestros() {
  const [emp, cli, con, veh] = await Promise.all([
    db().from('empresa').select('*').maybeSingle(),
    db().from('clientes').select('*').order('nombre'),
    db().from('conductores').select('id,nombre,activo').order('nombre'),
    db().from('vehiculos').select('id,matricula,tipo').is('fecha_baja', null).order('matricula')
  ]);
  S.empresa = emp.data; S.clientes = cli.data || []; S.conductores = con.data || []; S.vehiculos = veh.data || [];
}

/* ---------------------------------------------------------------- INICIO */
async function pInicio() {
  const [alertas, pend, cobro, mes, sinAsig] = await Promise.all([
    q(db().from('v_alertas').select('*').order('fecha')),
    q(db().from('v_viajes').select('importe').is('factura_id', null).in('estado', ['pendiente', 'revisado'])),
    q(db().from('v_facturas_cobro').select('pendiente,estado_cobro').neq('estado_cobro', 'cobrada')),
    q(db().from('facturas').select('base').eq('estado', 'emitida').gte('fecha', inicioMes())),
    q(db().from('v_rutas_sin_asignar').select('id', { count: 'exact' }))
  ]);
  const suma = (l, k) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
  const vencido = cobro.filter((x) => x.estado_cobro === 'vencida');
  $('#pagina').innerHTML = `
  <h1>Inicio</h1>
  ${!S.empresa ? `<div class="alerta ambar">Faltan los datos de la empresa para poder facturar. <a href="#empresa" style="margin-left:auto">Rellenar ahora</a></div>` : ''}
  ${sinAsig.length ? `<div class="alerta ambar">Hay ${sinAsig.length} rutas de TransControl sin cliente asignado: sus viajes no entran en el ERP. <a href="#rutas" style="margin-left:auto">Asignar</a></div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="t">Viajes sin facturar</div><div class="n">${pend.length}</div><div class="t">${eur(suma(pend, 'importe'))} estimado</div></div>
    <div class="kpi"><div class="t">Pendiente de cobro</div><div class="n">${eur(suma(cobro, 'pendiente'))}</div><div class="t">${cobro.length} facturas</div></div>
    <div class="kpi"><div class="t">Vencido sin cobrar</div><div class="n" style="color:${vencido.length ? 'var(--rojo)' : 'inherit'}">${eur(suma(vencido, 'pendiente'))}</div><div class="t">${vencido.length} facturas</div></div>
    <div class="kpi"><div class="t">Facturado este mes (base)</div><div class="n">${eur(suma(mes, 'base'))}</div><div class="t">${mes.length} facturas</div></div>
  </div>
  <h2>Avisos</h2>
  ${alertas.length ? alertas.map((a) => `<div class="alerta ${a.nivel}">${et(a.nivel, { flota: 'Flota', conductores: 'Conductor', cobros: 'Cobro', facturacion: 'Facturación' }[a.grupo])} ${esc(a.texto)}<span class="f">${fecha(a.fecha)}</span></div>`).join('')
    : '<div class="tarjeta vacio">Todo en orden: no hay avisos.</div>'}`;
}

/* ---------------------------------------------------------------- VIAJES */
const fViajes = { desde: inicioMes(), hasta: hoy(), cliente: '', estado: 'sin_facturar' };
async function pViajes() {
  let qy = db().from('v_viajes').select('*').gte('fecha', fViajes.desde).lte('fecha', fViajes.hasta).order('fecha', { ascending: false }).order('ruta_nombre').limit(1000);
  if (fViajes.cliente) qy = qy.eq('cliente_id', fViajes.cliente);
  if (fViajes.estado === 'sin_facturar') qy = qy.is('factura_id', null).neq('estado', 'anulado');
  else if (fViajes.estado) qy = qy.eq('estado', fViajes.estado);
  const lista = await q(qy);
  const total = lista.reduce((a, v) => a + Number(v.importe || 0), 0);
  $('#pagina').innerHTML = `
  <h1>Viajes</h1>
  <div class="barra">
    <div class="campo"><label>Desde</label><input type="date" id="fv-desde" value="${fViajes.desde}"></div>
    <div class="campo"><label>Hasta</label><input type="date" id="fv-hasta" value="${fViajes.hasta}"></div>
    <div class="campo"><label>Cliente</label><select id="fv-cliente">${opciones(S.clientes, fViajes.cliente, 'Todos')}</select></div>
    <div class="campo"><label>Estado</label><select id="fv-estado">
      ${[['sin_facturar', 'Sin facturar'], ['', 'Todos'], ['pendiente', 'Pendientes'], ['revisado', 'Revisados'], ['facturado', 'Facturados'], ['anulado', 'Anulados']].map(([k, t]) => `<option value="${k}" ${fViajes.estado === k ? 'selected' : ''}>${t}</option>`).join('')}
    </select></div>
    <button class="sec" onclick="importarViajes()">⟳ Importar de TransControl</button>
    <button onclick="editarViaje()">+ Viaje manual</button>
  </div>
  <p class="ayuda">${lista.length} viajes · ${eur(total)} (según tarifas). Pulsa un viaje para ajustar paradas, esperas o precio.</p>
  <div class="tabla-wrap"><table>
    <tr><th>Fecha</th><th>Cliente</th><th>Ruta</th><th>Conductor</th><th class="num">Entregas</th><th class="num">Paradas cobradas</th><th class="num">Palets</th><th class="num">Importe</th><th>Estado</th></tr>
    ${lista.map((v) => `<tr class="clic" onclick="editarViaje('${v.id}')">
      <td>${fecha(v.fecha)}</td><td>${esc(v.cliente_nombre)}</td><td>${esc(v.ruta_nombre)}</td><td>${esc(v.conductor_nombre)}</td>
      <td class="num">${v.num_entregas}</td><td class="num">${v.num_paradas}</td><td class="num">${v.palets_entregados ?? ''}</td>
      <td class="num">${v.importe > 0 ? eur(v.importe) : et('rojo', 'Sin tarifa')}</td>
      <td>${v.factura_codigo ? et('verde', v.factura_codigo) : v.factura_id ? et('azul', 'En borrador') : et(ESTADO_VIAJE[v.estado], v.estado)}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay viajes con estos filtros.</div>'}</div>`;
  ['desde', 'hasta', 'cliente', 'estado'].forEach((k) => { $('#fv-' + k).onchange = (e) => { fViajes[k] = e.target.value; pViajes(); }; });
}

function importarViajes() {
  modal(`<h1>Importar viajes de TransControl</h1>
  <p class="ayuda">Trae los viajes que han registrado los conductores. Solo entran las rutas que ya tienen cliente asignado; las rutas nuevas aparecerán en «Rutas y tarifas». Los viajes ya importados no se duplican. TransControl no se modifica.</p>
  <div class="rejilla"><div><label>Desde</label><input type="date" id="i-desde" value="${sumarDias(hoy(), -60)}"></div>
  <div><label>Hasta</label><input type="date" id="i-hasta" value="${hoy()}"></div></div>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button id="b-imp" onclick="hacerImportacion()">Importar</button></div>`);
}
async function hacerImportacion() {
  $('#b-imp').disabled = true; $('#b-imp').textContent = 'Importando…';
  try {
    const r = await q(db().rpc('importar_viajes_transcontrol', { p_desde: val('i-desde'), p_hasta: val('i-hasta') }));
    const x = r[0] || {}; cerrarModal(); await recargarMaestros();
    aviso(`${x.viajes_nuevos} viajes nuevos importados${x.rutas_nuevas ? ` · ${x.rutas_nuevas} rutas nuevas por asignar` : ''}`);
    pintar();
  } catch { $('#b-imp').disabled = false; $('#b-imp').textContent = 'Importar'; }
}

async function editarViaje(id) {
  const v = id ? await q(db().from('viajes').select('*').eq('id', id).single()) : { fecha: hoy(), num_entregas: 1, num_paradas: 0, estado: 'pendiente' };
  const extras = id ? await q(db().from('viaje_extras').select('*').eq('viaje_id', id)) : [];
  const rutas = await q(db().from('rutas').select('id,nombre,cliente_id').not('cliente_id', 'is', null).eq('ignorar', false).order('nombre'));
  const importe = id ? await q(db().rpc('importe_viaje', { p_viaje: id })) : null;
  const bloqueado = !!v.factura_id;
  const dis = bloqueado ? 'disabled' : '';
  modal(`<h1>${id ? 'Viaje del ' + fecha(v.fecha) : 'Nuevo viaje manual'}</h1>
  ${bloqueado ? '<p class="ayuda">Este viaje ya está en una factura: no se puede modificar.</p>' : ''}
  ${v.transcontrol_id ? `<p class="ayuda">Importado de TransControl · ${v.num_entregas} puntos de descarga${v.albaranes ? ' · eVoucher: ' + esc(v.albaranes.join(', ')) : ''}</p>` : ''}
  <div class="rejilla">
    <div><label>Fecha</label><input type="date" id="v-fecha" value="${v.fecha}" ${dis}></div>
    <div><label>Cliente</label><select id="v-cliente" ${dis} onchange="filtrarRutasViaje()">${opciones(S.clientes, v.cliente_id)}</select></div>
    <div><label>Ruta</label><select id="v-ruta" ${dis}>${opciones(rutas.filter((r) => !v.cliente_id || r.cliente_id === v.cliente_id), v.ruta_id, '— sin ruta —')}</select></div>
    <div><label>Conductor</label><select id="v-conductor" ${dis}>${opciones(S.conductores, v.conductor_id, '—')}</select></div>
    <div><label>Tractora / camión</label><select id="v-tractora" ${dis}>${opciones(S.vehiculos, v.tractora_id, '—', (x) => x.matricula + ' · ' + x.tipo)}</select></div>
    <div><label>Paradas que se cobran</label><input type="number" min="0" id="v-paradas" value="${v.num_paradas}" ${dis}></div>
    <div><label>Precio especial (opcional)</label><input type="number" step="0.01" id="v-precio" value="${v.precio_manual ?? ''}" placeholder="Usa la tarifa" ${dis}></div>
    <div><label>Albaranes (separados por coma)</label><input id="v-albaranes" value="${esc((v.albaranes || []).join(', '))}" ${dis}></div>
    <div><label>Km</label><input type="number" id="v-km" value="${v.km ?? ''}" ${dis}></div>
    <div><label>Estado</label><select id="v-estado" ${dis}>${['pendiente', 'revisado', 'anulado'].concat(bloqueado ? ['facturado'] : []).map((e) => `<option ${v.estado === e ? 'selected' : ''}>${e}</option>`).join('')}</select></div>
  </div>
  <label>Notas</label><textarea id="v-notas" ${dis}>${esc(v.notas)}</textarea>
  ${id ? `<h2>Extras (esperas, festivos…)</h2>
  <div class="tabla-wrap"><table><tr><th>Tipo</th><th>Descripción</th><th class="num">Cantidad</th><th class="num">Precio</th><th></th></tr>
    ${extras.map((e) => `<tr><td>${esc(TIPOS_TARIFA[e.tipo] || e.tipo)}</td><td>${esc(e.descripcion)}</td><td class="num">${num(e.cantidad)}</td><td class="num">${e.precio_manual != null ? eur(e.precio_manual) : 'Tarifa'}</td>
      <td>${bloqueado ? '' : `<button class="sec peq" onclick="borrarExtra('${e.id}','${id}')">Quitar</button>`}</td></tr>`).join('')}
    ${bloqueado ? '' : `<tr><td><select id="x-tipo"><option value="hora_espera">Horas de espera</option><option value="festivo">Festivo</option><option value="otro">Otro</option></select></td>
      <td><input id="x-desc" placeholder="Ej.: espera en descarga"></td><td><input type="number" step="0.25" id="x-cant" value="1" style="width:80px"></td>
      <td><input type="number" step="0.01" id="x-precio" placeholder="Tarifa" style="width:100px"></td><td><button class="peq" onclick="anadirExtra('${id}')">Añadir</button></td></tr>`}
  </table></div>
  <p style="text-align:right;font-size:17px">Importe del viaje: <b>${importe > 0 ? eur(importe) : 'sin tarifa'}</b></p>` : ''}
  <div class="acciones">
    ${id && !bloqueado && !v.transcontrol_id ? `<button class="peligro izq" onclick="borrarViaje('${id}')">Borrar</button>` : ''}
    <button class="sec" onclick="cerrarModal()">${bloqueado ? 'Cerrar' : 'Cancelar'}</button>
    ${bloqueado ? '' : `<button onclick="guardarViaje(${id ? `'${id}'` : ''})">Guardar</button>`}
  </div>`);
  editarViaje.rutas = rutas;
}
function filtrarRutasViaje() {
  const c = val('v-cliente');
  $('#v-ruta').innerHTML = opciones(editarViaje.rutas.filter((r) => r.cliente_id === c), null, '— sin ruta —');
}
async function guardarViaje(id) {
  const reg = {
    fecha: val('v-fecha'), cliente_id: val('v-cliente'), ruta_id: val('v-ruta'), conductor_id: val('v-conductor'),
    tractora_id: val('v-tractora'), num_paradas: Number(val('v-paradas') || 0), precio_manual: val('v-precio'),
    albaranes: val('v-albaranes') ? val('v-albaranes').split(',').map((s) => s.trim()).filter(Boolean) : null,
    km: val('v-km'), estado: val('v-estado'), notas: val('v-notas')
  };
  if (!reg.fecha || !reg.cliente_id) return aviso('Fecha y cliente son obligatorios', true);
  if (id) await q(db().from('viajes').update(reg).eq('id', id));
  else id = (await q(db().from('viajes').insert(reg).select('id').single())).id;
  aviso('Viaje guardado'); cerrarModal(); pintar();
}
async function borrarViaje(id) { if (!confirm('¿Borrar este viaje?')) return; await q(db().from('viajes').delete().eq('id', id)); cerrarModal(); pintar(); }
async function anadirExtra(viajeId) {
  await q(db().from('viaje_extras').insert({ viaje_id: viajeId, tipo: val('x-tipo'), descripcion: val('x-desc'), cantidad: Number(val('x-cant') || 1), precio_manual: val('x-precio') }));
  editarViaje(viajeId);
}
async function borrarExtra(id, viajeId) { await q(db().from('viaje_extras').delete().eq('id', id)); editarViaje(viajeId); }

/* ---------------------------------------------------------------- RUTAS Y TARIFAS */
const fRutas = { ver: 'sin_asignar', buscar: '' };
async function pRutas() {
  const todas = await q(db().from('v_rutas').select('*').order('viajes_tc', { ascending: false }));
  const principales = todas.filter((r) => !r.agrupar_en && !r.ignorar).sort((a, b) => a.nombre.localeCompare(b.nombre));
  let lista = todas;
  if (fRutas.ver === 'sin_asignar') lista = todas.filter((r) => !r.cliente_id && !r.agrupar_en && !r.ignorar);
  if (fRutas.ver === 'asignadas') lista = todas.filter((r) => (r.cliente_id || r.agrupar_en) && !r.ignorar);
  if (fRutas.ver === 'ignoradas') lista = todas.filter((r) => r.ignorar);
  if (fRutas.buscar) lista = lista.filter((r) => r.nombre.toLowerCase().includes(fRutas.buscar.toLowerCase()));
  const nTar = await q(db().from('tarifas').select('ruta_id').not('ruta_id', 'is', null));
  const conTarifa = new Set(nTar.map((t) => t.ruta_id));
  $('#pagina').innerHTML = `
  <h1>Rutas y tarifas</h1>
  <p class="ayuda">Las rutas salen solas de TransControl. Para cada una elige su <b>cliente</b> y ponle <b>tarifa</b>.
  Si es una errata o variante de otra (p. ej. «STEF ALCALS»), usa <b>«Es la misma que…»</b> y se facturará con la principal.
  Las rutas de prueba márcalas como <b>Ignorar</b>. Después pulsa «Importar de TransControl» en Viajes.</p>
  ${S.clientes.length ? '' : '<div class="alerta ambar">Primero crea los clientes (Lactalis, STEF…) en la pestaña Clientes.</div>'}
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="fr-ver">${[['sin_asignar', 'Sin asignar'], ['asignadas', 'Asignadas'], ['ignoradas', 'Ignoradas'], ['', 'Todas']].map(([k, t]) => `<option value="${k}" ${fRutas.ver === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Buscar</label><input id="fr-buscar" value="${esc(fRutas.buscar)}" placeholder="RUTA 30…"></div>
    <button onclick="nuevaRuta()">+ Ruta manual</button>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Ruta</th><th class="num">Viajes en TC</th><th>Cliente</th><th>Es la misma que…</th><th>Ignorar</th><th>Tarifa</th></tr>
    ${lista.map((r) => `<tr>
      <td><b>${esc(r.nombre)}</b>${r.nombre_transcontrol && r.nombre_transcontrol !== r.nombre ? `<br><small>${esc(r.nombre_transcontrol)}</small>` : ''}</td>
      <td class="num">${r.viajes_tc ?? ''}</td>
      <td><select onchange="cambiarRuta('${r.id}','cliente_id',this.value)" ${r.agrupar_en || r.ignorar ? 'disabled' : ''}>${opciones(S.clientes, r.cliente_id, '— sin cliente —')}</select></td>
      <td><select onchange="cambiarRuta('${r.id}','agrupar_en',this.value)" ${r.ignorar ? 'disabled' : ''}>${opciones(principales.filter((p) => p.id !== r.id), r.agrupar_en, '— no, es principal —')}</select></td>
      <td><input type="checkbox" style="width:auto" ${r.ignorar ? 'checked' : ''} onchange="cambiarRuta('${r.id}','ignorar',this.checked)"></td>
      <td>${r.cliente_id && !r.agrupar_en && !r.ignorar ? `<button class="${conTarifa.has(r.id) ? 'sec' : ''} peq" onclick="tarifasRuta('${r.id}')">${conTarifa.has(r.id) ? 'Ver tarifa' : 'Poner tarifa'}</button>` : ''}</td>
    </tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay rutas en esta vista.</div>'}</div>`;
  $('#fr-ver').onchange = (e) => { fRutas.ver = e.target.value; pRutas(); };
  $('#fr-buscar').oninput = (e) => { fRutas.buscar = e.target.value; clearTimeout(pRutas.t); pRutas.t = setTimeout(() => { pRutas().then(() => { const b = $('#fr-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }); }, 350); };
}
async function cambiarRuta(id, campo, valor) {
  const cambio = { [campo]: valor === '' ? null : valor };
  if (campo === 'agrupar_en' && valor) cambio.cliente_id = null;
  await q(db().from('rutas').update(cambio).eq('id', id));
  aviso('Ruta actualizada'); pRutas();
}
function nuevaRuta() {
  modal(`<h1>Nueva ruta</h1><p class="ayuda">Para servicios que no pasan por TransControl.</p>
  <label>Nombre</label><input id="r-nombre" placeholder="Madrid – Vitoria">
  <label>Cliente</label><select id="r-cliente">${opciones(S.clientes)}</select>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button onclick="guardarRutaNueva()">Crear</button></div>`);
}
async function guardarRutaNueva() {
  if (!val('r-nombre') || !val('r-cliente')) return aviso('Nombre y cliente son obligatorios', true);
  await q(db().from('rutas').insert({ nombre: val('r-nombre'), cliente_id: val('r-cliente') }));
  cerrarModal(); fRutas.ver = 'asignadas'; pRutas();
}

async function tarifasRuta(rutaId) {
  const r = await q(db().from('rutas').select('*').eq('id', rutaId).single());
  const cli = S.clientes.find((c) => c.id === r.cliente_id);
  const [propias, generales] = await Promise.all([
    q(db().from('tarifas').select('*').eq('ruta_id', rutaId).order('tipo').order('vigente_desde', { ascending: false })),
    q(db().from('tarifas').select('*').eq('cliente_id', r.cliente_id).is('ruta_id', null).order('tipo').order('vigente_desde', { ascending: false }))
  ]);
  modal(`<h1>Tarifa · ${esc(r.nombre)}</h1>
  <p class="ayuda">Cliente: <b>${esc(cli?.nombre)}</b>. Si cambia un precio, añade uno nuevo con su fecha «Desde»: los viajes anteriores mantienen el precio antiguo.</p>
  ${tablaTarifas(propias, `tarifasRuta('${rutaId}')`)}
  ${formTarifa(`guardarTarifa('${r.cliente_id}','${rutaId}')`, ['viaje', 'parada', 'hora_espera', 'festivo', 'otro'])}
  <h2>Tarifas generales de ${esc(cli?.nombre)} (valen para todas sus rutas)</h2>
  ${generales.length ? tablaTarifas(generales, null) : '<p class="ayuda">No tiene. Se ponen en Clientes.</p>'}
  <div class="acciones"><button onclick="cerrarModal();pRutas()">Hecho</button></div>`);
}
function tablaTarifas(lista, recargar) {
  if (!lista.length) return '<p class="ayuda">Todavía no hay precios.</p>';
  return `<div class="tabla-wrap"><table><tr><th>Concepto</th><th class="num">Precio</th><th>Desde</th><th>Hasta</th><th></th></tr>
  ${lista.map((t) => `<tr><td>${esc(TIPOS_TARIFA[t.tipo])}${t.descripcion ? ' · ' + esc(t.descripcion) : ''}</td>
    <td class="num">${t.tipo === 'recargo_gasoil_pct' ? num(t.precio) + ' %' : eur(t.precio)}</td><td>${fecha(t.vigente_desde)}</td><td>${fecha(t.vigente_hasta)}</td>
    <td>${recargar ? `<button class="sec peq" onclick="borrarTarifa('${t.id}', ${esc(JSON.stringify(recargar))})">Borrar</button>` : ''}</td></tr>`).join('')}
  </table></div>`;
}
function formTarifa(accion, tipos) {
  return `<div class="barra" style="margin-top:12px">
    <div class="campo"><label>Concepto</label><select id="t-tipo">${tipos.map((t) => `<option value="${t}">${TIPOS_TARIFA[t]}</option>`).join('')}</select></div>
    <div class="campo"><label>Precio (€ o %)</label><input type="number" step="0.01" id="t-precio"></div>
    <div class="campo"><label>Desde</label><input type="date" id="t-desde" value="2026-01-01"></div>
    <div class="campo"><label>Nota</label><input id="t-desc" placeholder="opcional"></div>
    <button onclick="${accion}">Añadir precio</button></div>`;
}
async function guardarTarifa(clienteId, rutaId) {
  if (val('t-precio') == null) return aviso('Pon el precio', true);
  await q(db().from('tarifas').insert({ cliente_id: clienteId, ruta_id: rutaId || null, tipo: val('t-tipo'), precio: val('t-precio'), vigente_desde: val('t-desde') || hoy(), descripcion: val('t-desc') }));
  aviso('Precio añadido');
  rutaId ? tarifasRuta(rutaId) : editarCliente(clienteId);
}
async function borrarTarifa(id, recargar) { if (!confirm('¿Borrar este precio?')) return; await q(db().from('tarifas').delete().eq('id', id)); eval(recargar); }

/* ---------------------------------------------------------------- CLIENTES */
async function pClientes() {
  await recargarMaestros();
  const rutas = await q(db().from('rutas').select('cliente_id').not('cliente_id', 'is', null));
  const nr = rutas.reduce((m, r) => (m[r.cliente_id] = (m[r.cliente_id] || 0) + 1, m), {});
  $('#pagina').innerHTML = `
  <h1>Clientes</h1>
  <div class="barra"><button onclick="editarCliente()">+ Nuevo cliente</button></div>
  <div class="tabla-wrap"><table><tr><th>Cliente</th><th>CIF</th><th>Población</th><th class="num">Vencimiento</th><th class="num">Rutas</th><th>Facturación</th></tr>
  ${S.clientes.map((c) => `<tr class="clic" onclick="editarCliente('${c.id}')"><td><b>${esc(c.nombre)}</b></td><td>${esc(c.cif) || et('ambar', 'Falta CIF')}</td><td>${esc(c.poblacion)}</td>
    <td class="num">${c.dias_vencimiento} días</td><td class="num">${nr[c.id] || 0}</td><td>${esc(c.agrupar_facturas)}</td></tr>`).join('')}
  </table>${S.clientes.length ? '' : '<div class="vacio">Aún no hay clientes. Crea Lactalis, STEF…</div>'}</div>`;
}
async function editarCliente(id) {
  const c = id ? await q(db().from('clientes').select('*').eq('id', id).single()) : { dias_vencimiento: 60, forma_pago: 'Transferencia', agrupar_facturas: 'mensual' };
  const tar = id ? await q(db().from('tarifas').select('*').eq('cliente_id', id).is('ruta_id', null).order('tipo').order('vigente_desde', { ascending: false })) : [];
  const campo = (k, t, tipo = 'text') => `<div><label>${t}</label><input id="c-${k}" type="${tipo}" value="${esc(c[k])}"></div>`;
  modal(`<h1>${id ? esc(c.nombre) : 'Nuevo cliente'}</h1>
  <div class="rejilla">
    ${campo('nombre', 'Nombre / razón social')}${campo('cif', 'CIF')}${campo('direccion', 'Dirección')}${campo('cp', 'C.P.')}
    ${campo('poblacion', 'Población')}${campo('provincia', 'Provincia')}${campo('email_facturas', 'Email para facturas', 'email')}
    ${campo('forma_pago', 'Forma de pago')}${campo('dias_vencimiento', 'Días de vencimiento', 'number')}
    <div><label>Agrupar facturas</label><select id="c-agrupar_facturas">${['mensual', 'quincenal', 'por_viaje'].map((x) => `<option ${c.agrupar_facturas === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
  </div>
  <label>Notas</label><textarea id="c-notas">${esc(c.notas)}</textarea>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cerrar</button><button onclick="guardarCliente(${id ? `'${id}'` : ''})">Guardar cliente</button></div>
  ${id ? `<h2>Tarifas generales del cliente</h2>
  <p class="ayuda">Valen para todas sus rutas salvo que la ruta tenga su propio precio. Típico: precio por parada, hora de espera, festivo y recargo de gasoil (%).</p>
  ${tablaTarifas(tar, `editarCliente('${id}')`)}
  ${formTarifa(`guardarTarifa('${id}',null)`, ['parada', 'hora_espera', 'festivo', 'recargo_gasoil_pct', 'viaje', 'otro'])}` : ''}`);
}
async function guardarCliente(id) {
  const reg = {};
  ['nombre', 'cif', 'direccion', 'cp', 'poblacion', 'provincia', 'email_facturas', 'forma_pago', 'dias_vencimiento', 'agrupar_facturas', 'notas'].forEach((k) => (reg[k] = val('c-' + k)));
  if (!reg.nombre) return aviso('El nombre es obligatorio', true);
  reg.dias_vencimiento = Number(reg.dias_vencimiento || 60);
  if (id) await q(db().from('clientes').update(reg).eq('id', id));
  else id = (await q(db().from('clientes').insert(reg).select('id').single())).id;
  await recargarMaestros(); aviso('Cliente guardado');
  if (location.hash.startsWith('#clientes')) { await pClientes(); }
  editarCliente(id);
}

/* ---------------------------------------------------------------- FACTURAS */
const fFact = { estado: '', cliente: '', anio: hoy().slice(0, 4) };
async function pFacturas() {
  let qy = db().from('v_facturas').select('*').order('creado_en', { ascending: false }).limit(500);
  if (fFact.cliente) qy = qy.eq('cliente_id', fFact.cliente);
  if (fFact.estado) qy = qy.eq('estado_cobro', fFact.estado);
  if (fFact.anio) qy = qy.or(`anio.eq.${fFact.anio},estado.eq.borrador`);
  const lista = await q(qy);
  $('#pagina').innerHTML = `
  <h1>Facturas</h1>
  <div class="barra">
    <div class="campo"><label>Estado</label><select id="ff-estado">${[['', 'Todas'], ['borrador', 'Borradores'], ['pendiente', 'Pendientes de cobro'], ['vencida', 'Vencidas'], ['cobrada', 'Cobradas']].map(([k, t]) => `<option value="${k}" ${fFact.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Cliente</label><select id="ff-cliente">${opciones(S.clientes, fFact.cliente, 'Todos')}</select></div>
    <div class="campo"><label>Año</label><input type="number" id="ff-anio" value="${fFact.anio}" style="width:100px"></div>
    <button onclick="nuevaPrefactura()">+ Nueva prefactura</button>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Número</th><th>Fecha</th><th>Cliente</th><th>Periodo</th><th class="num">Base</th><th class="num">Total</th><th class="num">Cobrado</th><th>Estado</th></tr>
    ${lista.map((f) => { const [c, t] = ESTADO_FACT[f.estado_cobro] || ['gris', f.estado_cobro]; return `<tr class="clic" onclick="location.hash='factura/${f.id}'">
      <td><b>${f.codigo || '—'}</b></td><td>${fecha(f.fecha)}</td><td>${esc(f.cliente_nombre)}</td><td>${fecha(f.periodo_desde)}${f.periodo_hasta ? ' – ' + fecha(f.periodo_hasta) : ''}</td>
      <td class="num">${eur(f.base)}</td><td class="num">${eur(f.total)}</td><td class="num">${f.estado === 'emitida' ? eur(f.cobrado) : ''}</td><td>${et(c, t)}</td></tr>`; }).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay facturas con estos filtros.</div>'}</div>`;
  ['estado', 'cliente', 'anio'].forEach((k) => { $('#ff-' + k).onchange = (e) => { fFact[k] = e.target.value; pFacturas(); }; });
}
function nuevaPrefactura() {
  if (!S.empresa) return aviso('Primero rellena los datos de la empresa', true);
  modal(`<h1>Nueva prefactura</h1>
  <p class="ayuda">Junta en un borrador todos los viajes sin facturar del cliente en ese periodo, con sus paradas, extras y recargos. Puedes revisarlo antes de emitir.</p>
  <label>Cliente</label><select id="n-cliente">${opciones(S.clientes)}</select>
  <div class="rejilla"><div><label>Desde</label><input type="date" id="n-desde" value="${inicioMes(mesAnterior())}"></div>
  <div><label>Hasta</label><input type="date" id="n-hasta" value="${mesAnterior()}"></div></div>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button onclick="crearPrefactura()">Crear borrador</button></div>`);
}
async function crearPrefactura() {
  if (!val('n-cliente')) return aviso('Elige un cliente', true);
  const id = await q(db().rpc('crear_prefactura', { p_cliente: val('n-cliente'), p_desde: val('n-desde'), p_hasta: val('n-hasta') }));
  cerrarModal(); location.hash = 'factura/' + id;
}

async function pFactura(id) {
  const [f, lineas, cobros] = await Promise.all([
    q(db().from('v_facturas').select('*').eq('id', id).single()),
    q(db().from('factura_lineas').select('*').eq('factura_id', id).order('orden')),
    q(db().from('cobros').select('*').eq('factura_id', id).order('fecha'))
  ]);
  const cli = S.clientes.find((c) => c.id === f.cliente_id) || {};
  const borr = f.estado === 'borrador';
  const [c, t] = ESTADO_FACT[f.estado_cobro] || ['gris', f.estado_cobro];
  $('#pagina').innerHTML = `
  <p><a href="#facturas">← Facturas</a></p>
  <h1>${borr ? 'Prefactura (borrador)' : 'Factura ' + f.codigo} ${et(c, t)}</h1>
  <div class="kpis">
    <div class="kpi"><div class="t">Cliente</div><div class="n" style="font-size:18px">${esc(f.cliente_nombre)}</div><div class="t">${esc(cli.cif || 'Falta CIF del cliente')}</div></div>
    <div class="kpi"><div class="t">Periodo</div><div class="n" style="font-size:18px">${fecha(f.periodo_desde)} – ${fecha(f.periodo_hasta)}</div></div>
    <div class="kpi"><div class="t">${borr ? 'Total' : 'Fecha / vencimiento'}</div><div class="n" style="font-size:18px">${borr ? eur(f.total) : fecha(f.fecha) + ' → ' + fecha(f.vencimiento)}</div></div>
    ${borr ? '' : `<div class="kpi"><div class="t">Pendiente de cobro</div><div class="n" style="font-size:18px">${eur(f.total - f.cobrado)}</div></div>`}
  </div>
  <div class="barra">
    <button class="sec" onclick="imprimirFactura('${id}')">🖨 Ver / imprimir PDF</button>
    ${borr ? `<button class="sec" onclick="anadirLinea('${id}')">+ Línea manual</button>
      <button class="peligro" onclick="borrarBorrador('${id}')">Borrar borrador</button>
      <span style="margin-left:auto"></span>
      <div class="campo"><label>Fecha de factura</label><input type="date" id="e-fecha" value="${hoy()}"></div>
      <button onclick="emitir('${id}')">Emitir factura</button>` : `<button onclick="registrarCobro('${id}', ${f.total - f.cobrado})">+ Registrar cobro</button>`}
  </div>
  ${borr ? '<p class="ayuda">Al emitir se le asigna el número correlativo y ya no se puede modificar ni borrar (los errores se corrigen con una factura rectificativa).</p>' : ''}
  <div class="tabla-wrap"><table><tr><th>Concepto</th><th class="num">Cantidad</th><th class="num">Precio</th><th class="num">Importe</th>${borr ? '<th></th>' : ''}</tr>
    ${lineas.map((l) => `<tr><td>${l.precio == 0 ? et('rojo', 'Sin precio') + ' ' : ''}${esc(l.concepto)}</td><td class="num">${num(l.cantidad)}</td><td class="num">${eur(l.precio)}</td><td class="num">${eur(l.importe)}</td>
      ${borr ? `<td><button class="sec peq" onclick="editarLinea('${l.id}','${id}')">Editar</button></td>` : ''}</tr>`).join('')}
  </table></div>
  <div class="totales tarjeta" style="margin-top:12px">
    <div><span>Base imponible</span><span>${eur(f.base)}</span></div>
    <div><span>IVA ${num(f.iva_pct, 0)} %</span><span>${eur(f.iva)}</span></div>
    <div class="tot"><span>Total</span><span>${eur(f.total)}</span></div>
  </div>
  ${borr ? '' : `<h2>Cobros</h2>
  ${cobros.length ? `<div class="tabla-wrap"><table><tr><th>Fecha</th><th>Medio</th><th>Notas</th><th class="num">Importe</th><th></th></tr>
    ${cobros.map((co) => `<tr><td>${fecha(co.fecha)}</td><td>${esc(co.medio)}</td><td>${esc(co.notas)}</td><td class="num">${eur(co.importe)}</td><td><button class="sec peq" onclick="borrarCobro('${co.id}','${id}')">Quitar</button></td></tr>`).join('')}
  </table></div>` : '<p class="ayuda">Sin cobros registrados.</p>'}`}`;
}
async function editarLinea(lineaId, facturaId) {
  const l = await q(db().from('factura_lineas').select('*').eq('id', lineaId).single());
  modal(`<h1>Editar línea</h1>
  <label>Concepto</label><input id="l-concepto" value="${esc(l.concepto)}">
  <div class="rejilla"><div><label>Cantidad</label><input type="number" step="0.01" id="l-cant" value="${l.cantidad}"></div>
  <div><label>Precio</label><input type="number" step="0.01" id="l-precio" value="${l.precio}"></div></div>
  <div class="acciones"><button class="peligro izq" onclick="borrarLinea('${lineaId}','${facturaId}','${l.viaje_id || ''}')">Quitar línea</button>
  <button class="sec" onclick="cerrarModal()">Cancelar</button><button onclick="guardarLinea('${lineaId}','${facturaId}')">Guardar</button></div>`);
}
async function guardarLinea(lineaId, facturaId) {
  const reg = { concepto: val('l-concepto'), cantidad: Number(val('l-cant') || 0), precio: Number(val('l-precio') || 0) };
  if (lineaId) await q(db().from('factura_lineas').update(reg).eq('id', lineaId));
  else await q(db().from('factura_lineas').insert({ ...reg, factura_id: facturaId, orden: 500000 }));
  await q(db().rpc('recalcular_factura', { p_factura: facturaId }));
  cerrarModal(); pFactura(facturaId);
}
function anadirLinea(facturaId) {
  modal(`<h1>Línea manual</h1>
  <label>Concepto</label><input id="l-concepto" placeholder="Ej.: Servicio extra">
  <div class="rejilla"><div><label>Cantidad</label><input type="number" step="0.01" id="l-cant" value="1"></div>
  <div><label>Precio</label><input type="number" step="0.01" id="l-precio"></div></div>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button onclick="guardarLinea(null,'${facturaId}')">Añadir</button></div>`);
}
async function borrarLinea(lineaId, facturaId, viajeId) {
  await q(db().from('factura_lineas').delete().eq('id', lineaId));
  if (viajeId) {
    const quedan = await q(db().from('factura_lineas').select('id').eq('factura_id', facturaId).eq('viaje_id', viajeId));
    if (!quedan.length) await q(db().from('viajes').update({ factura_id: null }).eq('id', viajeId));
  }
  await q(db().rpc('recalcular_factura', { p_factura: facturaId }));
  cerrarModal(); pFactura(facturaId);
}
async function borrarBorrador(id) {
  if (!confirm('¿Borrar este borrador? Los viajes vuelven a quedar pendientes de facturar.')) return;
  await q(db().from('facturas').delete().eq('id', id)); location.hash = 'facturas';
}
async function emitir(id) {
  const f = val('e-fecha');
  if (!confirm(`¿Emitir la factura con fecha ${fecha(f)}? Se le asignará número y ya no se podrá modificar.`)) return;
  const codigo = await q(db().rpc('emitir_factura', { p_factura: id, p_fecha: f }));
  aviso('Factura ' + codigo + ' emitida'); pFactura(id);
}
function registrarCobro(id, pendiente) {
  modal(`<h1>Registrar cobro</h1>
  <div class="rejilla"><div><label>Fecha</label><input type="date" id="co-fecha" value="${hoy()}"></div>
  <div><label>Importe</label><input type="number" step="0.01" id="co-importe" value="${Number(pendiente).toFixed(2)}"></div>
  <div><label>Medio</label><select id="co-medio"><option>Transferencia</option><option>Confirming</option><option>Pagaré</option><option>Recibo</option><option>Efectivo</option></select></div></div>
  <label>Notas</label><input id="co-notas">
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button onclick="guardarCobro('${id}')">Guardar</button></div>`);
}
async function guardarCobro(id) {
  await q(db().from('cobros').insert({ factura_id: id, fecha: val('co-fecha'), importe: val('co-importe'), medio: val('co-medio'), notas: val('co-notas') }));
  cerrarModal(); aviso('Cobro registrado'); pFactura(id);
}
async function borrarCobro(cobroId, id) { if (!confirm('¿Quitar este cobro?')) return; await q(db().from('cobros').delete().eq('id', cobroId)); pFactura(id); }

async function imprimirFactura(id) {
  const ventana = window.open('', '_blank');
  const [f, lineas] = await Promise.all([
    q(db().from('facturas').select('*').eq('id', id).single()),
    q(db().from('factura_lineas').select('*').eq('factura_id', id).order('orden'))
  ]);
  const e = S.empresa || {}; const c = S.clientes.find((x) => x.id === f.cliente_id) || {};
  const borr = f.estado === 'borrador';
  const dir = (x) => [x.direccion, [x.cp, x.poblacion].filter(Boolean).join(' '), x.provincia].filter(Boolean).map(esc).join('<br>');
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${borr ? 'Prefactura' : 'Factura ' + f.codigo}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:30px}h1{color:#1f4e79;font-size:24px;margin:0}table{width:100%;border-collapse:collapse;margin-top:20px}
  th{background:#1f4e79;color:#fff;padding:6px;text-align:left;font-size:11px}td{padding:5px 6px;border-bottom:1px solid #ddd}.n{text-align:right;white-space:nowrap}
  .cab{display:flex;justify-content:space-between;gap:30px}.caja{border:1px solid #ccc;padding:10px;border-radius:4px;min-width:250px}.tot{width:280px;margin-left:auto;margin-top:12px}
  .tot td{border:0}.tot tr:last-child td{font-weight:bold;font-size:15px;border-top:2px solid #222}.pie{margin-top:30px;font-size:11px;color:#555}
  .marca{position:fixed;top:40%;left:15%;font-size:80px;color:rgba(200,0,0,.12);transform:rotate(-25deg)}@media print{.np{display:none}}</style></head><body>
  ${borr ? '<div class="marca">BORRADOR</div>' : ''}
  <p class="np"><button onclick="print()">Imprimir / Guardar PDF</button></p>
  <div class="cab"><div><h1>${esc(e.razon_social || 'Datos de empresa sin rellenar')}</h1>CIF: ${esc(e.cif)}<br>${dir(e)}<br>${esc(e.telefono || '')} ${esc(e.email || '')}</div>
  <div style="text-align:right"><h1>${borr ? 'PREFACTURA' : 'FACTURA'}</h1><b>${borr ? 'Sin número' : 'Nº ' + f.codigo}</b><br>Fecha: ${fecha(f.fecha) || '—'}<br>${f.vencimiento ? 'Vencimiento: ' + fecha(f.vencimiento) : ''}</div></div>
  <div class="caja" style="margin-top:20px"><b>Cliente</b><br>${esc(c.nombre)}<br>CIF: ${esc(c.cif)}<br>${dir(c)}</div>
  ${f.periodo_desde ? `<p>Servicios de transporte del ${fecha(f.periodo_desde)} al ${fecha(f.periodo_hasta)}</p>` : ''}
  <table><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
  ${lineas.map((l) => `<tr><td>${esc(l.concepto)}</td><td class="n">${num(l.cantidad)}</td><td class="n">${eur(l.precio)}</td><td class="n">${eur(l.importe)}</td></tr>`).join('')}</table>
  <table class="tot"><tr><td>Base imponible</td><td class="n">${eur(f.base)}</td></tr><tr><td>IVA ${num(f.iva_pct, 0)} %</td><td class="n">${eur(f.iva)}</td></tr><tr><td>TOTAL</td><td class="n">${eur(f.total)}</td></tr></table>
  <div class="pie">Forma de pago: ${esc(c.forma_pago || 'Transferencia')}${e.iban ? ' · IBAN: ' + esc(e.iban) : ''}</div>
  </body></html>`);
  ventana.document.close();
}

/* ---------------------------------------------------------------- EMPRESA */
async function pEmpresa() {
  const e = S.empresa || { iva_defecto: 21, serie_facturas: 'F', serie_rectificativas: 'R', dias_aviso_vencimientos: 30, dias_aviso_sin_facturar: 7 };
  const campo = (k, t, tipo = 'text') => `<div><label>${t}</label><input id="e-${k}" type="${tipo}" value="${esc(e[k])}"></div>`;
  $('#pagina').innerHTML = `<h1>Datos de la empresa</h1>
  <div class="tarjeta">
  <p class="ayuda">Salen en la cabecera de todas las facturas.</p>
  <div class="rejilla">${campo('razon_social', 'Razón social')}${campo('cif', 'CIF')}${campo('direccion', 'Dirección')}${campo('cp', 'C.P.')}
  ${campo('poblacion', 'Población')}${campo('provincia', 'Provincia')}${campo('telefono', 'Teléfono')}${campo('email', 'Email', 'email')}${campo('iban', 'IBAN para cobros')}</div>
  <h2>Ajustes</h2>
  <div class="rejilla">${campo('iva_defecto', 'IVA por defecto (%)', 'number')}${campo('serie_facturas', 'Serie de facturas')}${campo('serie_rectificativas', 'Serie rectificativas')}
  ${campo('dias_aviso_vencimientos', 'Avisar vencimientos con (días)', 'number')}${campo('dias_aviso_sin_facturar', 'Avisar viajes sin facturar tras (días)', 'number')}</div>
  <div class="acciones"><button onclick="guardarEmpresa()">Guardar</button></div></div>`;
}
async function guardarEmpresa() {
  const reg = { id: 1 };
  ['razon_social', 'cif', 'direccion', 'cp', 'poblacion', 'provincia', 'telefono', 'email', 'iban', 'serie_facturas', 'serie_rectificativas'].forEach((k) => (reg[k] = val('e-' + k)));
  ['iva_defecto', 'dias_aviso_vencimientos', 'dias_aviso_sin_facturar'].forEach((k) => (reg[k] = Number(val('e-' + k))));
  if (!reg.razon_social || !reg.cif) return aviso('Razón social y CIF son obligatorios', true);
  await q(db().from('empresa').upsert(reg));
  await recargarMaestros(); aviso('Datos de la empresa guardados');
}

/* ---------------------------------------------------------------- PRÓXIMAMENTE */
function pProximamente(_id, pag) {
  const txt = {
    flota: 'Camiones y remolques con sus vencimientos (ITV, seguro, tacógrafo, ATP) y avisos.',
    conductores: 'Ficha de cada conductor, documentos con caducidad (carné, CAP, tarjeta), dietas, anticipos, horas y vacaciones.',
    gastos: 'Facturas de proveedores con foto/PDF y lectura automática: gasoil, peajes, talleres… y coste por camión.',
    gestoria: 'Paquete mensual para la gestoría: ZIP con todas las facturas + Excel resumen + resumen de nóminas.'
  }[pag] || 'Esta página no existe.';
  $('#pagina').innerHTML = `<h1>${esc((MENU.find((m) => m[0] === pag) || [, 'Página'])[1])}</h1><div class="tarjeta"><p>Módulo en preparación.</p><p class="ayuda">${esc(txt)}</p></div>`;
}

arrancar();
