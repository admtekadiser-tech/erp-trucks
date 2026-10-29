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
  ['clientes', 'Clientes'], ['flota', 'Flota'], ['conductores', 'Conductores'], ['incidencias', 'Incidencias'], ['litigios', 'Litigios'], ['gastos', 'Gastos'],
  ['gestoria', 'Gestoría'], ['empresa', 'Empresa']
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
  const PAG = { inicio: pInicio, viajes: pViajes, facturas: pFacturas, factura: pFactura, rutas: pRutas, clientes: pClientes, empresa: pEmpresa,
    flota: pFlota, conductores: pConductores, gastos: pGastos, gestoria: pGestoria, incidencias: pIncidencias, litigios: pLitigios };
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
  const [alertasBase, seguimiento, pend, cobro, mes, sinAsig] = await Promise.all([
    q(db().from('v_alertas').select('*').order('fecha')),
    q(db().from('v_alertas_seguimiento').select('*')),
    q(db().from('v_viajes').select('importe').is('factura_id', null).in('estado', ['pendiente', 'revisado'])),
    q(db().from('v_facturas_cobro').select('pendiente,estado_cobro').neq('estado_cobro', 'cobrada')),
    q(db().from('facturas').select('base').eq('estado', 'emitida').gte('fecha', inicioMes())),
    q(db().from('v_rutas_sin_asignar').select('id', { count: 'exact' }))
  ]);
  const alertas = [...alertasBase, ...seguimiento].sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || '')));
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
  ${alertas.length ? alertas.map((a) => `<div class="alerta ${a.nivel}">${et(a.nivel, { flota: 'Flota', conductores: 'Conductor', cobros: 'Cobro', facturacion: 'Facturación', incidencias: 'Incidencia', litigios: 'Litigio' }[a.grupo])} ${esc(a.texto)}<span class="f">${fecha(a.fecha)}</span></div>`).join('')
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
  <div><label>Medio</label><select id="co-medio"><option>Transferencia</option><option>Confirming</option><option>Pagaré</option><option>Recibo</option><option>Efectivo</option><option>Compensación litigio</option></select></div></div>
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
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${f.estado === 'borrador' ? 'Prefactura' : 'Factura ' + f.codigo}</title>
  <style>body{margin:30px}@media print{.np{display:none}}</style></head><body>
  <p class="np"><button onclick="print()">Imprimir / Guardar PDF</button></p>${htmlFactura(f, lineas)}</body></html>`);
  ventana.document.close();
}
// HTML de la factura (se usa para imprimir y para generar los PDF del paquete de la gestoría)
function htmlFactura(f, lineas) {
  const e = S.empresa || {}; const c = S.clientes.find((x) => x.id === f.cliente_id) || {};
  const borr = f.estado === 'borrador';
  const dir = (x) => [x.direccion, [x.cp, x.poblacion].filter(Boolean).join(' '), x.provincia].filter(Boolean).map(esc).join('<br>');
  return `<div class="fx"><style>.fx{font-family:Arial,sans-serif;font-size:12px;color:#222;position:relative}.fx h1{color:#1f4e79;font-size:22px;margin:0}
  .fx table{width:100%;border-collapse:collapse;margin-top:18px}.fx th{background:#1f4e79;color:#fff;padding:6px;text-align:left;font-size:11px}
  .fx td{padding:5px 6px;border-bottom:1px solid #ddd}.fx .n{text-align:right;white-space:nowrap}.fx .cab{display:flex;justify-content:space-between;gap:30px}
  .fx .caja{border:1px solid #ccc;padding:10px;border-radius:4px;max-width:340px}.fx .tot{width:280px;margin-left:auto;margin-top:12px}
  .fx .tot td{border:0}.fx .tot tr:last-child td{font-weight:bold;font-size:15px;border-top:2px solid #222}.fx .pie{margin-top:30px;font-size:11px;color:#555}
  .fx .marca{position:absolute;top:220px;left:12%;font-size:80px;color:rgba(200,0,0,.12);transform:rotate(-25deg)}</style>
  ${borr ? '<div class="marca">BORRADOR</div>' : ''}
  <div class="cab"><div><h1>${esc(e.razon_social || 'Datos de empresa sin rellenar')}</h1>CIF: ${esc(e.cif)}<br>${dir(e)}<br>${esc(e.telefono || '')} ${esc(e.email || '')}</div>
  <div style="text-align:right"><h1>${borr ? 'PREFACTURA' : 'FACTURA'}</h1><b>${borr ? 'Sin número' : 'Nº ' + f.codigo}</b><br>Fecha: ${fecha(f.fecha) || '—'}<br>${f.vencimiento ? 'Vencimiento: ' + fecha(f.vencimiento) : ''}</div></div>
  <div class="caja" style="margin-top:18px"><b>Cliente</b><br>${esc(c.nombre)}<br>CIF: ${esc(c.cif)}<br>${dir(c)}</div>
  ${f.periodo_desde ? `<p>Servicios de transporte del ${fecha(f.periodo_desde)} al ${fecha(f.periodo_hasta)}</p>` : ''}
  <table><tr><th>Concepto</th><th class="n">Cant.</th><th class="n">Precio</th><th class="n">Importe</th></tr>
  ${lineas.map((l) => `<tr><td>${esc(l.concepto)}</td><td class="n">${num(l.cantidad)}</td><td class="n">${eur(l.precio)}</td><td class="n">${eur(l.importe)}</td></tr>`).join('')}</table>
  <table class="tot"><tr><td>Base imponible</td><td class="n">${eur(f.base)}</td></tr><tr><td>IVA ${num(f.iva_pct, 0)} %</td><td class="n">${eur(f.iva)}</td></tr><tr><td>TOTAL</td><td class="n">${eur(f.total)}</td></tr></table>
  <div class="pie">Forma de pago: ${esc(c.forma_pago || 'Transferencia')}${e.iban ? ' · IBAN: ' + esc(e.iban) : ''}</div></div>`;
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

function pProximamente() { $('#pagina').innerHTML = '<h1>Página no encontrada</h1><p><a href="#inicio">Volver al inicio</a></p>'; }

/* ---------------------------------------------------------------- ARCHIVOS (fotos / PDF) */
const BUCKET = 'erp-documentos';
async function subirArchivo(inputId, carpeta) {
  const inp = document.getElementById(inputId);
  const file = inp?.files?.[0];
  if (!file) return null;
  if (file.size > 10 * 1024 * 1024) { aviso('El archivo pesa más de 10 MB', true); throw new Error('grande'); }
  const limpio = file.name.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
  const ruta = `${carpeta}/${Date.now()}_${limpio}`;
  await q(sb.storage.from(BUCKET).upload(ruta, file, { contentType: file.type || undefined }));
  return ruta;
}
async function verArchivo(ruta) {
  const w = window.open('', '_blank');
  const d = await q(sb.storage.from(BUCKET).createSignedUrl(ruta, 600));
  w.location = d.signedUrl;
}
const enlaceArchivo = (ruta) => (ruta ? `<a href="javascript:void 0" onclick="event.stopPropagation();verArchivo('${esc(ruta)}')">📎 Ver</a>` : '');
const campoArchivo = (id, actual) => `<div><label>Foto o PDF ${actual ? '(ya tiene: ' + enlaceArchivo(actual) + ')' : ''}</label><input type="file" id="${id}" accept="application/pdf,image/*"></div>`;

function estadoFecha(d) {
  if (!d) return et('gris', 'Sin datos');
  const dias = Math.round((new Date(d + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000);
  const margen = S.empresa?.dias_aviso_vencimientos ?? 30;
  if (dias < 0) return et('rojo', 'Caducado ' + fecha(d));
  if (dias <= margen) return et('ambar', 'Vence ' + fecha(d));
  return et('verde', fecha(d));
}
function cargarScript(url) {
  cargarScript.c = cargarScript.c || {};
  return (cargarScript.c[url] = cargarScript.c[url] || new Promise((ok, ko) => {
    const s = document.createElement('script'); s.src = url; s.onload = ok; s.onerror = () => ko(new Error('No se pudo cargar ' + url)); document.head.appendChild(s);
  }));
}
const mesTexto = (m) => new Date(m + '-15T12:00:00').toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

/* ---------------------------------------------------------------- FLOTA */
const TIPOS_VEH = { tractora: 'Tractora', rigido: 'Camión rígido', semirremolque: 'Semirremolque', remolque: 'Remolque', furgoneta: 'Furgoneta' };
const TIPOS_VENC = { itv: 'ITV', seguro: 'Seguro', tacografo: 'Tacógrafo', atp: 'ATP (frigorífico)', revision: 'Revisión / mantenimiento', tarjeta_transporte: 'Tarjeta de transporte', extintores: 'Extintores', otro: 'Otro' };
const fFlota = { ver: 'activos' };
async function pFlota() {
  let qy = db().from('v_vehiculos').select('*').order('tipo').order('matricula');
  qy = fFlota.ver === 'activos' ? qy.is('fecha_baja', null) : qy.not('fecha_baja', 'is', null);
  const lista = await q(qy);
  $('#pagina').innerHTML = `
  <h1>Flota</h1>
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="fl-ver"><option value="activos" ${fFlota.ver === 'activos' ? 'selected' : ''}>En servicio</option><option value="bajas" ${fFlota.ver === 'bajas' ? 'selected' : ''}>Dados de baja</option></select></div>
    <button onclick="editarVehiculo()">+ Nuevo vehículo</button>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Matrícula</th><th>Tipo</th><th>Marca / modelo</th><th>Frío</th><th>Próximo vencimiento</th></tr>
    ${lista.map((v) => `<tr class="clic" onclick="editarVehiculo('${v.id}')"><td><b>${esc(v.matricula)}</b></td><td>${TIPOS_VEH[v.tipo] || v.tipo}</td>
      <td>${esc([v.marca, v.modelo].filter(Boolean).join(' '))}</td><td>${v.frigorifico ? '❄️' : ''}</td>
      <td>${v.proximo_vencimiento ? (TIPOS_VENC[v.proximo_tipo] || v.proximo_tipo) + ' · ' + estadoFecha(v.proximo_vencimiento) : et('gris', 'Sin vencimientos')}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay vehículos. Pulsa «+ Nuevo vehículo».</div>'}</div>`;
  $('#fl-ver').onchange = (e) => { fFlota.ver = e.target.value; pFlota(); };
}
async function editarVehiculo(id) {
  const v = id ? await q(db().from('vehiculos').select('*').eq('id', id).single()) : { tipo: 'tractora', frigorifico: true, fecha_alta: hoy() };
  const venc = id ? await q(db().from('vehiculo_vencimientos').select('*').eq('vehiculo_id', id).order('renovado').order('fecha_vencimiento')) : [];
  const campo = (k, t, tipo = 'text') => `<div><label>${t}</label><input id="ve-${k}" type="${tipo}" value="${esc(v[k])}"></div>`;
  modal(`<h1>${id ? esc(v.matricula) : 'Nuevo vehículo'}</h1>
  <div class="rejilla">
    ${campo('matricula', 'Matrícula')}
    <div><label>Tipo</label><select id="ve-tipo">${Object.entries(TIPOS_VEH).map(([k, t]) => `<option value="${k}" ${v.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${campo('marca', 'Marca')}${campo('modelo', 'Modelo')}${campo('bastidor', 'Nº bastidor')}${campo('fecha_matriculacion', 'Fecha matriculación', 'date')}
    ${campo('fecha_alta', 'Alta en la empresa', 'date')}${campo('fecha_baja', 'Baja (vendido / retirado)', 'date')}
    <div><label>Frigorífico</label><input type="checkbox" id="ve-frigorifico" style="width:auto" ${v.frigorifico ? 'checked' : ''}></div>
  </div>
  <label>Notas</label><textarea id="ve-notas">${esc(v.notas)}</textarea>
  <div class="acciones">${id ? `<button class="peligro izq" onclick="borrarVehiculo('${id}')">Borrar</button>` : ''}
    <button class="sec" onclick="cerrarModal()">Cerrar</button><button onclick="guardarVehiculo(${id ? `'${id}'` : ''})">Guardar</button></div>
  ${id ? `<h2>Vencimientos</h2>
  <p class="ayuda">Cuando renueves (nueva ITV, nuevo seguro…) pulsa «Renovar» y pon la nueva fecha: el aviso desaparece y queda el historial.</p>
  ${tablaVencimientos(venc, TIPOS_VENC, 'vehiculo_vencimientos', `editarVehiculo('${id}')`)}
  <div class="barra" style="margin-top:12px">
    <div class="campo"><label>Tipo</label><select id="vv-tipo">${Object.entries(TIPOS_VENC).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Vence el</label><input type="date" id="vv-fecha"></div>
    <div class="campo"><label>Importe (opcional)</label><input type="number" step="0.01" id="vv-importe"></div>
    <div class="campo"><label>Nota</label><input id="vv-desc" placeholder="Compañía, nº póliza…"></div>
    ${campoArchivo('vv-archivo')}
    <button onclick="anadirVencimiento('${id}')">Añadir</button>
  </div>` : ''}`);
}
function tablaVencimientos(lista, tipos, tabla, recargar) {
  if (!lista.length) return '<p class="ayuda">Sin vencimientos registrados.</p>';
  return `<div class="tabla-wrap"><table><tr><th>Tipo</th><th>Nota / nº</th><th>Vence</th><th class="num">Importe</th><th>Doc.</th><th></th></tr>
  ${lista.map((x) => `<tr style="${x.renovado ? 'opacity:.5' : ''}"><td>${esc(tipos[x.tipo] || x.tipo)}</td><td>${esc(x.descripcion ?? x.numero ?? '')}</td>
    <td>${x.renovado ? fecha(x.fecha_vencimiento) + ' ' + et('gris', 'Renovado') : estadoFecha(x.fecha_vencimiento)}</td>
    <td class="num">${x.importe != null ? eur(x.importe) : ''}</td><td>${enlaceArchivo(x.archivo_url)}</td>
    <td style="white-space:nowrap">${x.renovado ? '' : `<button class="peq" onclick="renovar('${tabla}','${x.id}', ${esc(JSON.stringify(recargar))})">Renovar</button>`}
      <button class="sec peq" onclick="borrarFila('${tabla}','${x.id}', ${esc(JSON.stringify(recargar))})">Quitar</button></td></tr>`).join('')}
  </table></div>`;
}
async function guardarVehiculo(id) {
  const reg = {};
  ['matricula', 'tipo', 'marca', 'modelo', 'bastidor', 'fecha_matriculacion', 'fecha_alta', 'fecha_baja', 'notas'].forEach((k) => (reg[k] = val('ve-' + k)));
  reg.frigorifico = val('ve-frigorifico');
  if (!reg.matricula) return aviso('La matrícula es obligatoria', true);
  reg.matricula = reg.matricula.toUpperCase().replace(/[\s-]+/g, '');
  if (id) await q(db().from('vehiculos').update(reg).eq('id', id));
  else id = (await q(db().from('vehiculos').insert(reg).select('id').single())).id;
  await recargarMaestros(); aviso('Vehículo guardado'); pFlota(); editarVehiculo(id);
}
async function borrarVehiculo(id) {
  if (!confirm('¿Borrar el vehículo? Si ya tiene viajes o gastos, mejor ponle fecha de baja.')) return;
  await q(db().from('vehiculos').delete().eq('id', id)); cerrarModal(); await recargarMaestros(); pFlota();
}
async function anadirVencimiento(vehId) {
  if (!val('vv-fecha')) return aviso('Pon la fecha de vencimiento', true);
  const archivo = await subirArchivo('vv-archivo', 'flota/' + vehId);
  await q(db().from('vehiculo_vencimientos').insert({ vehiculo_id: vehId, tipo: val('vv-tipo'), fecha_vencimiento: val('vv-fecha'), importe: val('vv-importe'), descripcion: val('vv-desc'), archivo_url: archivo }));
  aviso('Vencimiento añadido'); editarVehiculo(vehId);
}
async function renovar(tabla, id, recargar) {
  const nueva = prompt('Nueva fecha de vencimiento (dd/mm/aaaa):');
  if (!nueva) return;
  const m = nueva.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!m) return aviso('Escribe la fecha así: 15/03/2027', true);
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const viejo = await q(db().from(tabla).select('*').eq('id', id).single());
  const { id: _i, renovado: _r, archivo_url: _a, ...copia } = viejo;
  await q(db().from(tabla).insert({ ...copia, fecha_vencimiento: iso }));
  await q(db().from(tabla).update({ renovado: true }).eq('id', id));
  aviso('Renovado hasta ' + fecha(iso)); eval(recargar);
}
async function borrarFila(tabla, id, recargar) {
  if (!confirm('¿Quitar este registro?')) return;
  await q(db().from(tabla).delete().eq('id', id)); eval(recargar);
}

/* ---------------------------------------------------------------- CONDUCTORES */
const TIPOS_DOC = { carne: 'Carné de conducir', cap: 'CAP', tarjeta_tacografo: 'Tarjeta tacógrafo', reconocimiento_medico: 'Reconocimiento médico', adr: 'ADR', otro: 'Otro' };
const SUBCOND = {
  dietas: { titulo: 'Dietas', campos: [['fecha', 'Fecha', 'date'], ['tipo', 'Tipo', ['completa', 'desayuno', 'comida', 'cena', 'pernocta', 'otro']], ['importe', 'Importe €', 'number'], ['notas', 'Notas']], filtro: 'fecha', total: 'importe' },
  anticipos: { titulo: 'Anticipos', campos: [['fecha', 'Fecha', 'date'], ['importe', 'Importe €', 'number'], ['mes_nomina', 'Se descuenta en', 'month'], ['concepto', 'Concepto']], filtro: 'mes_nomina', total: 'importe' },
  horas_extra: { titulo: 'Horas extra', campos: [['fecha', 'Fecha', 'date'], ['horas', 'Horas', 'number'], ['notas', 'Notas']], filtro: 'fecha', total: 'horas' },
  ausencias: { titulo: 'Vacaciones y ausencias', campos: [['tipo', 'Tipo', ['vacaciones', 'permiso', 'baja', 'otro']], ['desde', 'Desde', 'date'], ['hasta', 'Hasta', 'date'], ['notas', 'Notas']], filtro: 'rango' }
};
const fCond = { ver: 'activos', mes: hoy().slice(0, 7) };
async function pConductores() {
  let qy = db().from('v_conductores').select('*').order('nombre');
  if (fCond.ver === 'activos') qy = qy.eq('activo', true); else if (fCond.ver === 'inactivos') qy = qy.eq('activo', false);
  const lista = await q(qy);
  $('#pagina').innerHTML = `
  <h1>Conductores</h1>
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="co-ver">${[['activos', 'Activos'], ['inactivos', 'De baja'], ['', 'Todos']].map(([k, t]) => `<option value="${k}" ${fCond.ver === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <button class="sec" onclick="sincronizarConductores()">⟳ Traer nuevos de TransControl</button>
    <button onclick="editarConductor()">+ Conductor</button>
  </div>
  <p class="ayuda">Los conductores vienen de TransControl. Aquí se completan su ficha, documentos, dietas, anticipos, horas y vacaciones (lo que se pasa a la gestoría).</p>
  <div class="tabla-wrap"><table>
    <tr><th>Conductor</th><th>DNI</th><th>Teléfono</th><th>Documentos</th><th>Próximo vencimiento</th><th>Estado</th></tr>
    ${lista.map((c) => `<tr class="clic" onclick="editarConductor('${c.id}')"><td><b>${esc(c.nombre)}</b></td><td>${esc(c.dni) || et('ambar', 'Falta')}</td><td>${esc(c.telefono)}</td>
      <td>${c.num_documentos || et('ambar', 'Ninguno')}</td><td>${c.proximo_vencimiento ? (TIPOS_DOC[c.proximo_tipo] || '') + ' · ' + estadoFecha(c.proximo_vencimiento) : ''}</td>
      <td>${c.activo ? et('verde', 'Activo') : et('gris', 'Baja')}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay conductores.</div>'}</div>`;
  $('#co-ver').onchange = (e) => { fCond.ver = e.target.value; pConductores(); };
}
async function sincronizarConductores() {
  await q(db().rpc('sincronizar_conductores'));
  await recargarMaestros(); aviso('Conductores actualizados desde TransControl'); pConductores();
}
async function editarConductor(id, pestana = 'ficha') {
  const c = id ? await q(db().from('conductores').select('*').eq('id', id).single()) : { activo: true };
  const tabs = id ? [['ficha', 'Ficha'], ['documentos', 'Documentos'], ...Object.entries(SUBCOND).map(([k, x]) => [k, x.titulo]), ['incidencias', 'Incidencias']] : [['ficha', 'Ficha']];
  let cuerpo = '';
  if (pestana === 'ficha') {
    const campo = (k, t, tipo = 'text') => `<div><label>${t}</label><input id="cd-${k}" type="${tipo}" value="${esc(c[k])}"></div>`;
    cuerpo = `<div class="rejilla">${campo('nombre', 'Nombre')}${campo('dni', 'DNI / NIE')}${campo('telefono', 'Teléfono', 'tel')}${campo('email', 'Email', 'email')}
      ${campo('fecha_alta', 'Fecha de alta', 'date')}${campo('fecha_baja', 'Fecha de baja', 'date')}
      <div><label>Activo</label><input type="checkbox" id="cd-activo" style="width:auto" ${c.activo ? 'checked' : ''}></div></div>
      ${c.tc_conductor_id ? '<p class="ayuda">Vinculado a TransControl: el nombre se actualiza desde allí.</p>' : ''}
      <label>Notas</label><textarea id="cd-notas">${esc(c.notas)}</textarea>
      <div class="acciones"><button class="sec" onclick="cerrarModal();pConductores()">Cerrar</button><button onclick="guardarConductor(${id ? `'${id}'` : ''})">Guardar ficha</button></div>`;
  } else if (pestana === 'incidencias') {
    const inc = await q(db().from('v_incidencias').select('*').eq('conductor_id', id).order('fecha', { ascending: false }).limit(300));
    cuerpo = `${tablaIncidencias(inc, false)}
    <div class="acciones"><button onclick="editarIncidencia(null,{conductor_id:'${id}'})">+ Incidencia de este conductor</button></div>`;
  } else if (pestana === 'documentos') {
    const docs = await q(db().from('conductor_documentos').select('*').eq('conductor_id', id).order('renovado').order('fecha_vencimiento'));
    cuerpo = `${tablaVencimientos(docs, TIPOS_DOC, 'conductor_documentos', `editarConductor('${id}','documentos')`)}
    <div class="barra" style="margin-top:12px">
      <div class="campo"><label>Documento</label><select id="dc-tipo">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="campo"><label>Número</label><input id="dc-numero"></div>
      <div class="campo"><label>Caduca el</label><input type="date" id="dc-fecha"></div>
      ${campoArchivo('dc-archivo')}
      <button onclick="anadirDocumento('${id}')">Añadir</button></div>`;
  } else {
    cuerpo = await subtablaConductor(id, pestana);
  }
  modal(`<h1>${id ? esc(c.nombre) : 'Nuevo conductor'}</h1>
  <div class="barra">${tabs.map(([k, t]) => `<button class="${k === pestana ? '' : 'sec'} peq" onclick="editarConductor('${id}','${k}')">${t}</button>`).join('')}</div>
  ${cuerpo}`);
}
async function guardarConductor(id) {
  const reg = {};
  ['nombre', 'dni', 'telefono', 'email', 'fecha_alta', 'fecha_baja', 'notas'].forEach((k) => (reg[k] = val('cd-' + k)));
  reg.activo = val('cd-activo');
  if (!reg.nombre) return aviso('El nombre es obligatorio', true);
  if (reg.dni) reg.dni = reg.dni.toUpperCase().replace(/[\s-]/g, '');
  if (id) await q(db().from('conductores').update(reg).eq('id', id));
  else id = (await q(db().from('conductores').insert(reg).select('id').single())).id;
  await recargarMaestros(); aviso('Ficha guardada'); editarConductor(id);
}
async function anadirDocumento(condId) {
  if (!val('dc-fecha')) return aviso('Pon la fecha de caducidad', true);
  const archivo = await subirArchivo('dc-archivo', 'conductores/' + condId);
  await q(db().from('conductor_documentos').insert({ conductor_id: condId, tipo: val('dc-tipo'), numero: val('dc-numero'), fecha_vencimiento: val('dc-fecha'), archivo_url: archivo }));
  aviso('Documento añadido'); editarConductor(condId, 'documentos');
}
async function subtablaConductor(id, tabla) {
  const cfg = SUBCOND[tabla]; const ini = fCond.mes + '-01'; const fin = finMes(ini);
  let qy = db().from(tabla).select('*').eq('conductor_id', id);
  if (cfg.filtro === 'rango') qy = qy.lte('desde', fin).gte('hasta', ini).order('desde');
  else if (cfg.filtro === 'mes_nomina') qy = qy.eq('mes_nomina', ini).order('fecha');
  else qy = qy.gte(cfg.filtro, ini).lte(cfg.filtro, fin).order(cfg.filtro);
  const filas = await q(qy);
  const mostrar = (c, x) => (c[2] === 'date' ? fecha(x[c[0]]) : c[2] === 'month' ? (x[c[0]] ? mesTexto(x[c[0]].slice(0, 7)) : '') : c[2] === 'number' && c[0] === 'importe' ? eur(x[c[0]]) : esc(x[c[0]]));
  const entrada = (c) => Array.isArray(c[2])
    ? `<select id="sc-${c[0]}">${c[2].map((o) => `<option>${o}</option>`).join('')}</select>`
    : `<input id="sc-${c[0]}" type="${c[2] || 'text'}" ${c[2] === 'number' ? 'step="0.01"' : ''} value="${c[2] === 'month' ? fCond.mes : c[2] === 'date' && c[0] !== 'hasta' ? (hoy().startsWith(fCond.mes) ? hoy() : ini) : ''}">`;
  const total = cfg.total ? filas.reduce((a, x) => a + Number(x[cfg.total] || 0), 0) : null;
  return `<div class="barra"><div class="campo"><label>Mes</label><input type="month" id="sc-mes" value="${fCond.mes}" onchange="fCond.mes=this.value;editarConductor('${id}','${tabla}')"></div>
    ${total != null ? `<p style="margin:0 0 8px">Total ${mesTexto(fCond.mes)}: <b>${cfg.total === 'importe' ? eur(total) : num(total) + ' h'}</b></p>` : ''}</div>
  <div class="tabla-wrap"><table><tr>${cfg.campos.map((c) => `<th>${c[1]}</th>`).join('')}<th></th></tr>
    ${filas.map((x) => `<tr>${cfg.campos.map((c) => `<td>${mostrar(c, x)}</td>`).join('')}<td><button class="sec peq" onclick="borrarFila('${tabla}','${x.id}', ${esc(JSON.stringify(`editarConductor('${id}','${tabla}')`))})">Quitar</button></td></tr>`).join('')}
    <tr>${cfg.campos.map((c) => `<td>${entrada(c)}</td>`).join('')}<td><button class="peq" onclick="anadirSub('${id}','${tabla}')">Añadir</button></td></tr>
  </table></div>`;
}
async function anadirSub(id, tabla) {
  const reg = { conductor_id: id };
  for (const c of SUBCOND[tabla].campos) {
    let v = val('sc-' + c[0]);
    if (c[2] === 'month' && v) v = v + '-01';
    reg[c[0]] = v;
  }
  const faltan = SUBCOND[tabla].campos.filter((c) => !['notas', 'concepto'].includes(c[0]) && reg[c[0]] == null);
  if (faltan.length) return aviso('Falta: ' + faltan.map((c) => c[1]).join(', '), true);
  await q(db().from(tabla).insert(reg)); aviso('Añadido'); editarConductor(id, tabla);
}

/* ---------------------------------------------------------------- GASTOS */
const CATEGORIAS = { gasoil: 'Gasoil', adblue: 'AdBlue', peajes: 'Peajes', taller: 'Taller', neumaticos: 'Neumáticos', lavado: 'Lavado', seguro: 'Seguro', itv: 'ITV', tacografo: 'Tacógrafo', atp: 'ATP', financiacion_leasing: 'Leasing / financiación', dietas: 'Dietas', gestoria: 'Gestoría', telefonia: 'Telefonía', oficina: 'Oficina', impuestos_tasas: 'Impuestos y tasas', otros: 'Otros' };
const fGastos = { mes: hoy().slice(0, 7), categoria: '', vehiculo: '' };
async function pGastos() {
  const ini = fGastos.mes + '-01'; const fin = finMes(ini);
  let qy = db().from('gastos').select('*, proveedores(nombre), vehiculos(matricula)').gte('fecha', ini).lte('fecha', fin).order('fecha', { ascending: false });
  if (fGastos.categoria) qy = qy.eq('categoria', fGastos.categoria);
  if (fGastos.vehiculo) qy = qy.eq('vehiculo_id', fGastos.vehiculo);
  const [lista, costes, ingresos] = await Promise.all([
    q(qy), q(db().from('v_coste_vehiculo_mes').select('*').eq('mes', ini)), q(db().from('v_ingreso_vehiculo_mes').select('*').eq('mes', ini))
  ]);
  const porCat = {}; lista.forEach((g) => (porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.base)));
  const tot = (k) => lista.reduce((a, g) => a + Number(g[k] || 0), 0);
  const mats = [...new Set([...costes.map((c) => c.matricula), ...ingresos.map((c) => c.matricula)])].sort();
  $('#pagina').innerHTML = `
  <h1>Gastos</h1>
  <div class="barra">
    <div class="campo"><label>Mes</label><input type="month" id="fg-mes" value="${fGastos.mes}"></div>
    <div class="campo"><label>Categoría</label><select id="fg-categoria"><option value="">Todas</option>${Object.entries(CATEGORIAS).map(([k, t]) => `<option value="${k}" ${fGastos.categoria === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Camión</label><select id="fg-vehiculo">${opciones(S.vehiculos, fGastos.vehiculo, 'Todos', (x) => x.matricula)}</select></div>
    <button onclick="editarGasto()">+ Nuevo gasto</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="t">Gastos ${mesTexto(fGastos.mes)}</div><div class="n">${eur(tot('base'))}</div><div class="t">base · ${lista.length} facturas · IVA ${eur(tot('iva'))}</div></div>
    ${Object.entries(porCat).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `<div class="kpi"><div class="t">${CATEGORIAS[k]}</div><div class="n">${eur(v)}</div></div>`).join('')}
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Fecha</th><th>Proveedor</th><th>Nº factura</th><th>Categoría</th><th>Camión</th><th class="num">Base</th><th class="num">IVA</th><th class="num">Total</th><th>Doc.</th><th>Pago</th></tr>
    ${lista.map((g) => `<tr class="clic" onclick="editarGasto('${g.id}')"><td>${fecha(g.fecha)}</td><td>${esc(g.proveedores?.nombre)}</td><td>${esc(g.num_factura)}</td>
      <td>${CATEGORIAS[g.categoria]}</td><td>${esc(g.vehiculos?.matricula)}</td><td class="num">${eur(g.base)}</td><td class="num">${eur(g.iva)}</td><td class="num">${eur(g.total)}</td>
      <td>${g.archivo_url ? enlaceArchivo(g.archivo_url) : et('ambar', 'Falta')}</td><td>${g.pagado ? et('verde', 'Pagado') : et('gris', 'Pendiente')}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay gastos este mes.</div>'}</div>
  ${mats.length ? `<h2>Rentabilidad por camión · ${mesTexto(fGastos.mes)}</h2>
  <p class="ayuda">Ingresos según tarifas de los viajes con ese camión asignado, menos sus gastos del mes.</p>
  <div class="tabla-wrap"><table><tr><th>Camión</th><th class="num">Viajes</th><th class="num">Ingresos</th><th class="num">Gasoil</th><th class="num">Litros</th><th class="num">Mantenimiento</th><th class="num">Gastos totales</th><th class="num">Resultado</th></tr>
  ${mats.map((m) => { const c = costes.find((x) => x.matricula === m) || {}; const i = ingresos.find((x) => x.matricula === m) || {}; const r = Number(i.ingreso_estimado || 0) - Number(c.gasto_total || 0);
    return `<tr><td><b>${esc(m)}</b></td><td class="num">${i.viajes || 0}</td><td class="num">${eur(i.ingreso_estimado)}</td><td class="num">${eur(c.gasoil)}</td><td class="num">${num(c.litros, 0)}</td>
    <td class="num">${eur(c.mantenimiento)}</td><td class="num">${eur(c.gasto_total)}</td><td class="num" style="color:${r < 0 ? 'var(--rojo)' : 'var(--verde)'}"><b>${eur(r)}</b></td></tr>`; }).join('')}
  </table></div>` : ''}`;
  ['mes', 'categoria', 'vehiculo'].forEach((k) => { $('#fg-' + k).onchange = (e) => { fGastos[k] = e.target.value; pGastos(); }; });
}
async function editarGasto(id) {
  const g = id ? await q(db().from('gastos').select('*, proveedores(nombre,cif)').eq('id', id).single()) : { fecha: hoy(), iva_pct: 21, categoria: 'gasoil', pagado: false };
  const provs = await q(db().from('proveedores').select('*').order('nombre'));
  editarGasto.provs = provs;
  modal(`<h1>${id ? 'Gasto' : 'Nuevo gasto'}</h1>
  <div class="rejilla">
    <div><label>Fecha factura</label><input type="date" id="g-fecha" value="${g.fecha}"></div>
    <div><label>Proveedor</label><input id="g-proveedor" list="l-provs" value="${esc(g.proveedores?.nombre)}" placeholder="Escribe o elige" onchange="proveedorElegido()">
      <datalist id="l-provs">${provs.map((p) => `<option value="${esc(p.nombre)}">`).join('')}</datalist></div>
    <div><label>CIF proveedor</label><input id="g-cif" value="${esc(g.proveedores?.cif)}"></div>
    <div><label>Nº factura</label><input id="g-num" value="${esc(g.num_factura)}"></div>
    <div><label>Categoría</label><select id="g-categoria">${Object.entries(CATEGORIAS).map(([k, t]) => `<option value="${k}" ${g.categoria === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div><label>Camión (si es de uno)</label><select id="g-vehiculo">${opciones(S.vehiculos, g.vehiculo_id, '— general —', (x) => x.matricula)}</select></div>
    <div><label>Conductor (opcional)</label><select id="g-conductor">${opciones(S.conductores, g.conductor_id, '—')}</select></div>
    <div><label>Litros (gasoil)</label><input type="number" step="0.01" id="g-litros" value="${g.litros ?? ''}"></div>
    <div><label>Km del camión</label><input type="number" id="g-km" value="${g.km_vehiculo ?? ''}"></div>
    <div><label>Base imponible €</label><input type="number" step="0.01" id="g-base" value="${g.base ?? ''}" oninput="calcGasto('base')"></div>
    <div><label>IVA %</label><select id="g-iva" onchange="calcGasto('base')">${[21, 10, 4, 0].map((x) => `<option ${Number(g.iva_pct) === x ? 'selected' : ''}>${x}</option>`).join('')}</select></div>
    <div><label>Total con IVA €</label><input type="number" step="0.01" id="g-total" value="${g.total ?? ''}" oninput="calcGasto('total')"></div>
    <div><label>Pagado</label><input type="checkbox" id="g-pagado" style="width:auto" ${g.pagado ? 'checked' : ''}></div>
    ${campoArchivo('g-archivo', g.archivo_url)}
  </div>
  <label>Notas</label><input id="g-notas" value="${esc(g.notas)}">
  <div class="acciones">${id ? `<button class="peligro izq" onclick="borrarGasto('${id}')">Borrar</button>` : ''}
    <button class="sec" onclick="cerrarModal()">Cancelar</button><button id="b-gasto" onclick="guardarGasto(${id ? `'${id}'` : ''})">Guardar</button></div>`);
}
function proveedorElegido() {
  const p = editarGasto.provs.find((x) => x.nombre.toLowerCase() === (val('g-proveedor') || '').toLowerCase());
  if (p) { $('#g-cif').value = p.cif || ''; if (p.categoria_defecto) $('#g-categoria').value = p.categoria_defecto; }
}
function calcGasto(desde) {
  const iva = Number(val('g-iva')) / 100;
  if (desde === 'base') { const b = Number(val('g-base')); $('#g-total').value = val('g-base') == null ? '' : (b * (1 + iva)).toFixed(2); }
  else { const t = Number(val('g-total')); $('#g-base').value = val('g-total') == null ? '' : (t / (1 + iva)).toFixed(2); }
}
async function guardarGasto(id) {
  const nombre = val('g-proveedor');
  if (!val('g-fecha') || val('g-base') == null) return aviso('Fecha e importe son obligatorios', true);
  $('#b-gasto').disabled = true;
  try {
    let provId = null;
    if (nombre) {
      const p = editarGasto.provs.find((x) => x.nombre.toLowerCase() === nombre.toLowerCase());
      if (p) { provId = p.id; if (val('g-cif') && val('g-cif') !== p.cif) await q(db().from('proveedores').update({ cif: val('g-cif') }).eq('id', p.id)); }
      else provId = (await q(db().from('proveedores').insert({ nombre, cif: val('g-cif'), categoria_defecto: val('g-categoria') }).select('id').single())).id;
    }
    const archivo = await subirArchivo('g-archivo', 'gastos/' + val('g-fecha').slice(0, 7));
    const reg = { fecha: val('g-fecha'), proveedor_id: provId, num_factura: val('g-num'), categoria: val('g-categoria'), vehiculo_id: val('g-vehiculo'),
      conductor_id: val('g-conductor'), litros: val('g-litros'), km_vehiculo: val('g-km'), base: val('g-base'), iva_pct: Number(val('g-iva')), pagado: val('g-pagado'), notas: val('g-notas') };
    if (archivo) reg.archivo_url = archivo;
    if (id) await q(db().from('gastos').update(reg).eq('id', id)); else await q(db().from('gastos').insert(reg));
    cerrarModal(); aviso('Gasto guardado'); fGastos.mes = reg.fecha.slice(0, 7); pGastos();
  } catch { const b = $('#b-gasto'); if (b) b.disabled = false; }
}
async function borrarGasto(id) { if (!confirm('¿Borrar este gasto?')) return; await q(db().from('gastos').delete().eq('id', id)); cerrarModal(); pGastos(); }

/* ---------------------------------------------------------------- GESTORÍA */
const fGest = { mes: mesAnterior().slice(0, 7) };
async function datosGestoria() {
  const ini = fGest.mes + '-01'; const fin = finMes(ini);
  const [gastos, facturas, nominas] = await Promise.all([
    q(db().from('v_gastos_gestoria').select('*').eq('mes', ini).order('fecha')),
    q(db().from('v_facturas').select('*').eq('estado', 'emitida').gte('fecha', ini).lte('fecha', fin).order('numero')),
    q(db().from('v_resumen_nomina_mes').select('*').eq('mes', ini).order('conductor'))
  ]);
  return { gastos, facturas, nominas };
}
async function pGestoria() {
  const { gastos, facturas, nominas } = await datosGestoria();
  const sinDoc = gastos.filter((g) => !g.archivo_url).length;
  const enviados = gastos.filter((g) => g.enviado_gestoria_mes).length;
  const sum = (l, k) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
  $('#pagina').innerHTML = `
  <h1>Gestoría</h1>
  <div class="barra">
    <div class="campo"><label>Mes</label><input type="month" id="gs-mes" value="${fGest.mes}"></div>
    <button class="sec" onclick="descargarExcelGestoria()">⬇ Excel resumen</button>
    <button id="b-zip" onclick="descargarZipGestoria()">⬇ Paquete completo (ZIP)</button>
    <button class="sec" onclick="marcarEnviado()">✓ Marcar como enviado</button>
  </div>
  <p class="ayuda">El ZIP lleva el Excel + el PDF de cada factura emitida + las fotos/PDF de las facturas de gastos del mes. Es lo que antes escaneabais una a una.</p>
  ${sinDoc ? `<div class="alerta ambar">${sinDoc} gastos de este mes no tienen la foto/PDF de la factura. <a href="#gastos" style="margin-left:auto">Revisar</a></div>` : ''}
  ${enviados ? `<div class="alerta ambar" style="background:var(--verde-f)">${enviados} de ${gastos.length} gastos ya marcados como enviados a la gestoría.</div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="t">Facturas emitidas</div><div class="n">${facturas.length}</div><div class="t">Base ${eur(sum(facturas, 'base'))} · IVA ${eur(sum(facturas, 'iva'))}</div></div>
    <div class="kpi"><div class="t">Facturas de gastos</div><div class="n">${gastos.length}</div><div class="t">Base ${eur(sum(gastos, 'base'))} · IVA ${eur(sum(gastos, 'iva'))}</div></div>
    <div class="kpi"><div class="t">IVA repercutido − soportado</div><div class="n">${eur(sum(facturas, 'iva') - sum(gastos, 'iva'))}</div><div class="t">orientativo</div></div>
  </div>
  <h2>Datos para nóminas · ${mesTexto(fGest.mes)}</h2>
  <div class="tabla-wrap"><table><tr><th>Conductor</th><th>DNI</th><th class="num">Viajes</th><th class="num">Dietas</th><th class="num">Horas extra</th><th class="num">Anticipos</th><th>Ausencias</th></tr>
  ${nominas.map((n) => `<tr><td>${esc(n.conductor)}</td><td>${esc(n.dni)}</td><td class="num">${n.viajes}</td><td class="num">${eur(n.dietas)}</td><td class="num">${num(n.horas_extra)}</td><td class="num">${eur(n.anticipos)}</td><td>${esc(n.ausencias)}</td></tr>`).join('')}
  </table>${nominas.length ? '' : '<div class="vacio">Sin datos de nómina este mes.</div>'}</div>`;
  $('#gs-mes').onchange = (e) => { fGest.mes = e.target.value; pGestoria(); };
}
async function libroExcel(d) {
  await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const wb = XLSX.utils.book_new();
  const hoja = (filas, nombre) => { const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]); XLSX.utils.book_append_sheet(wb, ws, nombre); };
  const n2 = (x) => Math.round(Number(x || 0) * 100) / 100;
  hoja(d.facturas.map((f) => ({ 'Nº factura': f.codigo, Fecha: fecha(f.fecha), Cliente: f.cliente_nombre, CIF: (S.clientes.find((c) => c.id === f.cliente_id) || {}).cif || '', Base: n2(f.base), 'IVA %': n2(f.iva_pct), IVA: n2(f.iva), Total: n2(f.total), Vencimiento: fecha(f.vencimiento), Cobrado: n2(f.cobrado) })), 'Facturas emitidas');
  hoja(d.gastos.map((g) => ({ Fecha: fecha(g.fecha), Proveedor: g.proveedor || '', CIF: g.cif || '', 'Nº factura': g.num_factura || '', Categoría: CATEGORIAS[g.categoria] || g.categoria, Camión: g.matricula || '', Base: n2(g.base), 'IVA %': n2(g.iva_pct), IVA: n2(g.iva), Total: n2(g.total), 'Con documento': g.archivo_url ? 'Sí' : 'NO' })), 'Facturas recibidas');
  hoja(d.nominas.map((n) => ({ Conductor: n.conductor, DNI: n.dni || '', Viajes: n.viajes, Dietas: n2(n.dietas), 'Horas extra': n2(n.horas_extra), Anticipos: n2(n.anticipos), Ausencias: n.ausencias || '' })), 'Nóminas');
  return wb;
}
async function descargarExcelGestoria() {
  const wb = await libroExcel(await datosGestoria());
  XLSX.writeFile(wb, `gestoria_${fGest.mes}.xlsx`);
}
async function descargarZipGestoria() {
  const b = $('#b-zip'); const txt = b.textContent; b.disabled = true;
  const paso = (t) => (b.textContent = t);
  try {
    paso('Preparando…');
    await Promise.all([
      cargarScript('https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'),
      cargarScript('https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.1/dist/html2pdf.bundle.min.js')
    ]);
    const d = await datosGestoria();
    const zip = new JSZip();
    const wb = await libroExcel(d);
    zip.file(`resumen_${fGest.mes}.xlsx`, XLSX.write(wb, { type: 'array', bookType: 'xlsx' }));
    let i = 0;
    for (const f of d.facturas) {
      paso(`Factura ${++i}/${d.facturas.length}…`);
      const lineas = await q(db().from('factura_lineas').select('*').eq('factura_id', f.id).order('orden'));
      const pdf = await html2pdf().set({ margin: 10, html2canvas: { scale: 2 }, jsPDF: { unit: 'mm', format: 'a4' } }).from(htmlFactura(f, lineas)).outputPdf('blob');
      zip.file(`facturas_emitidas/${f.codigo}.pdf`, pdf);
    }
    i = 0;
    const conDoc = d.gastos.filter((g) => g.archivo_url);
    for (const g of conDoc) {
      paso(`Gasto ${++i}/${conDoc.length}…`);
      const blob = await q(sb.storage.from(BUCKET).download(g.archivo_url));
      const ext = (g.archivo_url.split('.').pop() || 'pdf').toLowerCase();
      const nombre = `${g.fecha}_${(g.proveedor || 'proveedor').replace(/[^\w]+/g, '_')}_${(g.num_factura || i).toString().replace(/[^\w-]+/g, '_')}.${ext}`;
      zip.file(`facturas_recibidas/${nombre}`, blob);
    }
    paso('Comprimiendo…');
    const contenido = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(contenido); a.download = `gestoria_${fGest.mes}.zip`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    aviso('Paquete descargado');
  } catch (e) { console.error(e); aviso('No se pudo generar el paquete: ' + traducirError(e), true); }
  finally { b.disabled = false; b.textContent = txt; }
}
async function marcarEnviado() {
  if (!confirm(`¿Marcar los gastos de ${mesTexto(fGest.mes)} como enviados a la gestoría?`)) return;
  const ini = fGest.mes + '-01';
  await q(db().from('gastos').update({ enviado_gestoria_mes: ini }).gte('fecha', ini).lte('fecha', finMes(ini)));
  aviso('Marcado como enviado'); pGestoria();
}


/* ---------------------------------------------------------------- ARCHIVOS VARIOS (incidencias / litigios) */
async function subirArchivos(inputId, carpeta) {
  const files = [...(document.getElementById(inputId)?.files || [])];
  const rutas = [];
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) { aviso(`«${file.name}» pesa más de 10 MB`, true); throw new Error('grande'); }
    const limpio = file.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.\-]+/g, '_').slice(-80);
    const ruta = `${carpeta}/${Date.now()}_${rutas.length}_${limpio}`;
    await q(sb.storage.from(BUCKET).upload(ruta, file, { contentType: file.type || undefined }));
    rutas.push(ruta);
  }
  return rutas;
}
const enlacesArchivos = (rutas) => (rutas || []).map((r, i) => `<a href="javascript:void 0" onclick="event.stopPropagation();verArchivo('${esc(r)}')">📎 ${i + 1}</a>`).join(' ');
const campoArchivos = (id, actuales) => `<div><label>Fotos / documentos ${actuales?.length ? '(ya tiene: ' + enlacesArchivos(actuales) + ')' : ''}</label><input type="file" id="${id}" accept="application/pdf,image/*" multiple></div>`;
const MOTOR = ['tractora', 'rigido', 'furgoneta'];
const camiones = () => S.vehiculos.filter((v) => MOTOR.includes(v.tipo));
const remolques = () => S.vehiculos.filter((v) => !MOTOR.includes(v.tipo));
const selVeh = (lista, sel) => opciones(lista, sel, '—', (x) => x.matricula);

/* ---------------------------------------------------------------- INCIDENCIAS */
const TIPOS_INC = { averia: 'Avería / rotura', accidente: 'Accidente / golpe', no_se_presenta: 'No va a trabajar', retraso: 'Retraso / se queda dormido', ruta_no_realizada: 'Ruta que no sale', temperatura: 'Problema de frío', multa: 'Multa / sanción', queja_cliente: 'Queja del cliente', otro: 'Otro' };
const RESPONSABLE = { por_determinar: 'Por determinar', conductor: 'Conductor', empresa: 'Empresa', tercero: 'Un tercero', cliente: 'El cliente', ninguna: 'Nadie (fortuito)' };
const ESTADO_INC = { abierta: ['rojo', 'Abierta'], en_curso: ['ambar', 'En curso'], cerrada: ['verde', 'Cerrada'] };
const fInc = { estado: 'abiertas', desde: sumarDias(hoy(), -90), hasta: hoy(), tipo: '', conductor: '', vehiculo: '' };

function tablaIncidencias(lista, conConductor = true) {
  if (!lista.length) return '<div class="tabla-wrap"><div class="vacio">No hay incidencias.</div></div>';
  return `<div class="tabla-wrap"><table>
  <tr><th>Fecha</th><th>Tipo</th>${conConductor ? '<th>Conductor</th>' : ''}<th>Vehículo</th><th>Ruta / cliente</th><th>Qué ha pasado</th><th>Culpa</th><th class="num">Coste</th><th>Estado</th></tr>
  ${lista.map((i) => { const [c, t] = ESTADO_INC[i.estado] || ['gris', i.estado]; const d = i.descripcion || ''; return `<tr class="clic" onclick="editarIncidencia('${i.id}')">
    <td style="white-space:nowrap">${fecha(i.fecha)}${i.hora ? ' ' + i.hora.slice(0, 5) : ''}</td><td>${esc(TIPOS_INC[i.tipo] || i.tipo)}</td>
    ${conConductor ? `<td>${esc(i.conductor_nombre)}</td>` : ''}
    <td>${esc([i.matricula, i.remolque_matricula].filter(Boolean).join(' + '))}${i.vehiculo_parado_desde && !i.vehiculo_parado_hasta ? ' ' + et('rojo', 'Parado') : ''}</td>
    <td>${esc([i.ruta_nombre, i.cliente_nombre].filter(Boolean).join(' · '))}</td>
    <td>${esc(d.slice(0, 90))}${d.length > 90 ? '…' : ''}${i.num_litigios ? ' ' + et('azul', 'Litigio') : ''}</td>
    <td>${i.responsabilidad === 'conductor' ? et('rojo', 'Conductor') : esc(RESPONSABLE[i.responsabilidad])}</td>
    <td class="num">${i.coste != null ? eur(i.coste) : ''}</td><td>${et(c, t)}</td></tr>`; }).join('')}
  </table></div>`;
}

async function pIncidencias() {
  let qy = db().from('v_incidencias').select('*').order('fecha', { ascending: false }).order('creado_en', { ascending: false }).limit(1000);
  if (fInc.estado === 'abiertas') qy = qy.neq('estado', 'cerrada');
  else { qy = qy.gte('fecha', fInc.desde).lte('fecha', fInc.hasta); if (fInc.estado) qy = qy.eq('estado', fInc.estado); }
  if (fInc.tipo) qy = qy.eq('tipo', fInc.tipo);
  if (fInc.conductor) qy = qy.eq('conductor_id', fInc.conductor);
  if (fInc.vehiculo) qy = qy.or(`vehiculo_id.eq.${fInc.vehiculo},remolque_id.eq.${fInc.vehiculo}`);
  const [lista, periodo] = await Promise.all([
    q(qy),
    q(db().from('v_incidencias').select('conductor_id,conductor_nombre,tipo,aviso_previo,responsabilidad,coste').not('conductor_id', 'is', null).gte('fecha', fInc.desde).lte('fecha', fInc.hasta))
  ]);
  const res = {};
  periodo.forEach((i) => {
    const r = (res[i.conductor_id] ||= { nombre: i.conductor_nombre, total: 0, faltas: 0, sinAviso: 0, retrasos: 0, danos: 0, culpa: 0, coste: 0 });
    r.total++;
    if (i.tipo === 'no_se_presenta') { r.faltas++; if (i.aviso_previo === false) r.sinAviso++; }
    if (i.tipo === 'retraso') r.retrasos++;
    if (['averia', 'accidente'].includes(i.tipo)) r.danos++;
    if (i.responsabilidad === 'conductor') { r.culpa++; r.coste += Number(i.coste || 0); }
  });
  const filas = Object.values(res).sort((a, b) => b.total - a.total);
  $('#pagina').innerHTML = `
  <h1>Incidencias</h1>
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="fi-estado">${[['abiertas', 'Abiertas / en curso'], ['', 'Todas (por fechas)'], ['cerrada', 'Cerradas (por fechas)']].map(([k, t]) => `<option value="${k}" ${fInc.estado === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Desde</label><input type="date" id="fi-desde" value="${fInc.desde}"></div>
    <div class="campo"><label>Hasta</label><input type="date" id="fi-hasta" value="${fInc.hasta}"></div>
    <div class="campo"><label>Tipo</label><select id="fi-tipo"><option value="">Todos</option>${Object.entries(TIPOS_INC).map(([k, t]) => `<option value="${k}" ${fInc.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Conductor</label><select id="fi-conductor">${opciones(S.conductores, fInc.conductor, 'Todos')}</select></div>
    <div class="campo"><label>Vehículo</label><select id="fi-vehiculo">${opciones(S.vehiculos, fInc.vehiculo, 'Todos', (x) => x.matricula)}</select></div>
    <button onclick="editarIncidencia()">+ Nueva incidencia</button>
  </div>
  <p class="ayuda">${fInc.estado === 'abiertas' ? 'Se ven todas las que siguen abiertas, sean de la fecha que sean. ' : ''}Si una incidencia acaba en reclamación del cliente, ábrela y pulsa «Abrir litigio».</p>
  ${tablaIncidencias(lista)}
  <h2>Por conductor (${fecha(fInc.desde)} – ${fecha(fInc.hasta)})</h2>
  ${filas.length ? `<div class="tabla-wrap"><table><tr><th>Conductor</th><th class="num">Total</th><th class="num">No va a trabajar</th><th class="num">De ellas sin avisar</th><th class="num">Retrasos</th><th class="num">Averías / golpes</th><th class="num">Por su culpa</th><th class="num">Coste por su culpa</th></tr>
  ${filas.map((r) => `<tr><td><b>${esc(r.nombre)}</b></td><td class="num">${r.total}</td><td class="num">${r.faltas || ''}</td><td class="num">${r.sinAviso ? et('rojo', r.sinAviso) : ''}</td><td class="num">${r.retrasos || ''}</td><td class="num">${r.danos || ''}</td><td class="num">${r.culpa || ''}</td><td class="num">${r.coste ? eur(r.coste) : ''}</td></tr>`).join('')}
  </table></div>` : '<p class="ayuda">Sin incidencias de conductores en estas fechas.</p>'}`;
  ['estado', 'desde', 'hasta', 'tipo', 'conductor', 'vehiculo'].forEach((k) => { $('#fi-' + k).onchange = (e) => { fInc[k] = e.target.value; pIncidencias(); }; });
}

async function editarIncidencia(id, pre = {}) {
  const i = id ? await q(db().from('incidencias').select('*').eq('id', id).single())
    : { fecha: hoy(), tipo: 'averia', estado: 'abierta', responsabilidad: 'por_determinar', ...pre };
  if (i.hora) i.hora = i.hora.slice(0, 5);
  const [rutas, litigios] = await Promise.all([
    q(db().from('rutas').select('id,nombre').not('cliente_id', 'is', null).order('nombre')),
    id ? q(db().from('litigios').select('id,referencia_cliente,estado,fecha_apertura').eq('incidencia_id', id)) : Promise.resolve([])
  ]);
  editarIncidencia.archivos = i.archivos || [];
  const sel = (k, obj) => `<select id="in-${k}">${Object.entries(obj).map(([x, t]) => `<option value="${x}" ${i[k] === x ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
  const inp = (k, tipo = 'text', extra = '') => `<input id="in-${k}" type="${tipo}" value="${esc(i[k])}" ${extra}>`;
  modal(`<h1>${id ? 'Incidencia del ' + fecha(i.fecha) : 'Nueva incidencia'}</h1>
  <div class="rejilla">
    <div><label>Fecha</label>${inp('fecha', 'date')}</div>
    <div><label>Hora (opcional)</label>${inp('hora', 'time')}</div>
    <div><label>Tipo</label>${sel('tipo', TIPOS_INC)}</div>
    <div><label>Estado</label>${sel('estado', Object.fromEntries(Object.entries(ESTADO_INC).map(([k, v]) => [k, v[1]])))}</div>
    <div><label>Conductor</label><select id="in-conductor_id">${opciones(S.conductores, i.conductor_id, '—')}</select></div>
    <div><label>Camión</label><select id="in-vehiculo_id">${selVeh(camiones(), i.vehiculo_id)}</select></div>
    <div><label>Remolque</label><select id="in-remolque_id">${selVeh(remolques(), i.remolque_id)}</select></div>
    <div><label>Cliente</label><select id="in-cliente_id">${opciones(S.clientes, i.cliente_id, '—')}</select></div>
    <div><label>Ruta</label><select id="in-ruta_id">${opciones(rutas, i.ruta_id, '—')}</select></div>
    <div><label>¿Avisó con antelación?</label><select id="in-aviso_previo"><option value="">—</option><option value="si" ${i.aviso_previo === true ? 'selected' : ''}>Sí, avisó</option><option value="no" ${i.aviso_previo === false ? 'selected' : ''}>No avisó</option></select></div>
    <div><label>Minutos de retraso</label>${inp('minutos_retraso', 'number', 'min="0"')}</div>
    <div><label>¿De quién es la culpa?</label>${sel('responsabilidad', RESPONSABLE)}</div>
    <div><label>Coste € (taller, grúa…)</label>${inp('coste', 'number', 'step="0.01"')}</div>
    <div><label>Vehículo parado desde</label>${inp('vehiculo_parado_desde', 'date')}</div>
    <div><label>Parado hasta (vacío = sigue parado)</label>${inp('vehiculo_parado_hasta', 'date')}</div>
    ${campoArchivos('in-archivos', i.archivos)}
  </div>
  <label>Qué ha pasado</label><textarea id="in-descripcion" placeholder="Ej.: se rompe el embrague en la A-2; avisa a las 5:10 que no viene…">${esc(i.descripcion)}</textarea>
  <label>Qué se hizo / solución</label><textarea id="in-solucion" placeholder="Ej.: sale otro conductor con el camión de repuesto; grúa al taller…">${esc(i.solucion)}</textarea>
  ${litigios.length ? `<h2>Litigios de esta incidencia</h2>${litigios.map((l) => `<div class="alerta ambar">${esc(l.referencia_cliente || 'Litigio')} · ${fecha(l.fecha_apertura)} ${et(FASE[l.estado]?.c || 'gris', FASE[l.estado]?.t || l.estado)}<a style="margin-left:auto;cursor:pointer;text-decoration:underline" onclick="editarLitigio('${l.id}')">Abrir</a></div>`).join('')}` : ''}
  <div class="acciones">
    ${id ? `<button class="peligro izq" onclick="borrarIncidencia('${id}')">Borrar</button><button class="sec" onclick="litigioDesdeIncidencia('${id}')">Abrir litigio</button>` : ''}
    <button class="sec" onclick="cerrarModal()">Cancelar</button><button id="b-inc" onclick="guardarIncidencia(${id ? `'${id}'` : ''})">Guardar</button>
  </div>`);
}
async function guardarIncidencia(id) {
  const reg = {};
  ['fecha', 'hora', 'tipo', 'estado', 'conductor_id', 'vehiculo_id', 'remolque_id', 'cliente_id', 'ruta_id', 'minutos_retraso', 'responsabilidad', 'coste',
    'vehiculo_parado_desde', 'vehiculo_parado_hasta', 'descripcion', 'solucion'].forEach((k) => (reg[k] = val('in-' + k)));
  const av = val('in-aviso_previo'); reg.aviso_previo = av == null ? null : av === 'si';
  if (!reg.fecha || !reg.descripcion) return aviso('La fecha y «qué ha pasado» son obligatorios', true);
  if (reg.vehiculo_parado_hasta && !reg.vehiculo_parado_desde) return aviso('Pon también desde cuándo está parado', true);
  const b = $('#b-inc'); b.disabled = true;
  try {
    const nuevos = await subirArchivos('in-archivos', 'incidencias/' + reg.fecha.slice(0, 7));
    if (nuevos.length) reg.archivos = [...editarIncidencia.archivos, ...nuevos];
    if (id) await q(db().from('incidencias').update(reg).eq('id', id));
    else await q(db().from('incidencias').insert(reg));
    cerrarModal(); aviso('Incidencia guardada'); pintar();
  } catch { b.disabled = false; }
}
async function borrarIncidencia(id) {
  if (!confirm('¿Borrar esta incidencia?')) return;
  await q(db().from('incidencias').delete().eq('id', id)); cerrarModal(); pintar();
}
async function litigioDesdeIncidencia(id) {
  const i = await q(db().from('incidencias').select('*').eq('id', id).single());
  editarLitigio(null, {
    incidencia_id: id, cliente_id: i.cliente_id, conductor_id: i.conductor_id, vehiculo_id: i.vehiculo_id, remolque_id: i.remolque_id,
    ruta_id: i.ruta_id, fecha_servicio: i.fecha, responsabilidad: i.responsabilidad, descripcion: i.descripcion,
    motivo: { temperatura: 'temperatura', retraso: 'retraso', ruta_no_realizada: 'retraso' }[i.tipo] || 'otro'
  });
}

/* ---------------------------------------------------------------- LITIGIOS */
const MOTIVOS_LIT = { temperatura: 'Temperatura / rotura de frío', mercancia_danada: 'Mercancía dañada', faltante: 'Faltan bultos o palets', retraso: 'Retraso / servicio no realizado', entrega_erronea: 'Entrega errónea', documentacion: 'Documentación / albaranes', otro: 'Otro' };
// Fases en orden. Se puede saltar de una a cualquier otra.
const FASES_LIT = [
  ['abierto', 'Abierto', 'rojo'],
  ['documentando', 'Reuniendo pruebas', 'ambar'],
  ['alegado', 'Alegaciones enviadas', 'ambar'],
  ['cargado', 'Cobrado por el cliente', 'ambar'],
  ['reclamado_seguro', 'Reclamado al seguro', 'azul'],
  ['seguro_aceptado', 'Seguro acepta, falta el pago', 'azul'],
  ['cerrado_recuperado', 'Cerrado · recuperado', 'verde'],
  ['cerrado_sin_recuperar', 'Cerrado · sin recuperar', 'gris'],
  ['anulado', 'Anulado (el cliente lo retira)', 'verde']
];
const FASE = Object.fromEntries(FASES_LIT.map(([k, t, c]) => [k, { t, c }]));
const CERRADOS_LIT = ['cerrado_recuperado', 'cerrado_sin_recuperar', 'anulado'];
const FORMA_CARGO = { descuento_pago: 'Nos lo descuentan del pago de una factura', factura_cargo: 'Nos mandan una factura de cargo', abono: 'Les hacemos una factura rectificativa', otro: 'Otro' };
const fLit = { ver: 'abiertos', cliente: '', anio: hoy().slice(0, 4) };

function estadoPlazo(d) {
  const dias = Math.round((new Date(d + 'T12:00:00') - new Date(hoy() + 'T12:00:00')) / 86400000);
  if (dias < 0) return et('rojo', 'Pasado ' + fecha(d));
  if (dias <= 7) return et('ambar', fecha(d) + ' (' + (dias === 0 ? 'hoy' : dias + ' d') + ')');
  return fecha(d);
}

async function pLitigios() {
  const ini = fLit.anio + '-01-01'; const fin = fLit.anio + '-12-31';
  const noCerrado = `(${CERRADOS_LIT.join(',')})`;
  let qy = db().from('v_litigios').select('*').order('fecha_apertura', { ascending: false }).limit(1000);
  if (fLit.ver === 'abiertos') qy = qy.not('estado', 'in', noCerrado);
  else { qy = qy.gte('fecha_apertura', ini).lte('fecha_apertura', fin); if (fLit.ver === 'cerrados') qy = qy.in('estado', CERRADOS_LIT); else if (fLit.ver) qy = qy.eq('estado', fLit.ver); }
  if (fLit.cliente) qy = qy.eq('cliente_id', fLit.cliente);
  const [lista, delAnio, abiertos] = await Promise.all([
    q(qy),
    q(db().from('v_litigios').select('importe_cargado,importe_recuperado').gte('fecha_apertura', ini).lte('fecha_apertura', fin)),
    q(db().from('v_litigios').select('importe_reclamado').not('estado', 'in', noCerrado))
  ]);
  const s = (l, k) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
  const cargado = s(delAnio, 'importe_cargado'); const recup = s(delAnio, 'importe_recuperado');
  $('#pagina').innerHTML = `
  <h1>Litigios</h1>
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="fl2-ver">${[['abiertos', 'Abiertos (todos)'], ['', 'Todos del año'], ['cerrados', 'Cerrados del año'], ...FASES_LIT.map(([k, t]) => [k, 'Fase: ' + t])].map(([k, t]) => `<option value="${k}" ${fLit.ver === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="campo"><label>Cliente</label><select id="fl2-cliente">${opciones(S.clientes, fLit.cliente, 'Todos')}</select></div>
    <div class="campo"><label>Año</label><input type="number" id="fl2-anio" value="${fLit.anio}" style="width:100px"></div>
    <button onclick="editarLitigio()">+ Nuevo litigio</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="t">Abiertos ahora</div><div class="n">${abiertos.length}</div><div class="t">${eur(s(abiertos, 'importe_reclamado'))} reclamados</div></div>
    <div class="kpi"><div class="t">Nos han cobrado en ${fLit.anio}</div><div class="n">${eur(cargado)}</div><div class="t">${delAnio.length} litigios abiertos en el año</div></div>
    <div class="kpi"><div class="t">Recuperado del seguro</div><div class="n" style="color:var(--verde)">${eur(recup)}</div></div>
    <div class="kpi"><div class="t">Pérdida neta</div><div class="n" style="color:${cargado - recup > 0 ? 'var(--rojo)' : 'inherit'}">${eur(cargado - recup)}</div><div class="t">cobrado − recuperado</div></div>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Apertura</th><th>Ref. cliente</th><th>Cliente</th><th>Motivo</th><th>Conductor</th><th class="num">Reclamado</th><th class="num">Cobrado</th><th class="num">Recuperado</th><th>Fase</th><th>Próximo plazo</th></tr>
    ${lista.map((l) => `<tr class="clic" onclick="editarLitigio('${l.id}')">
      <td>${fecha(l.fecha_apertura)}</td><td><b>${esc(l.referencia_cliente) || '—'}</b></td><td>${esc(l.cliente_nombre)}</td><td>${esc(MOTIVOS_LIT[l.motivo] || l.motivo)}</td>
      <td>${esc(l.conductor_nombre)}</td><td class="num">${l.importe_reclamado != null ? eur(l.importe_reclamado) : ''}</td>
      <td class="num">${l.importe_cargado != null ? eur(l.importe_cargado) : ''}</td><td class="num">${l.importe_recuperado != null ? eur(l.importe_recuperado) : ''}</td>
      <td>${et(FASE[l.estado]?.c || 'gris', FASE[l.estado]?.t || l.estado)}</td>
      <td>${l.fecha_limite && !CERRADOS_LIT.includes(l.estado) ? estadoPlazo(l.fecha_limite) + (l.proxima_accion ? '<br><small>' + esc(l.proxima_accion) + '</small>' : '') : ''}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay litigios en esta vista.</div>'}</div>`;
  ['ver', 'cliente', 'anio'].forEach((k) => { $('#fl2-' + k).onchange = (e) => { fLit[k] = e.target.value; pLitigios(); }; });
}

async function editarLitigio(id, pre = {}) {
  const l = id ? await q(db().from('litigios').select('*').eq('id', id).single())
    : { fecha_apertura: hoy(), estado: 'abierto', motivo: 'temperatura', responsabilidad: 'por_determinar', ...pre };
  const [rutas, facturas, historial, comp] = await Promise.all([
    q(db().from('rutas').select('id,nombre').not('cliente_id', 'is', null).order('nombre')),
    q(db().from('facturas').select('id,codigo,cliente_id,fecha').eq('estado', 'emitida').order('fecha', { ascending: false }).limit(300)),
    id ? q(db().from('litigio_historial').select('*').eq('litigio_id', id).order('fecha', { ascending: false })) : Promise.resolve([]),
    id ? q(db().from('cobros').select('id,importe,fecha').eq('litigio_id', id)) : Promise.resolve([])
  ]);
  editarLitigio.archivos = l.archivos || [];
  editarLitigio.pre = pre;
  const inp = (k, t, tipo = 'text', extra = '') => `<div><label>${t}</label><input id="li-${k}" type="${tipo}" value="${esc(l[k])}" ${extra}></div>`;
  const sel = (k, t, obj, vacio) => `<div><label>${t}</label><select id="li-${k}">${vacio != null ? `<option value="">${vacio}</option>` : ''}${Object.entries(obj).map(([x, tt]) => `<option value="${x}" ${l[k] === x ? 'selected' : ''}>${esc(tt)}</option>`).join('')}</select></div>`;
  const nomCli = (cid) => (S.clientes.find((c) => c.id === cid) || {}).nombre || '';
  const perdida = Number(l.importe_cargado || 0) - Number(l.importe_recuperado || 0);
  const idx = FASES_LIT.findIndex(([k]) => k === l.estado);
  modal(`<h1>${id ? 'Litigio ' + esc(l.referencia_cliente || '') + ' ' + et(FASE[l.estado]?.c || 'gris', FASE[l.estado]?.t || l.estado) : 'Nuevo litigio'}</h1>
  ${id ? `<div class="fases">${FASES_LIT.map(([k, t], n) => `<span class="${n === idx ? 'actual' : n < idx ? 'hecha' : ''}">${esc(t)}</span>`).join('')}</div>` : ''}
  ${l.incidencia_id ? `<p class="ayuda">Viene de una incidencia · <a style="cursor:pointer;text-decoration:underline" onclick="editarIncidencia('${l.incidencia_id}')">ver incidencia</a></p>` : ''}
  <div class="rejilla">
    ${inp('fecha_apertura', 'Fecha de apertura', 'date')}${inp('referencia_cliente', 'Nº / referencia del cliente')}
    <div><label>Cliente</label><select id="li-cliente_id">${opciones(S.clientes, l.cliente_id)}</select></div>
    ${sel('motivo', 'Motivo', MOTIVOS_LIT)}
    ${inp('fecha_servicio', 'Fecha del servicio', 'date')}${inp('albaran', 'Albarán / eVoucher')}
    <div><label>Conductor</label><select id="li-conductor_id">${opciones(S.conductores, l.conductor_id, '—')}</select></div>
    <div><label>Camión</label><select id="li-vehiculo_id">${selVeh(camiones(), l.vehiculo_id)}</select></div>
    <div><label>Remolque</label><select id="li-remolque_id">${selVeh(remolques(), l.remolque_id)}</select></div>
    <div><label>Ruta</label><select id="li-ruta_id">${opciones(rutas, l.ruta_id, '—')}</select></div>
    ${sel('responsabilidad', '¿De quién es la culpa?', RESPONSABLE)}
    ${id ? '' : sel('estado', 'Fase en la que está', Object.fromEntries(FASES_LIT.map(([k, t]) => [k, t])))}
    ${inp('fecha_limite', 'Próximo plazo', 'date')}${inp('proxima_accion', 'Qué hay que hacer antes del plazo', 'text', 'placeholder="Ej.: enviar alegaciones con el registro de temperatura"')}
  </div>
  <label>Qué reclama el cliente</label><textarea id="li-descripcion">${esc(l.descripcion)}</textarea>
  <h2>Lo que nos cobra el cliente</h2>
  <div class="rejilla">
    ${inp('importe_reclamado', 'Importe que reclama €', 'number', 'step="0.01"')}${inp('importe_cargado', 'Importe que finalmente nos cobra €', 'number', 'step="0.01"')}
    ${sel('forma_cargo', 'Cómo nos lo cobra', FORMA_CARGO, '—')}${inp('fecha_cargo', 'Fecha del cobro / descuento', 'date')}
    <div><label>Factura nuestra afectada</label><select id="li-factura_id">${opciones(facturas, l.factura_id, '—', (f) => f.codigo + ' · ' + nomCli(f.cliente_id) + ' · ' + fecha(f.fecha))}</select></div>
  </div>
  ${id && l.forma_cargo === 'descuento_pago' ? (comp.length ? `<p class="ayuda">✓ Descuento de ${eur(comp[0].importe)} registrado en la factura.</p>`
    : `<p class="ayuda">Si os lo han descontado del pago de una factura, regístralo para que esa factura no se quede como pendiente de cobro. <button class="sec peq" onclick="compensarLitigio('${id}')">Registrar descuento en la factura</button></p>`) : ''}
  <h2>Seguro</h2>
  <div class="rejilla">
    ${inp('aseguradora', 'Aseguradora')}${inp('num_siniestro', 'Nº de siniestro')}${inp('fecha_parte_seguro', 'Fecha del parte', 'date')}
    ${inp('importe_reclamado_seguro', 'Reclamado al seguro €', 'number', 'step="0.01"')}${inp('franquicia', 'Franquicia €', 'number', 'step="0.01"')}
    ${inp('importe_recuperado', 'Recuperado del seguro €', 'number', 'step="0.01"')}${inp('fecha_cobro_seguro', 'Fecha de cobro del seguro', 'date')}
    ${campoArchivos('li-archivos', l.archivos)}
  </div>
  ${id ? `<p style="text-align:right;font-size:16px">Pérdida neta: <b style="color:${perdida > 0 ? 'var(--rojo)' : 'var(--verde)'}">${eur(perdida)}</b></p>` : ''}
  <label>Notas</label><textarea id="li-notas">${esc(l.notas)}</textarea>
  <div class="acciones">
    ${id ? `<button class="peligro izq" onclick="borrarLitigio('${id}')">Borrar</button>` : ''}
    <button class="sec" onclick="cerrarModal()">Cerrar</button><button id="b-lit" onclick="guardarLitigio(${id ? `'${id}'` : ''})">Guardar</button>
  </div>
  ${id ? `<h2>Cambiar fase / seguimiento</h2>
  <div class="barra">
    <div class="campo"><label>Fase</label><select id="lh-estado">${FASES_LIT.map(([k, t]) => `<option value="${k}" ${k === l.estado ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>
    <div class="campo" style="flex:1"><label>Nota (qué ha pasado, con quién habéis hablado…)</label><input id="lh-nota"></div>
    <button onclick="cambiarFaseLitigio('${id}')">Guardar en el seguimiento</button>
  </div>
  <div class="historial">${historial.map((h) => `<div><span class="f">${new Date(h.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}${h.usuario_nombre ? ' · ' + esc(h.usuario_nombre) : ''}</span>
    ${h.estado ? et(FASE[h.estado]?.c || 'gris', 'Fase: ' + (FASE[h.estado]?.t || h.estado)) : ''} ${esc(h.nota)}</div>`).join('')}</div>` : ''}`);
}
const CAMPOS_LIT = ['fecha_apertura', 'referencia_cliente', 'cliente_id', 'motivo', 'fecha_servicio', 'albaran', 'conductor_id', 'vehiculo_id', 'remolque_id', 'ruta_id',
  'responsabilidad', 'fecha_limite', 'proxima_accion', 'descripcion', 'importe_reclamado', 'importe_cargado', 'forma_cargo', 'fecha_cargo', 'factura_id',
  'aseguradora', 'num_siniestro', 'fecha_parte_seguro', 'importe_reclamado_seguro', 'franquicia', 'importe_recuperado', 'fecha_cobro_seguro', 'notas'];
// seguir = true: guarda sin refrescar (lo usan «cambiar fase» y «registrar descuento»). Devuelve el id o null si falla.
async function guardarLitigio(id, seguir = false) {
  const reg = {};
  CAMPOS_LIT.forEach((k) => (reg[k] = val('li-' + k)));
  if (!id) { reg.estado = val('li-estado') || 'abierto'; if (editarLitigio.pre?.incidencia_id) reg.incidencia_id = editarLitigio.pre.incidencia_id; }
  if (!reg.cliente_id || !reg.fecha_apertura) { aviso('Cliente y fecha de apertura son obligatorios', true); return null; }
  const b = $('#b-lit'); if (b) b.disabled = true;
  try {
    const nuevos = await subirArchivos('li-archivos', 'litigios/' + reg.fecha_apertura.slice(0, 7));
    if (nuevos.length) reg.archivos = [...editarLitigio.archivos, ...nuevos];
    if (id) await q(db().from('litigios').update(reg).eq('id', id));
    else id = (await q(db().from('litigios').insert(reg).select('id').single())).id;
    if (seguir) return id;
    aviso('Litigio guardado');
    if (location.hash.startsWith('#litigios')) pLitigios();
    editarLitigio(id);
    return id;
  } catch { if (b) b.disabled = false; return null; }
}
async function cambiarFaseLitigio(id) {
  const estado = val('lh-estado'); const nota = val('lh-nota');
  if (!(await guardarLitigio(id, true))) return;
  await q(db().rpc('cambiar_estado_litigio', { p_litigio: id, p_estado: estado, p_nota: nota }));
  aviso('Seguimiento actualizado');
  if (location.hash.startsWith('#litigios')) pLitigios();
  editarLitigio(id);
}
async function compensarLitigio(id) {
  if (!(await guardarLitigio(id, true))) return;
  const l = await q(db().from('litigios').select('*').eq('id', id).single());
  if (!l.factura_id || !l.importe_cargado) return aviso('Elige la factura afectada y el importe que os han cobrado', true);
  if (!confirm(`¿Registrar ${eur(l.importe_cargado)} como descuento en esa factura? Contará como cobrada por compensación.`)) return;
  await q(db().from('cobros').insert({ factura_id: l.factura_id, fecha: l.fecha_cargo || hoy(), importe: l.importe_cargado, medio: 'Compensación litigio', litigio_id: id, notas: 'Litigio ' + (l.referencia_cliente || '') }));
  aviso('Descuento registrado en la factura'); editarLitigio(id);
}
async function borrarLitigio(id) {
  if (!confirm('¿Borrar este litigio y todo su seguimiento?')) return;
  await q(db().from('litigios').delete().eq('id', id)); cerrarModal(); pintar();
}


arrancar();
