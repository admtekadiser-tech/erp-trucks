/* ERP TRUCKS CROS TRANSPORT · v1.5
   App web para administración: viajes (desde TransControl, con importes por concepto),
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
// Número escrito a la española ("1.234,50" o "650,5") → 1234.5 ; vacío → null
const leerNum = (t) => { t = String(t ?? '').trim().replace(/\s|€/g, ''); if (!t) return null; if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.'); const n = Number(t); return isNaN(n) ? NaN : n; };
const numCampo = (n) => (n == null ? '' : String(n).replace('.', ','));
const lineas = (t) => (t || '').split('\n').map((s) => s.trim());

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
// Conceptos de cada viaje (mismas columnas que el Excel de liquidación)
const CONCEPTOS = [
  ['importe_ruta', 'Importe ruta', 'IMPORTE RUTA'],
  ['importe_manipulacion', 'Importe manipul.', 'IMPORTE MANIPUL'],
  ['importe_retorno', 'Importe retornos', 'IMPORTE RETORNOS'],
  ['importe_paralizacion', 'Importe paralización', 'IMPORTE PARALIZACION'],
  ['importe_peaje', 'Importe peaje', 'IMPORTE PEAJE']
];
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
  ['inicio', 'Inicio'], ['viajes', 'Viajes'], ['facturas', 'Facturas'],
  ['clientes', 'Clientes'], ['flota', 'Flota'], ['conductores', 'Personal'], ['gastos', 'Gastos'],
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
  let [pag, id] = (location.hash.slice(1) || 'inicio').split('/');
  if (pag === 'rutas') pag = 'viajes'; // la pestaña «Rutas y tarifas» ya no existe
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
  const PAG = { inicio: pInicio, viajes: pViajes, facturas: pFacturas, factura: pFactura, clientes: pClientes, empresa: pEmpresa,
    flota: pFlota, conductores: pConductores, gastos: pGastos, gestoria: pGestoria };
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
  const [alertas, pend, cobro, mes, sinCli] = await Promise.all([
    q(db().from('v_alertas').select('*').order('fecha')),
    q(db().from('v_viajes').select('importe').is('factura_id', null).in('estado', ['pendiente', 'revisado'])),
    q(db().from('v_facturas_cobro').select('pendiente,estado_cobro').neq('estado_cobro', 'cobrada')),
    q(db().from('facturas').select('base').eq('estado', 'emitida').gte('fecha', inicioMes())),
    q(db().from('viajes').select('id').is('cliente_id', null).neq('estado', 'anulado'))
  ]);
  const suma = (l, k) => l.reduce((a, x) => a + Number(x[k] || 0), 0);
  const vencido = cobro.filter((x) => x.estado_cobro === 'vencida');
  $('#pagina').innerHTML = `
  <h1>Inicio</h1>
  ${!S.empresa ? `<div class="alerta ambar">Faltan los datos de la empresa para poder facturar. <a href="#empresa" style="margin-left:auto">Rellenar ahora</a></div>` : ''}
  ${sinCli.length ? `<div class="alerta ambar">Hay ${sinCli.length} viajes sin cliente asignado: no entrarán en ninguna factura. <a href="#viajes" onclick="fViajes.cliente='sin'" style="margin-left:auto">Asignar</a></div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="t">Viajes sin facturar</div><div class="n">${pend.length}</div><div class="t">${eur(suma(pend, 'importe'))}</div></div>
    <div class="kpi"><div class="t">Pendiente de cobro</div><div class="n">${eur(suma(cobro, 'pendiente'))}</div><div class="t">${cobro.length} facturas</div></div>
    <div class="kpi"><div class="t">Vencido sin cobrar</div><div class="n" style="color:${vencido.length ? 'var(--rojo)' : 'inherit'}">${eur(suma(vencido, 'pendiente'))}</div><div class="t">${vencido.length} facturas</div></div>
    <div class="kpi"><div class="t">Facturado este mes (base)</div><div class="n">${eur(suma(mes, 'base'))}</div><div class="t">${mes.length} facturas</div></div>
  </div>
  <h2>Avisos</h2>
  ${alertas.length ? alertas.map((a) => `<div class="alerta ${a.nivel}">${et(a.nivel, { flota: 'Flota', conductores: 'Personal', cobros: 'Cobro', facturacion: 'Facturación' }[a.grupo])} ${esc(a.texto)}<span class="f">${fecha(a.fecha)}</span></div>`).join('')
    : '<div class="tarjeta vacio">Todo en orden: no hay avisos.</div>'}`;
}

/* ---------------------------------------------------------------- VIAJES
   Hoja tipo Excel: una fila por viaje (ruta + fecha + conductor). El importe de ruta
   lo pone la tarifa automáticamente; el resto se escribe directamente en la tabla. */
const fViajes = { desde: inicioMes(), hasta: hoy(), cliente: '', factura: 'sin_facturar', precio: '', buscar: '', vista: 'viajes' };
const selViajes = new Set();
function barraViajes() {
  return `<div class="barra">${[['viajes', 'Viajes'], ['tarifas', 'Tarifas']].map(([k, t]) =>
    `<button class="${fViajes.vista === k ? '' : 'sec'}" onclick="fViajes.vista='${k}';pViajes()">${t}</button>`).join('')}</div>`;
}
async function pViajes() {
  if (!fViajes.desde) fViajes.desde = inicioMes();
  if (!fViajes.hasta) fViajes.hasta = hoy();
  if (fViajes.vista === 'tarifas') return pTarifas();
  let qy = db().from('v_viajes').select('*').gte('fecha', fViajes.desde).lte('fecha', fViajes.hasta)
    .order('fecha', { ascending: false }).order('ruta_nombre').limit(3000);
  if (fViajes.cliente === 'sin') qy = qy.is('cliente_id', null);
  else if (fViajes.cliente) qy = qy.eq('cliente_id', fViajes.cliente);
  if (fViajes.factura === 'sin_facturar') qy = qy.is('factura_id', null).neq('estado', 'anulado');
  else if (fViajes.factura === 'facturados') qy = qy.not('factura_id', 'is', null);
  const [todos, imps, exl] = await Promise.all([q(qy), q(db().from('importaciones').select('*').order('fecha', { ascending: false }).limit(1)),
    q(db().from('viajes').select('id,extras_lineas,paradas_lineas').gte('fecha', fViajes.desde).lte('fecha', fViajes.hasta).limit(5000))]);
  const mExtras = Object.fromEntries(exl.map((x) => [x.id, x.extras_lineas || {}]));
  const mParadas = Object.fromEntries(exl.map((x) => [x.id, x.paradas_lineas || null]));
  todos.forEach((v) => { v.extras_lineas = mExtras[v.id] || {}; v.paradas_lineas = mParadas[v.id] || null; });
  let lista = todos;
  if (fViajes.precio === 'sin') lista = lista.filter((v) => v.importe_ruta == null && v.precio_manual == null);
  if (fViajes.buscar) {
    const b = fViajes.buscar.toLowerCase();
    lista = lista.filter((v) => [v.ruta_nombre, v.num_expedicion, v.conductor_nombre, v.cliente_nombre, v.tarifa_nombre, ...(v.detalle_clientes || []), ...(v.albaranes || [])]
      .some((x) => (x || '').toLowerCase().includes(b)));
  }
  pViajes.lista = lista;
  [...selViajes].forEach((id) => { if (!lista.some((v) => v.id === id && !v.factura_id)) selViajes.delete(id); });
  const sinCliente = lista.filter((v) => !v.cliente_id && !v.factura_id);
  const sinPrecio = todos.filter((v) => v.importe_ruta == null && v.precio_manual == null && !v.factura_id).length;
  const ult = imps[0];
  $('#pagina').innerHTML = `
  <h1>Viajes</h1>
  ${barraViajes()}
  <div class="barra">
    <div class="campo"><label>Desde</label><input type="date" id="fv-desde" value="${fViajes.desde}"></div>
    <div class="campo"><label>Hasta</label><input type="date" id="fv-hasta" value="${fViajes.hasta}"></div>
    <div class="campo"><label>Cliente</label><select id="fv-cliente">${opciones(S.clientes, fViajes.cliente, 'Todos').replace('<option value="">Todos</option>', `<option value="">Todos</option><option value="sin" ${fViajes.cliente === 'sin' ? 'selected' : ''}>— Sin cliente —</option>`)}</select></div>
    <div class="campo"><label>Facturación</label><select id="fv-factura">${[['sin_facturar', 'Sin facturar'], ['facturados', 'Ya facturados'], ['', 'Todos']].map(([k, t]) => `<option value="${k}" ${fViajes.factura === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Precio</label><select id="fv-precio">${[['', 'Todos'], ['sin', 'Sin precio']].map(([k, t]) => `<option value="${k}" ${fViajes.precio === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <div class="campo"><label>Buscar</label><input id="fv-buscar" value="${esc(fViajes.buscar)}" placeholder="Ruta, expedición, albarán…"></div>
  </div>
  <div class="barra">
    <button onclick="editarViaje()">+ Viaje manual</button>
    <button class="sec" onclick="importarViajes()">⟳ Importar ahora</button>
    <button class="sec" onclick="subirCsvLactalis()">⬆ Subir CSV Lactalis</button>
    <button class="sec" onclick="recalcularPrecios()">↺ Recalcular precios</button>
    <button class="sec" onclick="exportarViajesExcel()">⬇ Excel</button>
    <button class="peligro" id="b-borrar-sel" onclick="borrarSeleccionados()" ${selViajes.size ? '' : 'disabled'}>🗑 Borrar seleccionados${selViajes.size ? ' (' + selViajes.size + ')' : ''}</button>
  </div>
  <p class="ayuda">${ult ? `Última importación de TransControl: <b>${new Date(ult.fecha).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</b> (${ult.origen === 'automatica' ? 'automática' : esc(ult.origen)}) · ${ult.viajes_nuevos} nuevos. ` : ''}Se importa sola cada hora (últimos 7 días). Lactalis: sube sus CSV con «⬆ Subir CSV Lactalis».</p>
  ${sinCliente.length ? `<div class="alerta ambar">${sinCliente.length} viajes de esta lista no tienen cliente (a quién se factura).
    <select id="masivo-cliente" style="width:auto;margin-left:auto">${opciones(S.clientes, null, '— elegir cliente —')}</select>
    <button class="peq" onclick="asignarClienteMasivo()">Asignar a los ${sinCliente.length}</button></div>` : ''}
  ${sinPrecio && fViajes.precio !== 'sin' ? `<div class="alerta ambar">${sinPrecio} viajes sin facturar no tienen precio de ruta (no encajan en ninguna tarifa o el cliente manda prefactura).
    <a href="javascript:void 0" style="margin-left:auto" onclick="fViajes.precio='sin';pViajes()">Ver cuáles</a></div>` : ''}
  <p class="ayuda">${lista.length} viajes. El <b>importe de ruta</b> sale de la pestaña Tarifas; si lo cambias a mano queda fijo (pulsa ↺ para volver a la tarifa).
  Lo demás (expedición, albaranes, manipulación, retornos, paralización, peaje) se escribe en la tabla y se guarda al salir de la casilla. ✎ abre el viaje completo y 🗑 lo borra.</p>
  <div class="tabla-wrap"><table class="hoja" id="t-viajes">
    <tr><th><input type="checkbox" style="width:auto" title="Seleccionar todos" onchange="selTodos(this.checked)"></th><th>Fecha carga</th><th>Ruta</th><th>Nº expedición</th><th>Cliente (factura)</th><th>Detalle clientes</th><th>Detalle albaranes</th>
      ${CONCEPTOS.map(([, t]) => `<th class="num">${t}</th>`).join('')}<th class="num">Total</th><th>Factura</th><th></th></tr>
    ${lista.map(filaViaje).join('')}
    ${lista.length ? `<tr class="totales-fila"><td colspan="7"><b>Total</b></td>${CONCEPTOS.map(([k]) => `<td class="num" id="tot-${k}"></td>`).join('')}<td class="num" id="tot-total"></td><td colspan="2"></td></tr>` : ''}
  </table>${lista.length ? '' : '<div class="vacio">No hay viajes con estos filtros.</div>'}</div>`;
  ['desde', 'hasta', 'cliente', 'factura', 'precio'].forEach((k) => { $('#fv-' + k).onchange = (e) => { fViajes[k] = e.target.value; pViajes(); }; });
  $('#fv-buscar').oninput = (e) => { fViajes.buscar = e.target.value; clearTimeout(pViajes.t); pViajes.t = setTimeout(() => { pViajes().then(() => { const b = $('#fv-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }); }, 350); };
  recalcularTotalesViajes();
}
function filaViaje(v) {
  const dis = v.factura_id ? 'disabled' : '';
  const clientes = v.detalle_clientes || [];
  const albs = v.albaranes || [];
  const n = Math.max(clientes.length, albs.length, 1);
  const filas = Array.from({ length: n }, (_, i) => i);
  const rutaImp = v.importe_ruta ?? v.precio_manual;
  const infoTarifa = v.precio_auto
    ? (v.tarifa_nombre ? `<small title="Tarifa aplicada">${esc(v.tarifa_nombre)}</small>` : '<small style="color:var(--rojo)">sin tarifa</small>')
    : `<small>a mano ${dis ? '' : `<a href="javascript:void 0" title="Volver a la tarifa automática" onclick="volverTarifa('${v.id}')">↺</a>`}</small>`;
  return `<tr data-id="${v.id}">
    <td>${v.factura_id ? '' : `<input type="checkbox" style="width:auto" class="c-sel" ${selViajes.has(v.id) ? 'checked' : ''} onchange="marcarSel('${v.id}',this.checked)">`}</td>
    <td>${fecha(v.fecha)}${v.hora_inicio ? ' <small>' + v.hora_inicio.slice(0, 5) + '</small>' : ''}<br><small>${esc(v.conductor_nombre)}</small></td>
    <td><b>${esc(v.ruta_nombre || '—')}</b></td>
    <td><input class="c-exp" value="${esc(v.num_expedicion)}" ${dis} onchange="guardarCelda(this,'num_expedicion')"></td>
    <td><select class="c-cli" ${dis} onchange="guardarCelda(this,'cliente_id')">${opciones(S.clientes, v.cliente_id, '— sin cliente —')}</select></td>
    <td class="lineas">${filas.map((i) => `<div>${esc(clientes[i] || '')}</div>`).join('')}</td>
    <td class="lineas">${filas.map((i) => `<div><input class="c-alb" value="${esc(albs[i] || '')}" ${dis} onchange="guardarCelda(this,'albaranes')"></div>`).join('')}</td>
    ${CONCEPTOS.map(([k]) => k === 'importe_ruta'
      ? `<td class="num"><input class="c-imp" data-campo="${k}" inputmode="decimal" value="${numCampo(rutaImp)}" ${dis} onchange="guardarCelda(this,'${k}')"><br>${infoTarifa}</td>`
      : `<td class="num lineas">${filas.map((i) => (primeraDeParada(v, i) || ((v.extras_lineas || {})[claveLinea(v, i)] || {})[k] != null)
          ? `<div><input class="c-imp" data-campo="${k}" data-clave="${esc(claveLinea(v, i))}" inputmode="decimal" value="${numCampo(((v.extras_lineas || {})[claveLinea(v, i)] || {})[k])}" ${dis} onchange="guardarExtra(this,'${k}')"></div>`
          : '<div><input disabled tabindex="-1" style="visibility:hidden"></div>').join('')}</td>`).join('')}
    <td class="num c-total"><b>${eur(v.importe)}</b></td>
    <td>${v.factura_codigo ? et('verde', v.factura_codigo) : v.factura_id ? et('azul', 'En borrador') : '<span style="color:var(--gris)">—</span>'}</td>
    <td style="white-space:nowrap"><button class="sec peq" title="Editar el viaje" onclick="editarViaje('${v.id}')">✎</button>${v.factura_id ? '' : ` <button class="sec peq" title="Borrar el viaje" onclick="borrarViaje('${v.id}')">🗑</button>`}</td>
  </tr>`;
}
// Manipulación, retornos, paralización y peaje van por parada (línea del viaje)
// Los extras se ponen en la primera línea de cada parada (cuando cambia el cliente)
// Parada = mismo sitio de descarga (lo calcula la importación del CSV: mismo código de dirección o misma calle)
const primeraDeParada = (v, i) => {
  const p = v.paradas_lineas;
  if (p && p.length) return i === 0 || (p[i] || '') !== (p[i - 1] || '');
  return i === 0 || ((v.detalle_clientes || [])[i] || '') !== ((v.detalle_clientes || [])[i - 1] || '');
};
const claveLinea = (v, i) => { const a = (v.albaranes || [])[i]; return a ? 'a:' + a : 'n:' + i + ':' + ((v.detalle_clientes || [])[i] || ''); };
async function guardarExtra(el, campo) {
  const tr = el.closest('tr'); const id = tr.dataset.id; const clave = el.dataset.clave;
  const valor = leerNum(el.value);
  if (Number.isNaN(valor)) { el.classList.add('mal'); return aviso('Importe no válido: escribe solo el número, p. ej. 40 o 40,50', true); }
  el.classList.remove('mal'); el.value = numCampo(valor);
  const v = pViajes.lista.find((x) => x.id === id); if (!v) return;
  const ex = JSON.parse(JSON.stringify(v.extras_lineas || {}));
  const linea = ex[clave] || {};
  if (valor == null) delete linea[campo]; else linea[campo] = valor;
  if (Object.keys(linea).length) ex[clave] = linea; else delete ex[clave];
  try {
    await q(db().from('viajes').update({ extras_lineas: ex }).eq('id', id));
    v.extras_lineas = ex;
    el.classList.add('ok'); setTimeout(() => el.classList.remove('ok'), 900);
    const total = [...tr.querySelectorAll('.c-imp')].reduce((a, x) => a + (leerNum(x.value) || 0), 0);
    v.importe = total; tr.querySelector('.c-total').innerHTML = `<b>${eur(total)}</b>`;
    recalcularTotalesViajes();
  } catch { el.classList.add('mal'); }
}
async function guardarCelda(el, campo) {
  const tr = el.closest('tr'); const id = tr.dataset.id;
  let valor;
  if (campo === 'albaranes') {
    const a = [...tr.querySelectorAll('.c-alb')].map((x) => x.value.trim());
    valor = a.some(Boolean) ? a : null;
  } else if (campo.startsWith('importe_')) {
    valor = leerNum(el.value);
    if (Number.isNaN(valor)) { el.classList.add('mal'); return aviso('Importe no válido: escribe solo el número, p. ej. 650,50', true); }
    el.classList.remove('mal');
    el.value = numCampo(valor);
  } else valor = el.value.trim() || null;
  const cambio = { [campo]: valor };
  if (campo === 'importe_ruta') cambio.precio_auto = false; // a mano: la tarifa ya no lo cambia
  try {
    await q(db().from('viajes').update(cambio).eq('id', id));
    const v = pViajes.lista.find((x) => x.id === id);
    if (v) { Object.assign(v, cambio); if (campo === 'cliente_id') v.cliente_nombre = (S.clientes.find((c) => c.id === valor) || {}).nombre; }
    el.classList.add('ok'); setTimeout(() => el.classList.remove('ok'), 900);
    if (campo === 'cliente_id' && v && v.precio_auto) { await q(db().rpc('recalcular_tarifas', { p_desde: v.fecha, p_hasta: v.fecha, p_ids: [id] })); return pViajes(); }
    if (campo.startsWith('importe_')) {
      const total = [...tr.querySelectorAll('.c-imp')].reduce((a, x) => a + (leerNum(x.value) || 0), 0);
      if (v) v.importe = total;
      tr.querySelector('.c-total').innerHTML = `<b>${eur(total)}</b>`;
      if (campo === 'importe_ruta') { const s = el.parentElement.querySelector('small'); if (s) s.outerHTML = `<small>a mano <a href="javascript:void 0" title="Volver a la tarifa automática" onclick="volverTarifa('${id}')">↺</a></small>`; }
      recalcularTotalesViajes();
    }
  } catch { el.classList.add('mal'); }
}
async function volverTarifa(id) {
  const v = pViajes.lista.find((x) => x.id === id);
  await q(db().from('viajes').update({ precio_auto: true, precio_manual: null }).eq('id', id));
  await q(db().rpc('recalcular_tarifas', { p_desde: v.fecha, p_hasta: v.fecha, p_ids: [id] }));
  aviso('Precio de tarifa aplicado'); pViajes();
}
function recalcularTotalesViajes() {
  const t = $('#t-viajes'); if (!t || !$('#tot-total')) return;
  let total = 0;
  CONCEPTOS.forEach(([k]) => {
    const s = [...t.querySelectorAll(`.c-imp[data-campo="${k}"]`)].reduce((a, x) => a + (leerNum(x.value) || 0), 0);
    total += s; $('#tot-' + k).textContent = eur(s);
  });
  $('#tot-total').innerHTML = `<b>${eur(total)}</b>`;
}
function marcarSel(id, on) {
  if (on) selViajes.add(id); else selViajes.delete(id);
  const b = $('#b-borrar-sel'); b.disabled = !selViajes.size; b.textContent = '🗑 Borrar seleccionados' + (selViajes.size ? ` (${selViajes.size})` : '');
}
function selTodos(on) { document.querySelectorAll('#t-viajes .c-sel').forEach((c) => { c.checked = on; marcarSel(c.closest('tr').dataset.id, on); }); }
async function borrarSeleccionados() {
  const ids = [...selViajes];
  if (!ids.length || !confirm(`¿Borrar ${ids.length} viajes? Los que vienen de TransControl no volverán a importarse.`)) return;
  const n = await q(db().rpc('borrar_viajes', { p_ids: ids }));
  selViajes.clear(); aviso(`${n} viajes borrados`); pViajes();
}
async function borrarViaje(id) {
  if (!confirm('¿Borrar este viaje? Si viene de TransControl no volverá a importarse.')) return;
  await q(db().rpc('borrar_viajes', { p_ids: [id] }));
  selViajes.delete(id); cerrarModal(); aviso('Viaje borrado'); pViajes();
}
async function recalcularPrecios() {
  const n = await q(db().rpc('recalcular_tarifas', { p_desde: fViajes.desde, p_hasta: fViajes.hasta }));
  aviso(`Precios recalculados en ${n} viajes (los puestos a mano y los facturados no se tocan)`); pViajes();
}
async function asignarClienteMasivo() {
  const c = val('masivo-cliente');
  if (!c) return aviso('Elige el cliente', true);
  const ids = pViajes.lista.filter((v) => !v.cliente_id && !v.factura_id).map((v) => v.id);
  await q(db().from('viajes').update({ cliente_id: c }).in('id', ids));
  await q(db().rpc('recalcular_tarifas', { p_desde: fViajes.desde, p_hasta: fViajes.hasta, p_ids: ids }));
  aviso(`${ids.length} viajes asignados`); pViajes();
}

async function exportarViajesExcel() {
  await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const lista = [...pViajes.lista].sort((a, b) => a.fecha.localeCompare(b.fecha) || (a.ruta_nombre || '').localeCompare(b.ruta_nombre || ''));
  const filas = [];
  for (const v of lista) {
    const cli = v.detalle_clientes || []; const alb = v.albaranes || [];
    const n = Math.max(cli.length, alb.length, 1);
    for (let i = 0; i < n; i++) {
      const f = { RUTA: i === 0 ? (v.ruta_nombre || '').replace(/^RUTA\s+/i, '') : '', 'Nº EXPEDICION': i === 0 ? (v.num_expedicion || '') : '', 'FECHA CARGA': fecha(v.fecha), 'DETALLE CLIENTES': cli[i] || '', 'DETALLE ALBARANES': alb[i] || '' };
      // los importes van solo en la primera fila de cada viaje para que la suma no se duplique
      CONCEPTOS.forEach(([k, , col]) => { const x = k === 'importe_ruta' ? (i === 0 ? (v.importe_ruta ?? v.precio_manual) : null) : (((v.extras_lineas || {})[claveLinea(v, i)] || {})[k] ?? (i === 0 && !Object.keys(v.extras_lineas || {}).length ? v[k] : null)); f[col] = x != null ? Number(x) : ''; });
      filas.push(f);
    }
  }
  const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin viajes' }]);
  ws['!cols'] = [12, 14, 12, 38, 18, 13, 13, 13, 15, 13].map((w) => ({ wch: w }));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Viajes');
  XLSX.writeFile(wb, `viajes_${fViajes.desde}_${fViajes.hasta}.xlsx`);
}

function subirCsvLactalis() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.csv,text/csv'; inp.multiple = true;
  inp.onchange = async () => {
    const files = [...inp.files]; if (!files.length) return;
    let lin = 0, nue = 0, enl = 0, act = 0;
    try {
      for (const f of files) {
        aviso('Subiendo ' + f.name + '…');
        const r = await q(db().rpc('importar_csv_lactalis', { p_texto: await f.text(), p_archivo: f.name }));
        const x = (r && r[0]) || {};
        lin += x.lineas || 0; nue += x.viajes_nuevos || 0; enl += x.viajes_enlazados || 0; act += x.viajes_actualizados || 0;
      }
      aviso(`${files.length} CSV: ${lin} albaranes · ${enl} viajes completados · ${nue} nuevos (no estaban en TransControl) · ${act} actualizados`);
      pViajes();
    } catch (e) { console.error(e); }
  };
  inp.click();
}

function importarViajes() {
  modal(`<h1>Importar viajes de TransControl</h1>
  <p class="ayuda">El ERP ya importa solo cada noche a las 23:00 los últimos 7 días. Usa esto si quieres traer los viajes ahora o un periodo más largo.
  Los viajes ya importados no se duplican (se actualizan sus paradas si no están facturados) y los borrados no vuelven. TransControl no se modifica.</p>
  <div class="rejilla"><div><label>Desde</label><input type="date" id="i-desde" value="${sumarDias(hoy(), -7)}"></div>
  <div><label>Hasta</label><input type="date" id="i-hasta" value="${hoy()}"></div></div>
  <div class="acciones"><button class="sec" onclick="cerrarModal()">Cancelar</button><button id="b-imp" onclick="hacerImportacion()">Importar</button></div>`);
}
async function hacerImportacion() {
  $('#b-imp').disabled = true; $('#b-imp').textContent = 'Importando…';
  try {
    const r = await q(db().rpc('importar_viajes_transcontrol', { p_desde: val('i-desde'), p_hasta: val('i-hasta'), p_origen: 'manual' }));
    const x = r[0] || {}; cerrarModal(); await recargarMaestros();
    aviso(`${x.viajes_nuevos} viajes nuevos${x.viajes_actualizados ? ' · ' + x.viajes_actualizados + ' actualizados' : ''}`);
    pintar();
  } catch { $('#b-imp').disabled = false; $('#b-imp').textContent = 'Importar'; }
}

async function editarViaje(id) {
  const v = id ? await q(db().from('v_viajes').select('*').eq('id', id).single()) : { fecha: hoy(), num_entregas: 1, num_paradas: 0, precio_auto: true };
  const rutas = await q(db().from('rutas').select('id,nombre,cliente_id').eq('ignorar', false).order('nombre'));
  editarViaje.rutas = rutas; editarViaje.v = v;
  const ruta = rutas.find((r) => r.id === v.ruta_id);
  const bloqueado = !!v.factura_id;
  const dis = bloqueado ? 'disabled' : '';
  const imp = (k) => (k === 'importe_ruta' ? (v.importe_ruta ?? v.precio_manual) : v[k]);
  modal(`<h1>${id ? 'Viaje del ' + fecha(v.fecha) : 'Nuevo viaje manual'}</h1>
  ${bloqueado ? `<p class="ayuda">Este viaje ya está en la factura ${esc(v.factura_codigo || '(borrador)')}: no se puede modificar ni borrar.</p>` : ''}
  ${v.transcontrol_id ? `<p class="ayuda">Importado de TransControl · ${v.num_entregas} ${v.num_entregas === 1 ? 'descarga' : 'descargas'}${v.hora_inicio ? ' · empezó a las ' + v.hora_inicio.slice(0, 5) : ''}</p>` : ''}
  <div class="rejilla">
    <div><label>Fecha carga</label><input type="date" id="v-fecha" value="${v.fecha}" ${dis}></div>
    <div><label>Ruta</label><input id="v-ruta" list="l-rutas" value="${esc(ruta?.nombre)}" placeholder="Escribe o elige" ${dis}>
      <datalist id="l-rutas">${rutas.map((r) => `<option value="${esc(r.nombre)}">`).join('')}</datalist></div>
    <div><label>Nº expedición</label><input id="v-exp" value="${esc(v.num_expedicion)}" ${dis}></div>
    <div><label>Cliente (a quién se factura)</label><select id="v-cliente" ${dis} onchange="ayudasExtra()">${opciones(S.clientes, v.cliente_id)}</select></div>
    <div><label>Conductor</label><select id="v-conductor" ${dis}>${opciones(S.conductores, v.conductor_id, '—')}</select></div>
    <div><label>Tractora / camión</label><select id="v-tractora" ${dis}>${opciones(S.vehiculos, v.tractora_id, '—', (x) => x.matricula + ' · ' + x.tipo)}</select></div>
  </div>
  <div class="rejilla">
    <div><label>Detalle clientes (uno por línea · cada línea es una parada)</label><textarea id="v-detalle" rows="4" ${dis}>${esc((v.detalle_clientes || []).join('\n'))}</textarea></div>
    <div><label>Detalle albaranes (uno por línea, en el mismo orden)</label><textarea id="v-albaranes" rows="4" ${dis}>${esc((v.albaranes || []).join('\n'))}</textarea></div>
  </div>
  <div class="rejilla">
    ${CONCEPTOS.map(([k, t]) => `<div><label>${t} €</label><input id="v-${k}" inputmode="decimal" value="${numCampo(imp(k))}" ${k === 'importe_ruta' ? dis : 'disabled title="Se pone por parada en la tabla de Viajes"'} oninput="${k === 'importe_ruta' ? "$('#v-auto').checked=false;" : ''}totalFichaViaje()"></div>`).join('')}
  </div>
  <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="v-auto" style="width:auto" ${v.precio_auto ? 'checked' : ''} ${dis}>
    Importe de ruta según tarifa ${v.tarifa_nombre ? '(' + esc(v.tarifa_nombre) + ')' : ''} — al guardar se recalcula con las paradas y el cliente</label>
  <div id="v-ayudas" class="barra" style="margin-top:10px"></div>
  <div class="rejilla">
    <div><label>Km</label><input type="number" id="v-km" value="${v.km ?? ''}" ${dis}></div>
  </div>
  <label>Notas</label><textarea id="v-notas" ${dis}>${esc(v.notas)}</textarea>
  <p style="text-align:right;font-size:17px">Total del viaje: <b id="v-total"></b></p>
  <div class="acciones">
    ${id && !bloqueado ? `<button class="peligro izq" onclick="borrarViaje('${id}')">Borrar viaje</button>` : ''}
    <button class="sec" onclick="cerrarModal()">${bloqueado ? 'Cerrar' : 'Cancelar'}</button>
    ${bloqueado ? '' : `<button onclick="guardarViaje(${id ? `'${id}'` : ''})">Guardar</button>`}
  </div>`);
  totalFichaViaje(); if (!bloqueado) ayudasExtra();
}
// Atajos con los precios del cliente: horas de paralización, manipulación, devolución
function ayudasExtra() {
  const c = S.clientes.find((x) => x.id === val('v-cliente')) || {};
  const h = c.precio_hora_paralizacion, m = c.precio_manipulacion, d = c.precio_devolucion;
  $('#v-ayudas').innerHTML = (h || m || d) ? `
    ${h ? `<div class="campo" style="min-width:0"><label>Horas de paralización × ${eur(h)}</label><input type="number" step="0.25" min="0" id="v-horas" style="width:110px" oninput="$('#v-importe_paralizacion').value=numCampo(Math.round((leerNum(this.value)||0)*${h}*100)/100);totalFichaViaje()"></div>` : ''}
    ${m ? `<button class="sec peq" type="button" onclick="$('#v-importe_manipulacion').value=numCampo(${m});totalFichaViaje()">+ Manipulación (${eur(m)})</button>` : ''}
    ${d ? `<button class="sec peq" type="button" onclick="$('#v-importe_retorno').value=numCampo((leerNum($('#v-importe_retorno').value)||0)+${d});totalFichaViaje()">+ Devolución (${eur(d)})</button>` : ''}` : '';
}
function totalFichaViaje() { $('#v-total').textContent = eur(CONCEPTOS.reduce((a, [k]) => a + (leerNum($('#v-' + k).value) || 0), 0)); }
async function guardarViaje(id) {
  const v0 = editarViaje.v || {};
  const reg = {
    fecha: val('v-fecha'), num_expedicion: val('v-exp'), cliente_id: val('v-cliente'), conductor_id: val('v-conductor'),
    tractora_id: val('v-tractora'), km: val('v-km'), notas: val('v-notas'), precio_auto: val('v-auto')
  };
  if (!reg.fecha) return aviso('La fecha es obligatoria', true);
  for (const [k, t] of CONCEPTOS.filter(([c]) => c === 'importe_ruta')) {
    const n = leerNum($('#v-' + k).value);
    if (Number.isNaN(n)) return aviso(`${t}: importe no válido`, true);
    reg[k] = n;
  }
  if (!reg.precio_auto) reg.precio_manual = null;
  const det = lineas($('#v-detalle').value); const alb = lineas($('#v-albaranes').value);
  while (det.length && !det[det.length - 1]) det.pop();
  while (alb.length && !alb[alb.length - 1]) alb.pop();
  reg.detalle_clientes = det.length ? det : null;
  reg.albaranes = alb.some(Boolean) ? alb : null;
  if (JSON.stringify(reg.detalle_clientes || []) !== JSON.stringify(v0.detalle_clientes || [])) { reg.detalle_manual = true; reg.num_entregas = Math.max(det.filter(Boolean).length, 1); reg.num_paradas = Math.max(reg.num_entregas - 1, 0); }
  const nombreRuta = val('v-ruta');
  if (nombreRuta) {
    let r = editarViaje.rutas.find((x) => x.nombre.toLowerCase() === nombreRuta.toLowerCase());
    if (!r) r = await q(db().from('rutas').insert({ nombre: nombreRuta, cliente_id: reg.cliente_id }).select('id').single());
    reg.ruta_id = r.id;
  } else reg.ruta_id = null;
  if (id) await q(db().from('viajes').update(reg).eq('id', id));
  else id = (await q(db().from('viajes').insert(reg).select('id').single())).id;
  if (reg.precio_auto) await q(db().rpc('recalcular_tarifas', { p_desde: reg.fecha, p_hasta: reg.fecha, p_ids: [id] }));
  aviso('Viaje guardado'); cerrarModal(); pViajes();
}

/* ---------------------------------------------------------------- TARIFAS DE VIAJES */
const TF_DIA = { '': 'Cualquier día', laborable: 'Lunes a viernes', sabado: 'Sábado', domingo: 'Domingo' };
const TF_FRANJA = { '': 'Cualquier hora', diurna: 'De día', nocturna: 'Nocturna (21:00–05:00)' };
const TF_MODO = { fijo: 'Precio por viaje', paradas: 'Según nº de paradas', por_unidad: 'Por unidad (cada lanzadera)' };
async function pTarifas() {
  const lista = await q(db().from('tarifas_viaje').select('*').order('orden').order('nombre'));
  const cli = (id) => (S.clientes.find((c) => c.id === id) || {}).nombre || '';
  const selO = (cls, obj, v) => `<select class="${cls}">${Object.entries(obj).map(([k, t]) => `<option value="${k}" ${String(v ?? '') === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const fila = (t) => `<tr data-id="${t.id || ''}" class="${t.activo === false ? 'anulado' : ''}">
    <td><input class="tf-orden" type="number" value="${t.orden ?? 100}" style="width:64px;min-width:0"></td>
    <td><input class="tf-nombre" value="${esc(t.nombre)}" style="min-width:170px"></td>
    <td><select class="tf-cliente">${opciones(S.clientes, t.cliente_id, '— cualquiera —')}</select></td>
    <td><input class="tf-ruta" value="${esc(t.ruta_contiene)}" placeholder="(cualquiera)"></td>
    <td><input class="tf-parada" value="${esc(t.parada_contiene)}" placeholder="(cualquiera)"></td>
    <td>${selO('tf-dia', TF_DIA, t.dia)}</td><td>${selO('tf-franja', TF_FRANJA, t.franja)}</td><td>${selO('tf-modo', TF_MODO, t.modo || 'fijo')}</td>
    <td><input class="tf-precio" inputmode="decimal" value="${numCampo(t.precio)}" placeholder="a mano"></td>
    <td><input class="tf-precio2" inputmode="decimal" value="${numCampo(t.precio_2)}"></td>
    <td><input class="tf-extra" inputmode="decimal" value="${numCampo(t.precio_extra)}"></td>
    <td><input class="tf-activo" type="checkbox" style="width:auto;min-width:0" ${t.activo === false ? '' : 'checked'}></td>
    <td><input class="tf-notas" value="${esc(t.notas)}"></td>
    <td style="white-space:nowrap"><button class="peq" onclick="guardarTarifaViaje(this)">Guardar</button> ${t.id ? `<button class="sec peq" onclick="borrarTarifaViaje('${t.id}')">🗑</button>` : ''}</td></tr>`;
  $('#pagina').innerHTML = `
  <h1>Viajes</h1>
  ${barraViajes()}
  <p class="ayuda">Cada viaje toma la <b>primera tarifa de la lista (por orden) que encaja</b> con su cliente, su ruta, sus paradas, el día y la hora. Esa tarifa pone el importe de ruta y, si el viaje no tiene cliente, también el cliente.
  <br><b>Ruta contiene</b> y <b>Parada contiene</b>: textos separados por comas (da igual mayúsculas o tildes). <b>Precio vacío</b> = el cliente manda prefactura y el precio se pone a mano.
  <br><b>Según nº de paradas</b>: 1 parada = Precio · 2 paradas = Precio 2 paradas · cada parada de más suma «Extra por parada». <b>Precio por viaje</b>: el «Extra» se suma por cada parada a partir de la segunda.
  <br>Después de cambiar tarifas, pulsa <b>↺ Recalcular precios</b> en Viajes (no toca los puestos a mano ni los facturados).</p>
  <div class="barra"><button onclick="nuevaTarifaViaje()">+ Nueva tarifa</button></div>
  <div class="tabla-wrap"><table class="hoja" id="t-tarifas">
    <tr><th>Orden</th><th>Nombre</th><th>Cliente</th><th>Ruta contiene</th><th>Parada contiene</th><th>Día</th><th>Hora</th><th>Cómo se cobra</th><th class="num">Precio €</th><th class="num">2 paradas €</th><th class="num">Extra por parada €</th><th>Activa</th><th>Notas</th><th></th></tr>
    ${lista.map(fila).join('')}
  </table></div>
  <h2>Extras por cliente</h2>
  <p class="ayuda">Salen como atajos al editar un viaje: horas de paralización × precio, manipulación y devolución.</p>
  <div class="tabla-wrap"><table class="hoja"><tr><th>Cliente</th><th class="num">Hora de paralización €</th><th class="num">Manipulación €</th><th class="num">Devolución €</th><th></th></tr>
    ${S.clientes.map((c) => `<tr data-id="${c.id}"><td><b>${esc(c.nombre)}</b></td>
      <td class="num"><input class="cx-h" inputmode="decimal" value="${numCampo(c.precio_hora_paralizacion)}"></td>
      <td class="num"><input class="cx-m" inputmode="decimal" value="${numCampo(c.precio_manipulacion)}"></td>
      <td class="num"><input class="cx-d" inputmode="decimal" value="${numCampo(c.precio_devolucion)}"></td>
      <td><button class="peq" onclick="guardarExtrasCliente(this)">Guardar</button></td></tr>`).join('')}
  </table></div>`;
  pTarifas.fila = fila;
}
function nuevaTarifaViaje() {
  const tb = $('#t-tarifas tbody') || $('#t-tarifas');
  tb.insertAdjacentHTML('beforeend', pTarifas.fila({ orden: 100, modo: 'fijo', dia: '', franja: '', activo: true }));
  tb.lastElementChild.querySelector('.tf-nombre').focus();
}
async function guardarTarifaViaje(btn) {
  const tr = btn.closest('tr'); const g = (c) => tr.querySelector('.' + c);
  const num = (c) => { const n = leerNum(g(c).value); if (Number.isNaN(n)) throw new Error(c); return n; };
  let reg;
  try {
    reg = { orden: Number(g('tf-orden').value || 100), nombre: g('tf-nombre').value.trim(), cliente_id: g('tf-cliente').value || null,
      ruta_contiene: g('tf-ruta').value.trim() || null, parada_contiene: g('tf-parada').value.trim() || null,
      dia: g('tf-dia').value, franja: g('tf-franja').value, modo: g('tf-modo').value,
      precio: num('tf-precio'), precio_2: num('tf-precio2'), precio_extra: num('tf-extra'), activo: g('tf-activo').checked, notas: g('tf-notas').value.trim() || null };
  } catch { return aviso('Hay un precio no válido en esa fila', true); }
  if (!reg.nombre) return aviso('Ponle un nombre a la tarifa', true);
  if (tr.dataset.id) await q(db().from('tarifas_viaje').update(reg).eq('id', tr.dataset.id));
  else tr.dataset.id = (await q(db().from('tarifas_viaje').insert(reg).select('id').single())).id;
  aviso('Tarifa guardada. Pulsa «↺ Recalcular precios» en Viajes para aplicarla.'); pTarifas();
}
async function borrarTarifaViaje(id) {
  if (!confirm('¿Borrar esta tarifa? Los viajes que ya tienen precio no cambian hasta que recalcules.')) return;
  await q(db().from('viajes').update({ tarifa_id: null }).eq('tarifa_id', id));
  await q(db().from('tarifas_viaje').delete().eq('id', id)); aviso('Tarifa borrada'); pTarifas();
}
async function guardarExtrasCliente(btn) {
  const tr = btn.closest('tr'); const g = (c) => leerNum(tr.querySelector('.' + c).value);
  const reg = { precio_hora_paralizacion: g('cx-h'), precio_manipulacion: g('cx-m'), precio_devolucion: g('cx-d') };
  if (Object.values(reg).some(Number.isNaN)) return aviso('Importe no válido', true);
  await q(db().from('clientes').update(reg).eq('id', tr.dataset.id));
  await recargarMaestros(); aviso('Extras del cliente guardados');
}

/* ---------------------------------------------------------------- TARIFAS (solo recargo de gasoil por cliente) */
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
    <div class="campo"><label>Porcentaje (%)</label><input type="number" step="0.01" id="t-precio"></div>
    <div class="campo"><label>Desde</label><input type="date" id="t-desde" value="2026-01-01"></div>
    <div class="campo"><label>Nota</label><input id="t-desc" placeholder="opcional"></div>
    <button onclick="${accion}">Añadir</button></div>`;
}
async function guardarTarifa(clienteId) {
  if (val('t-precio') == null) return aviso('Pon el porcentaje', true);
  await q(db().from('tarifas').insert({ cliente_id: clienteId, ruta_id: null, tipo: val('t-tipo'), precio: val('t-precio'), vigente_desde: val('t-desde') || hoy(), descripcion: val('t-desc') }));
  aviso('Recargo añadido'); editarCliente(clienteId);
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
  const tar = id ? await q(db().from('tarifas').select('*').eq('cliente_id', id).is('ruta_id', null).eq('tipo', 'recargo_gasoil_pct').order('vigente_desde', { ascending: false })) : [];
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
  ${id ? `<h2>Recargo de gasoil</h2>
  <p class="ayuda">Opcional. Si el cliente paga un % de recargo de gasoil, se añade al final de cada prefactura sobre la suma de los importes de ruta.</p>
  ${tablaTarifas(tar, `editarCliente('${id}')`)}
  ${formTarifa(`guardarTarifa('${id}')`, ['recargo_gasoil_pct'])}` : ''}`);
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
  <p class="ayuda">Junta en un borrador todos los viajes sin facturar del cliente en ese periodo: importe de ruta, manipulación, retornos, paralizaciones y peajes. Puedes revisarlo antes de emitir.</p>
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
const TIPOS_VENC = { itv: 'ITV', seguro: 'Seguro', tacografo: 'Tacógrafo', atp: 'ATP (frigorífico)', revision: 'Revisión / mantenimiento', revision_frio: 'Revisión equipo de frío',
  tarjeta_transporte: 'Tarjeta de transporte', extintores: 'Extintores', ivtm: 'Impuesto de circulación (IVTM)', otro: 'Otro' };
// cada cuánto se repite cada vencimiento (meses) — se propone al crear y al renovar
const PERIODO_VENC = { itv: 12, seguro: 12, tacografo: 24, atp: 72, revision: 12, revision_frio: 12, tarjeta_transporte: 12, extintores: 12, ivtm: 12, otro: 12 };
const REGIMEN = { propio: 'Propio', leasing: 'Leasing', renting: 'Renting', alquiler: 'Alquiler', financiado: 'Financiado (préstamo)', otro: 'Otro' };
const REG_COLOR = { propio: 'verde', leasing: 'azul', renting: 'ambar', alquiler: 'ambar', financiado: 'azul', otro: 'gris' };
const sumarMeses = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setMonth(x.getMonth() + n); return x.toLocaleDateString('sv-SE'); };
const fFlota = { ver: 'activos', regimen: '', tipo: '', vtipo: '', plazo: '', buscar: '' };
const PLAZOS = [['', 'Cualquier fecha'], ['vencido', 'Vencidos'], ['30', 'En 30 días o menos'], ['60', 'En 60 días o menos'], ['90', 'En 90 días o menos'], ['ninguno', 'Sin vencimientos']];
async function pFlota() {
  let qy = db().from('v_vehiculos').select('*').order('tipo').order('matricula');
  qy = fFlota.ver === 'activos' ? qy.is('fecha_baja', null) : qy.not('fecha_baja', 'is', null);
  if (fFlota.regimen) qy = qy.eq('regimen', fFlota.regimen);
  if (fFlota.tipo) qy = qy.eq('tipo', fFlota.tipo);
  const [todos, venc] = await Promise.all([q(qy), q(db().from('vehiculo_vencimientos').select('*').eq('renovado', false).order('fecha_vencimiento'))]);
  // Vencimientos abiertos de cada vehículo, filtrados por tipo de vencimiento y plazo
  const hasta = /^\d+$/.test(fFlota.plazo) ? sumarDias(hoy(), Number(fFlota.plazo)) : null;
  const encaja = (x) => (!fFlota.vtipo || x.tipo === fFlota.vtipo) && (fFlota.plazo === 'vencido' ? x.fecha_vencimiento < hoy() : hasta ? x.fecha_vencimiento <= hasta : true);
  const porVeh = {}; venc.forEach((x) => (porVeh[x.vehiculo_id] = porVeh[x.vehiculo_id] || []).push(x));
  let lista = todos.map((v) => ({ ...v, _venc: (porVeh[v.id] || []).filter(encaja) }));
  if (fFlota.plazo === 'ninguno') lista = lista.filter((v) => !(porVeh[v.id] || []).some((x) => !fFlota.vtipo || x.tipo === fFlota.vtipo));
  else if (fFlota.plazo || fFlota.vtipo) lista = lista.filter((v) => v._venc.length);
  if (fFlota.buscar) { const b = fFlota.buscar.toUpperCase().replace(/[\s-]+/g, ''); lista = lista.filter((v) => [v.matricula, v.marca, v.modelo, v.entidad].some((x) => (x || '').toUpperCase().replace(/[\s-]+/g, '').includes(b))); }
  pFlota.lista = lista; pFlota.venc = porVeh;
  const suma = (k) => lista.reduce((a, v) => a + Number(v[k] || 0), 0);
  const cuotas = lista.filter((v) => v.regimen !== 'propio').reduce((a, v) => a + Number(v.cuota_mensual || 0), 0);
  const margen = S.empresa?.dias_aviso_vencimientos ?? 30;
  const proximos = lista.filter((v) => v.proximo_vencimiento && v.proximo_vencimiento <= sumarDias(hoy(), margen)).length;
  const sel = (id, k, ops) => `<select id="${id}">${ops.map(([o, t]) => `<option value="${o}" ${fFlota[k] === o ? 'selected' : ''}>${t}</option>`).join('')}</select>`;
  const filtros = fFlota.regimen || fFlota.tipo || fFlota.vtipo || fFlota.plazo || fFlota.buscar;
  $('#pagina').innerHTML = `
  <h1>Flota</h1>
  <div class="barra">
    <div class="campo"><label>Ver</label>${sel('fl-ver', 'ver', [['activos', 'En servicio'], ['bajas', 'Dados de baja']])}</div>
    <div class="campo"><label>Tipo</label>${sel('fl-tipo', 'tipo', [['', 'Todos'], ...Object.entries(TIPOS_VEH)])}</div>
    <div class="campo"><label>Régimen</label>${sel('fl-regimen', 'regimen', [['', 'Todos'], ...Object.entries(REGIMEN)])}</div>
    <div class="campo"><label>Vencimiento de</label>${sel('fl-vtipo', 'vtipo', [['', 'Cualquiera (ITV, seguro…)'], ...Object.entries(TIPOS_VENC)])}</div>
    <div class="campo"><label>Que vence</label>${sel('fl-plazo', 'plazo', PLAZOS)}</div>
    <div class="campo"><label>Buscar</label><input id="fl-buscar" value="${esc(fFlota.buscar)}" placeholder="Matrícula, marca…"></div>
  </div>
  <div class="barra">
    <button onclick="editarVehiculo()">+ Nuevo vehículo</button>
    <button class="sec" onclick="exportarFlotaExcel()">⬇ Exportar a Excel</button>
    ${filtros ? `<button class="sec" onclick="Object.assign(fFlota,{regimen:'',tipo:'',vtipo:'',plazo:'',buscar:''});pFlota()">✕ Quitar filtros</button>` : ''}
  </div>
  <div class="kpis">
    <div class="kpi"><div class="t">Vehículos${filtros ? ' (filtrados)' : ''}</div><div class="n">${lista.length}</div><div class="t">${lista.filter((v) => v.regimen === 'propio').length} propios · ${lista.filter((v) => v.regimen !== 'propio').length} en leasing / renting / otros</div></div>
    <div class="kpi"><div class="t">Cuotas al mes (sin IVA)</div><div class="n">${eur(cuotas)}</div><div class="t">leasing, renting, alquiler, préstamos</div></div>
    <div class="kpi"><div class="t">Coste fijo / mes</div><div class="n">${eur(suma('coste_fijo_mes'))}</div><div class="t">cuotas + amortización + seguros, ITV… prorrateados</div></div>
    <div class="kpi"><div class="t">Vencimientos próximos</div><div class="n" style="color:${proximos ? 'var(--ambar)' : 'inherit'}">${proximos}</div><div class="t">en los próximos ${margen} días</div></div>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Matrícula</th><th>Tipo</th><th>Marca / modelo</th><th>Régimen</th><th>Entidad</th><th class="num">Cuota / mes</th><th class="num">Coste fijo / mes</th><th class="num">Km</th><th>Fin contrato</th><th>${fFlota.vtipo || fFlota.plazo ? 'Vencimientos que cumplen el filtro' : 'Próximo vencimiento'}</th></tr>
    ${lista.map((v) => `<tr class="clic" onclick="editarVehiculo('${v.id}')"><td><b>${esc(v.matricula)}</b> ${v.frigorifico ? '❄️' : ''}</td><td>${TIPOS_VEH[v.tipo] || v.tipo}</td>
      <td>${esc([v.marca, v.modelo].filter(Boolean).join(' '))}</td><td>${et(REG_COLOR[v.regimen] || 'gris', REGIMEN[v.regimen] || v.regimen)}</td><td>${esc(v.entidad)}</td>
      <td class="num">${v.regimen !== 'propio' && v.cuota_mensual != null ? eur(v.cuota_mensual) : ''}</td><td class="num">${Number(v.coste_fijo_mes) ? eur(v.coste_fijo_mes) : ''}</td>
      <td class="num">${v.km_actuales != null ? num(v.km_actuales, 0) : ''}</td>
      <td>${v.regimen !== 'propio' && v.contrato_fin ? estadoFecha(v.contrato_fin) : ''}</td>
      <td>${(fFlota.vtipo || fFlota.plazo) && fFlota.plazo !== 'ninguno'
        ? v._venc.map((x) => (TIPOS_VENC[x.tipo] || x.tipo) + ' · ' + estadoFecha(x.fecha_vencimiento)).join('<br>')
        : v.proximo_vencimiento ? (TIPOS_VENC[v.proximo_tipo] || v.proximo_tipo) + ' · ' + estadoFecha(v.proximo_vencimiento) : et('gris', 'Sin vencimientos')}</td></tr>`).join('')}
  </table>${lista.length ? '' : `<div class="vacio">${filtros ? 'Ningún vehículo cumple estos filtros.' : 'No hay vehículos. Pulsa «+ Nuevo vehículo».'}</div>`}</div>`;
  ['ver', 'tipo', 'regimen', 'vtipo', 'plazo'].forEach((k) => { $('#fl-' + k).onchange = (e) => { fFlota[k] = e.target.value; pFlota(); }; });
  $('#fl-buscar').oninput = (e) => { fFlota.buscar = e.target.value; clearTimeout(pFlota.t); pFlota.t = setTimeout(() => { pFlota().then(() => { const b = $('#fl-buscar'); b.focus(); b.setSelectionRange(b.value.length, b.value.length); }); }, 350); };
}
// Excel de la flota (lo que se ve con los filtros puestos): hoja de vehículos + hoja de vencimientos
async function exportarFlotaExcel() {
  await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const n2 = (x) => (x == null || x === '' ? '' : Math.round(Number(x) * 100) / 100);
  const f = (d) => fecha(d) || '';
  const lista = pFlota.lista || [];
  const conductor = (id) => (S.conductores.find((c) => c.id === id) || {}).nombre || '';
  const vehiculos = lista.map((v) => ({
    Matrícula: v.matricula, Tipo: TIPOS_VEH[v.tipo] || v.tipo, Marca: v.marca || '', Modelo: v.modelo || '', Bastidor: v.bastidor || '',
    'Fecha matriculación': f(v.fecha_matriculacion), 'Norma Euro': v.norma_euro || '', 'MMA (kg)': n2(v.mma_kg), Frigorífico: v.frigorifico ? 'Sí' : 'No',
    'Equipo de frío': v.equipo_frio || '', 'Horas frío': n2(v.horas_equipo_frio), 'Km actuales': n2(v.km_actuales), 'Km a fecha': f(v.km_actuales_fecha),
    'Remolque habitual': v.remolque_habitual || '', 'Conductor habitual': v.conductor_habitual || conductor(v.conductor_habitual_id),
    Régimen: REGIMEN[v.regimen] || v.regimen, Entidad: v.entidad || '', 'Nº contrato': v.num_contrato || '', 'Inicio contrato': f(v.contrato_inicio), 'Fin contrato': f(v.contrato_fin),
    'Cuota mensual (sin IVA)': n2(v.cuota_mensual), 'IVA cuota %': n2(v.cuota_iva_pct), 'Día cargo': n2(v.dia_cargo), 'Valor residual': n2(v.valor_residual),
    'Km contratados/año': n2(v.km_contratados_anio), 'Precio km exceso': n2(v.precio_km_exceso),
    'Fecha compra': f(v.fecha_compra), 'Precio compra': n2(v.precio_compra), 'Años amortización': n2(v.anios_amortizacion),
    'Coste fijo / mes': n2(v.coste_fijo_mes), 'Próximo vencimiento': v.proximo_vencimiento ? (TIPOS_VENC[v.proximo_tipo] || v.proximo_tipo) + ' ' + f(v.proximo_vencimiento) : '',
    'Tarjeta gasoil': v.tarjeta_gasoil || '', 'Dispositivo peaje': v.dispositivo_peaje || '', 'Alta empresa': f(v.fecha_alta), Baja: f(v.fecha_baja), Notas: v.notas || ''
  }));
  const estado = (d) => (d < hoy() ? 'CADUCADO' : d <= sumarDias(hoy(), S.empresa?.dias_aviso_vencimientos ?? 30) ? 'Vence pronto' : 'En vigor');
  const vencimientos = [];
  lista.forEach((v) => ((fFlota.vtipo || fFlota.plazo) && fFlota.plazo !== 'ninguno' ? v._venc : pFlota.venc[v.id] || []).forEach((x) => vencimientos.push({
    Matrícula: v.matricula, Tipo: TIPOS_VENC[x.tipo] || x.tipo, 'Compañía / taller': x.proveedor || '', 'Nº póliza / nota': x.descripcion || '',
    Vence: f(x.fecha_vencimiento), Estado: estado(x.fecha_vencimiento), Importe: n2(x.importe), 'Cada (meses)': n2(x.periodicidad_meses), Documento: x.archivo_url ? 'Sí' : 'No'
  })));
  const wb = XLSX.utils.book_new();
  const hoja = (filas, nombre) => { const ws = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '': 'Sin datos' }]);
    ws['!cols'] = Object.keys(filas[0] || { '': '' }).map((k) => ({ wch: Math.max(10, Math.min(40, Math.max(k.length + 2, ...filas.map((r) => String(r[k] ?? '').length + 2)))) }));
    ws['!autofilter'] = filas.length ? { ref: ws['!ref'] } : undefined; XLSX.utils.book_append_sheet(wb, ws, nombre); };
  hoja(vehiculos, 'Vehículos'); hoja(vencimientos, 'Vencimientos');
  XLSX.writeFile(wb, `flota_${hoy()}.xlsx`);
  aviso(`Excel descargado: ${vehiculos.length} vehículos, ${vencimientos.length} vencimientos`);
}

// Campos de la ficha del vehículo, por pestaña: [campo, etiqueta, tipo]
const CAMPOS_VEH = {
  ficha: [['matricula', 'Matrícula'], ['tipo', 'Tipo', TIPOS_VEH], ['marca', 'Marca'], ['modelo', 'Modelo'], ['bastidor', 'Nº bastidor'],
    ['fecha_matriculacion', 'Fecha matriculación', 'date'], ['norma_euro', 'Norma Euro (ZBE)', { '': '—', 'Euro 6': 'Euro 6', 'Euro 5': 'Euro 5', 'Euro 4': 'Euro 4', 'Anterior': 'Anterior' }],
    ['mma_kg', 'MMA (kg)', 'number'], ['frigorifico', 'Frigorífico', 'checkbox'], ['equipo_frio', 'Equipo de frío (marca / modelo)'], ['horas_equipo_frio', 'Horas equipo de frío', 'number'],
    ['km_actuales', 'Km actuales', 'number'], ['km_actuales_fecha', 'Km a fecha de', 'date'], ['remolque_habitual_id', 'Remolque habitual', 'remolque'], ['conductor_habitual_id', 'Conductor habitual', 'conductor'],
    ['tarjeta_gasoil', 'Tarjeta de gasoil (nº)'], ['dispositivo_peaje', 'Dispositivo de peaje (Via-T…)'],
    ['fecha_alta', 'Alta en la empresa', 'date'], ['fecha_baja', 'Baja (vendido / retirado)', 'date']],
  contrato: [['regimen', 'Régimen', REGIMEN], ['entidad', 'Entidad (leasing, renting, banco, arrendador)'], ['num_contrato', 'Nº de contrato'],
    ['contrato_inicio', 'Inicio contrato', 'date'], ['contrato_fin', 'Fin contrato', 'date'], ['cuota_mensual', 'Cuota mensual sin IVA €', 'money'],
    ['cuota_iva_pct', 'IVA de la cuota %', { 21: '21', 10: '10', 0: '0 (exento)' }], ['dia_cargo', 'Día del cargo en banco', 'number'],
    ['valor_residual', 'Valor residual / opción de compra €', 'money'], ['km_contratados_anio', 'Km contratados al año (renting)', 'number'],
    ['precio_km_exceso', 'Precio km de exceso €', 'money'],
    ['fecha_compra', 'Fecha de compra', 'date'], ['precio_compra', 'Precio de compra sin IVA €', 'money'], ['anios_amortizacion', 'Años para amortizarlo', 'number']]
};
// Qué campos del contrato se ven según el régimen
const VISIBLE_REG = {
  propio: ['regimen', 'fecha_compra', 'precio_compra', 'anios_amortizacion'],
  leasing: ['regimen', 'entidad', 'num_contrato', 'contrato_inicio', 'contrato_fin', 'cuota_mensual', 'cuota_iva_pct', 'dia_cargo', 'valor_residual'],
  renting: ['regimen', 'entidad', 'num_contrato', 'contrato_inicio', 'contrato_fin', 'cuota_mensual', 'cuota_iva_pct', 'dia_cargo', 'km_contratados_anio', 'precio_km_exceso'],
  alquiler: ['regimen', 'entidad', 'num_contrato', 'contrato_inicio', 'contrato_fin', 'cuota_mensual', 'cuota_iva_pct', 'dia_cargo'],
  financiado: ['regimen', 'entidad', 'num_contrato', 'contrato_inicio', 'contrato_fin', 'cuota_mensual', 'cuota_iva_pct', 'dia_cargo', 'fecha_compra', 'precio_compra'],
  otro: null
};
function campoVeh(v, [k, t, tipo = 'text']) {
  const id = 've-' + k;
  if (tipo === 'checkbox') return `<div><label>${t}</label><input type="checkbox" id="${id}" style="width:auto" ${v[k] ? 'checked' : ''}></div>`;
  if (tipo === 'remolque') return `<div><label>${t}</label><select id="${id}">${opciones(editarVehiculo.remolques.filter((r) => r.id !== v.id), v[k], '—', (x) => x.matricula)}</select></div>`;
  if (tipo === 'conductor') return `<div><label>${t}</label><select id="${id}">${opciones(S.conductores, v[k], '—')}</select></div>`;
  if (typeof tipo === 'object') return `<div><label>${t}</label><select id="${id}" ${k === 'regimen' ? 'onchange="verCamposRegimen()"' : ''}>${Object.entries(tipo).map(([o, txt]) => `<option value="${o}" ${String(v[k] ?? '') === String(o) ? 'selected' : ''}>${txt}</option>`).join('')}</select></div>`;
  if (tipo === 'money') return `<div data-campo="${k}"><label>${t}</label><input id="${id}" inputmode="decimal" value="${numCampo(v[k])}" oninput="resumenContrato()"></div>`;
  return `<div data-campo="${k}"><label>${t}</label><input id="${id}" type="${tipo}" value="${esc(v[k])}" ${tipo === 'number' ? 'oninput="resumenContrato()"' : ''}></div>`;
}
function verCamposRegimen() {
  const r = val('ve-regimen'); const vis = VISIBLE_REG[r];
  CAMPOS_VEH.contrato.forEach(([k]) => { const e = document.getElementById('ve-' + k)?.closest('div'); if (e) e.classList.toggle('oculto', !!vis && !vis.includes(k)); });
  resumenContrato();
}
function resumenContrato() {
  const caja = $('#ve-resumen'); if (!caja) return;
  const r = val('ve-regimen'); const n = (k) => leerNum($('#ve-' + k)?.value) || 0;
  let txt = '';
  if (r === 'propio') {
    const a = n('anios_amortizacion'); txt = a && n('precio_compra') ? `Amortización: <b>${eur(n('precio_compra') / a / 12)}</b> al mes (${eur(n('precio_compra') / a)} al año).` : 'Pon precio de compra y años para calcular la amortización mensual.';
  } else {
    const cuota = n('cuota_mensual'); const iva = Number(val('ve-cuota_iva_pct') || 0);
    const ini = val('ve-contrato_inicio'); const fin = val('ve-contrato_fin');
    let meses = 0, quedan = 0;
    if (ini && fin) meses = Math.max(0, Math.round((new Date(fin) - new Date(ini)) / 2629800000));
    if (fin) quedan = Math.max(0, Math.round((new Date(fin) - new Date(hoy())) / 2629800000));
    txt = cuota ? `Cuota con IVA: <b>${eur(cuota * (1 + iva / 100))}</b> · al año: <b>${eur(cuota * 12)}</b> sin IVA` : 'Pon la cuota mensual.';
    if (cuota && meses) txt += ` · total del contrato: ${eur(cuota * meses)} (${meses} meses)`;
    if (cuota && fin) txt += ` · quedan ${quedan} cuotas (${eur(cuota * quedan)})`;
    if (r === 'leasing' && n('valor_residual')) txt += ` · opción de compra al final: ${eur(n('valor_residual'))}`;
  }
  caja.innerHTML = txt;
}

async function editarVehiculo(id, pestana = 'ficha') {
  const v = id ? await q(db().from('v_vehiculos').select('*').eq('id', id).single()) : { tipo: 'tractora', frigorifico: true, fecha_alta: hoy(), regimen: 'propio', cuota_iva_pct: 21 };
  editarVehiculo.remolques = await q(db().from('vehiculos').select('id,matricula').in('tipo', ['semirremolque', 'remolque']).is('fecha_baja', null).order('matricula'));
  const tabs = id ? [['ficha', 'Ficha'], ['contrato', 'Régimen y cuota'], ['vencimientos', 'Seguros, ITV y vencimientos'], ['costes', 'Costes']] : [['ficha', 'Ficha']];
  let cuerpo = '';
  if (pestana === 'ficha' || pestana === 'contrato') {
    cuerpo = `<div class="rejilla">${CAMPOS_VEH[pestana].map((c) => campoVeh(v, c)).join('')}</div>
    ${pestana === 'contrato' ? '<p class="ayuda" id="ve-resumen" style="margin-top:14px"></p>' : '<label>Notas</label><textarea id="ve-notas">' + esc(v.notas) + '</textarea>'}
    <div class="acciones">${id && pestana === 'ficha' ? `<button class="peligro izq" onclick="borrarVehiculo('${id}')">Borrar</button>` : ''}
      <button class="sec" onclick="cerrarModal();pFlota()">Cerrar</button><button onclick="guardarVehiculo(${id ? `'${id}'` : 'null'},'${pestana}')">Guardar</button></div>`;
  } else if (pestana === 'vencimientos') {
    const venc = await q(db().from('vehiculo_vencimientos').select('*').eq('vehiculo_id', id).order('renovado').order('fecha_vencimiento'));
    const vigentes = venc.filter((x) => !x.renovado && x.importe != null);
    const anual = vigentes.reduce((a, x) => a + Number(x.importe) * 12 / (x.periodicidad_meses || 12), 0);
    cuerpo = `<p class="ayuda">Pulsa <b>Editar</b> para cambiar cualquier dato. Cuando renueves (nueva ITV, nuevo seguro…) pulsa <b>Renovar</b>: se crea el nuevo con la fecha siguiente y el anterior queda en el historial.</p>
    ${tablaVencimientos(venc, TIPOS_VENC, 'vehiculo_vencimientos', `editarVehiculo('${id}','vencimientos')`)}
    ${vigentes.length ? `<p style="text-align:right">Coste anual de lo vigente: <b>${eur(anual)}</b> · al mes: <b>${eur(anual / 12)}</b></p>` : ''}
    <div class="acciones"><button onclick="editarVencimiento('vehiculo_vencimientos', null, ${esc(JSON.stringify(`editarVehiculo('${id}','vencimientos')`))}, '${id}')">+ Añadir seguro, ITV…</button></div>`;
  } else if (pestana === 'costes') {
    cuerpo = await costesVehiculo(v);
  }
  modal(`<h1>${id ? esc(v.matricula) + ' ' + et(REG_COLOR[v.regimen] || 'gris', REGIMEN[v.regimen] || v.regimen) : 'Nuevo vehículo'}</h1>
  ${id ? `<div class="barra">${tabs.map(([k, t]) => `<button class="${k === pestana ? '' : 'sec'} peq" onclick="editarVehiculo('${id}','${k}')">${t}</button>`).join('')}</div>` : '<p class="ayuda">Guarda la ficha y después podrás rellenar el régimen, la cuota, los seguros y la ITV.</p>'}
  ${cuerpo}`);
  if (pestana === 'contrato') verCamposRegimen();
}
async function guardarVehiculo(id, pestana) {
  const reg = {};
  for (const [k, t, tipo] of CAMPOS_VEH[pestana]) {
    const e = document.getElementById('ve-' + k); if (!e) continue;
    if (tipo === 'checkbox') reg[k] = e.checked;
    else if (tipo === 'money') { const n = leerNum(e.value); if (Number.isNaN(n)) return aviso(`${t}: importe no válido`, true); reg[k] = n; }
    else reg[k] = val('ve-' + k);
  }
  if (pestana === 'ficha') {
    reg.notas = val('ve-notas');
    if (!reg.matricula) return aviso('La matrícula es obligatoria', true);
    reg.matricula = reg.matricula.toUpperCase().replace(/[\s-]+/g, '');
  }
  if (pestana === 'contrato') reg.cuota_iva_pct = Number(reg.cuota_iva_pct ?? 21);
  if (id) await q(db().from('vehiculos').update(reg).eq('id', id));
  else id = (await q(db().from('vehiculos').insert(reg).select('id').single())).id;
  await recargarMaestros(); aviso('Vehículo guardado'); editarVehiculo(id, pestana);
}
async function borrarVehiculo(id) {
  if (!confirm('¿Borrar el vehículo? Si ya tiene viajes o gastos, mejor ponle fecha de baja.')) return;
  await q(db().from('vehiculos').delete().eq('id', id)); cerrarModal(); await recargarMaestros(); pFlota();
}

// Pestaña «Costes»: últimos 12 meses de gastos del camión, coste fijo y coste por km
async function costesVehiculo(v) {
  const desde = inicioMes(sumarMeses(hoy(), -11));
  const [gastos, viajes] = await Promise.all([
    q(db().from('gastos').select('fecha,categoria,base,litros,km_vehiculo').eq('vehiculo_id', v.id).gte('fecha', desde).order('fecha')),
    q(db().from('viajes').select('fecha,km').eq('tractora_id', v.id).gte('fecha', desde).neq('estado', 'anulado'))
  ]);
  const ingresos = await q(db().from('v_ingreso_vehiculo_mes').select('*').eq('matricula', v.matricula).gte('mes', desde));
  const FIJOS = ['seguro', 'itv', 'tacografo', 'atp', 'financiacion_leasing', 'impuestos_tasas'];
  const porCat = {}; gastos.forEach((g) => (porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.base)));
  const variable = gastos.filter((g) => !FIJOS.includes(g.categoria)).reduce((a, g) => a + Number(g.base), 0);
  const meses = Math.max(1, new Set([...gastos, ...viajes].map((x) => x.fecha.slice(0, 7))).size); const fijo = Number(v.coste_fijo_mes || 0) * meses;
  const lecturas = gastos.map((g) => Number(g.km_vehiculo)).filter(Boolean);
  const kmLect = lecturas.length > 1 ? Math.max(...lecturas) - Math.min(...lecturas) : 0;
  const kmViajes = viajes.reduce((a, x) => a + Number(x.km || 0), 0);
  const km = kmLect || kmViajes;
  const litros = gastos.reduce((a, g) => a + Number(g.litros || 0), 0);
  const ingreso = ingresos.reduce((a, x) => a + Number(x.ingreso_estimado || 0), 0);
  const total = variable + fijo;
  return `<p class="ayuda">Últimos 12 meses (desde ${fecha(desde)}). El coste fijo es la cuota o amortización más los seguros, ITV… prorrateados; las facturas de seguro, ITV y leasing no se suman otra vez.</p>
  <div class="kpis">
    <div class="kpi"><div class="t">Coste fijo / mes</div><div class="n">${eur(v.coste_fijo_mes)}</div><div class="t">${eur(fijo)} en ${meses} ${meses === 1 ? 'mes' : 'meses'} con actividad</div></div>
    <div class="kpi"><div class="t">Gasto variable 12 meses</div><div class="n">${eur(variable)}</div><div class="t">gasoil, peajes, taller, neumáticos…</div></div>
    <div class="kpi"><div class="t">Coste por km</div><div class="n">${km ? eur(total / km) : '—'}</div><div class="t">${km ? num(km, 0) + ' km ' + (kmLect ? '(según repostajes)' : '(según viajes)') : 'Pon los km al registrar el gasoil'}</div></div>
    <div class="kpi"><div class="t">Consumo</div><div class="n">${km && litros ? num(litros / km * 100, 1) + ' l' : '—'}</div><div class="t">litros / 100 km</div></div>
    <div class="kpi"><div class="t">Resultado (${meses} ${meses === 1 ? 'mes' : 'meses'})</div><div class="n" style="color:${ingreso - total < 0 ? 'var(--rojo)' : 'var(--verde)'}">${eur(ingreso - total)}</div><div class="t">ingresos ${eur(ingreso)} − costes ${eur(total)}</div></div>
  </div>
  <div class="tabla-wrap"><table><tr><th>Categoría</th><th class="num">Importe (base)</th></tr>
    ${Object.entries(porCat).sort((a, b) => b[1] - a[1]).map(([k, x]) => `<tr><td>${CATEGORIAS[k] || k}${FIJOS.includes(k) ? ' <small>(ya incluido en el coste fijo)</small>' : ''}</td><td class="num">${eur(x)}</td></tr>`).join('')}
  </table>${gastos.length ? '' : '<div class="vacio">No hay gastos asignados a este camión en los últimos 12 meses.</div>'}</div>
  <div class="acciones"><button class="sec" onclick="cerrarModal();pFlota()">Cerrar</button></div>`;
}

/* Vencimientos (vehículos y documentos de conductores): tabla, editar, renovar */
function tablaVencimientos(lista, tipos, tabla, recargar) {
  if (!lista.length) return '<p class="ayuda">Sin vencimientos registrados.</p>';
  const veh = tabla === 'vehiculo_vencimientos';
  const r = esc(JSON.stringify(recargar));
  return `<div class="tabla-wrap"><table><tr><th>Tipo</th>${veh ? '<th>Compañía / taller</th>' : ''}<th>Nota / nº</th><th>Vence</th>${veh ? '<th class="num">Importe</th><th class="num">Cada</th>' : ''}<th>Doc.</th><th></th></tr>
  ${lista.map((x) => `<tr style="${x.renovado ? 'opacity:.5' : ''}"><td>${esc(tipos[x.tipo] || x.tipo)}</td>${veh ? `<td>${esc(x.proveedor)}</td>` : ''}<td>${esc(x.descripcion ?? x.numero ?? '')}</td>
    <td>${x.renovado ? fecha(x.fecha_vencimiento) + ' ' + et('gris', 'Renovado') : x.fecha_vencimiento ? estadoFecha(x.fecha_vencimiento) : et('gris', 'No caduca')}</td>
    ${veh ? `<td class="num">${x.importe != null ? eur(x.importe) : ''}</td><td class="num">${x.periodicidad_meses ? x.periodicidad_meses + ' meses' : ''}</td>` : ''}
    <td>${enlaceArchivo(x.archivo_url)}</td>
    <td style="white-space:nowrap"><button class="sec peq" onclick="editarVencimiento('${tabla}','${x.id}', ${r})">Editar</button>
      ${x.renovado ? '' : `<button class="peq" onclick="renovar('${tabla}','${x.id}', ${r})">Renovar</button>`}
      <button class="sec peq" onclick="borrarFila('${tabla}','${x.id}', ${r})">Quitar</button></td></tr>`).join('')}
  </table></div>`;
}
// Formulario para crear, editar o renovar un vencimiento. modo: 'nuevo' | 'editar' | 'renovar'
async function editarVencimiento(tabla, id, recargar, padreId, modo) {
  const veh = tabla === 'vehiculo_vencimientos';
  const tipos = veh ? TIPOS_VENC : TIPOS_DOC;
  modo = modo || (id ? 'editar' : 'nuevo');
  let x = id ? await q(db().from(tabla).select('*').eq('id', id).single()) : { tipo: veh ? 'seguro' : 'carne', periodicidad_meses: 12 };
  if (modo === 'renovar') x = { ...x, fecha_vencimiento: x.fecha_vencimiento ? sumarMeses(x.fecha_vencimiento, x.periodicidad_meses || PERIODO_VENC[x.tipo] || 12) : '', archivo_url: null };
  editarVencimiento.ctx = { tabla, id, recargar, padreId: padreId || (veh ? x.vehiculo_id : x.conductor_id), modo };
  const titulo = { nuevo: 'Nuevo vencimiento', editar: 'Editar ' + (tipos[x.tipo] || ''), renovar: 'Renovar ' + (tipos[x.tipo] || '') }[modo];
  modal(`<h1>${esc(titulo)}</h1>
  ${modo === 'renovar' ? '<p class="ayuda">Se crea el nuevo con estos datos (revisa fecha e importe) y el anterior queda como «Renovado» en el historial.</p>' : ''}
  <div class="rejilla">
    <div><label>Tipo</label><select id="vx-tipo" ${modo === 'renovar' ? 'disabled' : ''} onchange="periodoPorTipo()">${Object.entries(tipos).map(([k, t]) => `<option value="${k}" ${x.tipo === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    ${veh ? `<div><label>Compañía / taller / organismo</label><input id="vx-proveedor" value="${esc(x.proveedor)}" placeholder="Mapfre, ITV Getafe…"></div>
      <div><label>${'Nº póliza / nota'}</label><input id="vx-desc" value="${esc(x.descripcion)}"></div>`
    : `<div><label>Número</label><input id="vx-numero" value="${esc(x.numero)}"></div>`}
    <div><label>Vence el</label><input type="date" id="vx-fecha" value="${x.fecha_vencimiento || ''}"></div>
    ${veh ? `<div><label>Importe €</label><input id="vx-importe" inputmode="decimal" value="${numCampo(x.importe)}"></div>
      <div><label>Se repite cada (meses)</label><input type="number" id="vx-periodo" value="${x.periodicidad_meses ?? ''}"></div>` : ''}
    ${campoArchivo('vx-archivo', modo === 'editar' ? x.archivo_url : null)}
  </div>
  <div class="acciones"><button class="sec" onclick="${esc(recargar)}">Cancelar</button><button id="b-venc" onclick="guardarVencimiento()">${modo === 'renovar' ? 'Renovar' : 'Guardar'}</button></div>`);
}
function periodoPorTipo() { const p = $('#vx-periodo'); if (p && editarVencimiento.ctx.modo === 'nuevo') p.value = PERIODO_VENC[val('vx-tipo')] || 12; }
async function guardarVencimiento() {
  const { tabla, id, recargar, padreId, modo } = editarVencimiento.ctx;
  const veh = tabla === 'vehiculo_vencimientos';
  if (veh && !val('vx-fecha')) return aviso('Pon la fecha de vencimiento', true);
  const reg = { tipo: val('vx-tipo'), fecha_vencimiento: val('vx-fecha') };
  if (veh) {
    const imp = leerNum($('#vx-importe').value);
    if (Number.isNaN(imp)) return aviso('Importe no válido', true);
    Object.assign(reg, { proveedor: val('vx-proveedor'), descripcion: val('vx-desc'), importe: imp, periodicidad_meses: val('vx-periodo') ? Number(val('vx-periodo')) : null });
  } else reg.numero = val('vx-numero');
  $('#b-venc').disabled = true;
  try {
    const archivo = await subirArchivo('vx-archivo', (veh ? 'flota/' : 'conductores/') + padreId);
    if (archivo) reg.archivo_url = archivo;
    if (modo === 'editar') await q(db().from(tabla).update(reg).eq('id', id));
    else {
      reg[veh ? 'vehiculo_id' : 'conductor_id'] = padreId;
      await q(db().from(tabla).insert(reg));
      if (modo === 'renovar') await q(db().from(tabla).update({ renovado: true }).eq('id', id));
    }
    aviso(modo === 'renovar' ? 'Renovado hasta ' + fecha(reg.fecha_vencimiento) : 'Guardado'); eval(recargar);
  } catch { const b = $('#b-venc'); if (b) b.disabled = false; }
}
function renovar(tabla, id, recargar) { editarVencimiento(tabla, id, recargar, null, 'renovar'); }
async function borrarFila(tabla, id, recargar) {
  if (!confirm('¿Quitar este registro?')) return;
  await q(db().from(tabla).delete().eq('id', id)); eval(recargar);
}
/* ---------------------------------------------------------------- PERSONAL (RRHH) */
const TIPOS_DOC = { carne: 'Carné de conducir', cap: 'CAP', tarjeta_tacografo: 'Tarjeta tacógrafo', reconocimiento_medico: 'Reconocimiento médico', adr: 'ADR',
  contrato: 'Contrato de trabajo', formacion_prl: 'Formación PRL', entrega_epis: 'Entrega de EPIs / ropa', formacion: 'Otra formación', otro: 'Otro' };
const PUESTOS = { conductor: 'Conductor', mozo_almacen: 'Mozo de almacén', mecanico: 'Mecánico', trafico: 'Tráfico', administracion: 'Administración', otro: 'Otro' };
const CONTRATOS = { '': '—', indefinido: 'Indefinido', temporal: 'Temporal', fijo_discontinuo: 'Fijo discontinuo', practicas: 'Prácticas', otro: 'Otro' };
const TIPOS_CONCEPTO = [['plus', '+ Plus'], ['extra', '+ Extra'], ['bonus', '+ Bonus / incentivo'], ['kilometraje', '+ Kilometraje'], ['otro_suma', '+ Otro (suma)'],
  ['descuento', '− Descuento'], ['multa', '− Multa'], ['danos', '− Daños / desperfectos'], ['otro_resta', '− Otro (resta)']];
const CONCEPTO_RESTA = ['descuento', 'multa', 'danos', 'otro_resta'];
// Movimientos del mes de cada empleado: [campo, etiqueta, tipo]; tipo puede ser lista de opciones [valor, texto]
const SUBCOND = {
  combustible_conductor: { titulo: 'Gasolina', ayuda: 'Gasolina que echa en el taller. Se descuenta de la nómina del mes que elijas en «Se descuenta en».',
    campos: [['fecha', 'Fecha', 'date'], ['lugar', 'Dónde'], ['vehiculo', 'Vehículo / matrícula'], ['litros', 'Litros', 'number'], ['importe', 'Importe €', 'number'], ['mes_nomina', 'Se descuenta en', 'month'], ['notas', 'Notas']],
    filtro: 'mes_nomina', orden: 'fecha', total: 'importe' },
  anticipos: { titulo: 'Anticipos', campos: [['fecha', 'Fecha', 'date'], ['importe', 'Importe €', 'number'], ['mes_nomina', 'Se descuenta en', 'month'], ['concepto', 'Concepto']], filtro: 'mes_nomina', orden: 'fecha', total: 'importe' },
  nomina_conceptos: { titulo: 'Extras y descuentos', ayuda: 'Lo que se suma (plus, extra, bonus…) o se resta (multas, daños…) en la nómina de ese mes.',
    campos: [['tipo', 'Tipo', TIPOS_CONCEPTO], ['concepto', 'Concepto'], ['importe', 'Importe €', 'number'], ['mes_nomina', 'Mes de nómina', 'month']], filtro: 'mes_nomina', orden: 'creado_en' },
  dietas: { titulo: 'Dietas', campos: [['fecha', 'Fecha', 'date'], ['tipo', 'Tipo', ['completa', 'desayuno', 'comida', 'cena', 'pernocta', 'otro']], ['importe', 'Importe €', 'number'], ['notas', 'Notas']], filtro: 'fecha', total: 'importe' },
  horas_extra: { titulo: 'Horas extra', campos: [['fecha', 'Fecha', 'date'], ['horas', 'Horas', 'number'], ['notas', 'Notas']], filtro: 'fecha', total: 'horas' },
  ausencias: { titulo: 'Vacaciones y ausencias', campos: [['tipo', 'Tipo', ['vacaciones', 'permiso', 'baja', 'asuntos_propios', 'otro']], ['desde', 'Desde', 'date'], ['hasta', 'Hasta', 'date'], ['notas', 'Notas']], filtro: 'rango' }
};
const OPCIONALES = ['notas', 'concepto', 'lugar', 'vehiculo', 'litros'];
// Campos de la ficha, por pestaña
const CAMPOS_PERS = {
  ficha: [['nombre', 'Nombre y apellidos'], ['dni', 'DNI / NIE'], ['puesto', 'Puesto', PUESTOS], ['telefono', 'Teléfono', 'tel'], ['email', 'Email', 'email'],
    ['fecha_nacimiento', 'Fecha de nacimiento', 'date'], ['direccion', 'Dirección'], ['cp', 'C.P.'], ['poblacion', 'Población'], ['provincia', 'Provincia'],
    ['nss', 'Nº Seguridad Social'], ['iban', 'IBAN (cuenta de la nómina)'], ['contacto_emergencia', 'Contacto de emergencia'], ['telefono_emergencia', 'Teléfono de emergencia', 'tel'],
    ['talla_ropa', 'Talla de ropa'], ['talla_calzado', 'Talla de calzado']],
  contrato: [['fecha_alta', 'Fecha de alta', 'date'], ['tipo_contrato', 'Tipo de contrato', CONTRATOS], ['fin_contrato', 'Fin de contrato (si es temporal)', 'date'],
    ['jornada', 'Jornada', { '': '—', completa: 'Completa', parcial: 'Parcial' }], ['horas_semana', 'Horas a la semana', 'number'], ['categoria', 'Categoría profesional'], ['convenio', 'Convenio'],
    ['salario_bruto_anual', 'Salario bruto anual €', 'money'], ['num_pagas', 'Nº de pagas', 'number'], ['neto_mensual', 'Nómina neta mensual habitual €', 'money'],
    ['precio_hora_extra', 'Precio hora extra €', 'money'], ['dias_vacaciones_anio', 'Días de vacaciones al año', 'number'],
    ['fecha_baja', 'Fecha de baja en la empresa', 'date'], ['activo', 'En plantilla', 'checkbox']]
};

const fCond = { ver: 'activos', mes: hoy().slice(0, 7), vista: 'plantilla' };
async function pConductores() {
  if (fCond.vista === 'nominas') return pNominasMes();
  let qy = db().from('v_conductores').select('*').order('nombre');
  if (fCond.ver === 'activos') qy = qy.eq('activo', true); else if (fCond.ver === 'inactivos') qy = qy.eq('activo', false);
  const lista = await q(qy);
  const margen = S.empresa?.dias_aviso_vencimientos ?? 30;
  const pronto = (d) => d && d <= sumarDias(hoy(), margen);
  const activos = lista.filter((c) => c.activo);
  $('#pagina').innerHTML = `
  <h1>Personal</h1>
  ${barraPersonal()}
  <div class="barra">
    <div class="campo"><label>Ver</label><select id="co-ver">${[['activos', 'En plantilla'], ['inactivos', 'De baja'], ['', 'Todos']].map(([k, t]) => `<option value="${k}" ${fCond.ver === k ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <button class="sec" onclick="sincronizarConductores()">⟳ Traer nuevos de TransControl</button>
    <button onclick="editarConductor()">+ Empleado</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="t">En plantilla</div><div class="n">${activos.length}</div><div class="t">${activos.filter((c) => c.puesto === 'conductor').length} conductores</div></div>
    <div class="kpi"><div class="t">Nóminas netas / mes</div><div class="n">${eur(activos.reduce((a, c) => a + Number(c.neto_mensual || 0), 0))}</div><div class="t">${activos.filter((c) => c.neto_mensual == null).length ? activos.filter((c) => c.neto_mensual == null).length + ' sin nómina puesta' : 'neto habitual'}</div></div>
    <div class="kpi"><div class="t">Contratos que terminan</div><div class="n" style="color:${activos.filter((c) => pronto(c.fin_contrato)).length ? 'var(--ambar)' : 'inherit'}">${activos.filter((c) => pronto(c.fin_contrato)).length}</div><div class="t">próximos ${margen} días</div></div>
    <div class="kpi"><div class="t">Documentos que caducan</div><div class="n" style="color:${activos.filter((c) => pronto(c.proximo_vencimiento)).length ? 'var(--ambar)' : 'inherit'}">${activos.filter((c) => pronto(c.proximo_vencimiento)).length}</div><div class="t">carné, CAP, tacógrafo, médico…</div></div>
  </div>
  <div class="tabla-wrap"><table>
    <tr><th>Nombre</th><th>Puesto</th><th>DNI</th><th>Teléfono</th><th>Contrato</th><th class="num">Neto / mes</th><th>Próximo vencimiento</th><th>Estado</th></tr>
    ${lista.map((c) => `<tr class="clic" onclick="editarConductor('${c.id}')"><td><b>${esc(c.nombre)}</b></td><td>${PUESTOS[c.puesto] || c.puesto}</td><td>${esc(c.dni) || et('ambar', 'Falta')}</td><td>${esc(c.telefono)}</td>
      <td>${esc(CONTRATOS[c.tipo_contrato] || c.tipo_contrato || '')}${c.fin_contrato ? ' · ' + estadoFecha(c.fin_contrato) : ''}</td>
      <td class="num">${c.neto_mensual != null ? eur(c.neto_mensual) : et('gris', 'Sin poner')}</td>
      <td>${c.proximo_vencimiento ? (TIPOS_DOC[c.proximo_tipo] || '') + ' · ' + estadoFecha(c.proximo_vencimiento) : (c.num_documentos ? '' : et('ambar', 'Sin documentos'))}</td>
      <td>${c.activo ? et('verde', 'Activo') : et('gris', 'Baja')}</td></tr>`).join('')}
  </table>${lista.length ? '' : '<div class="vacio">No hay empleados.</div>'}</div>`;
  $('#co-ver').onchange = (e) => { fCond.ver = e.target.value; pConductores(); };
}
function barraPersonal() {
  return `<div class="barra">${[['plantilla', 'Plantilla'], ['nominas', 'Nóminas del mes']].map(([k, t]) =>
    `<button class="${fCond.vista === k ? '' : 'sec'}" onclick="fCond.vista='${k}';pConductores()">${t}</button>`).join('')}</div>`;
}
async function sincronizarConductores() {
  await q(db().rpc('sincronizar_conductores'));
  await recargarMaestros(); aviso('Conductores actualizados desde TransControl'); pConductores();
}

/* Nóminas del mes: liquidación de toda la plantilla */
async function pNominasMes() {
  const ini = fCond.mes + '-01';
  const lista = await q(db().rpc('liquidacion_mes', { p_mes: ini }));
  pNominasMes.lista = lista;
  const s = (k) => lista.reduce((a, x) => a + Number(x[k] || 0), 0);
  const pagadas = lista.filter((x) => x.pagado).length;
  $('#pagina').innerHTML = `
  <h1>Personal</h1>
  ${barraPersonal()}
  <div class="barra">
    <div class="campo"><label>Mes</label><input type="month" id="nm-mes" value="${fCond.mes}"></div>
    <button class="sec" onclick="excelNominas()">⬇ Excel</button>
  </div>
  <div class="kpis">
    <div class="kpi"><div class="t">Total a pagar ${mesTexto(fCond.mes)}</div><div class="n">${eur(s('total'))}</div><div class="t">${lista.length} empleados</div></div>
    <div class="kpi"><div class="t">Descuentos</div><div class="n">${eur(s('anticipos') + s('combustible') + s('descuentos'))}</div><div class="t">anticipos ${eur(s('anticipos'))} · gasolina ${eur(s('combustible'))}</div></div>
    <div class="kpi"><div class="t">Extras y dietas</div><div class="n">${eur(s('extras') + s('dietas') + s('horas_extra_importe'))}</div><div class="t">horas extra ${num(s('horas_extra'))} h</div></div>
    <div class="kpi"><div class="t">Pagadas</div><div class="n">${pagadas} / ${lista.length}</div></div>
  </div>
  <p class="ayuda">Neto de nómina + dietas + horas extra + extras − anticipos − gasolina − descuentos. Pulsa un empleado para ver su ficha del mes, cambiar el neto de ese mes o marcarla como pagada.</p>
  <div class="tabla-wrap"><table>
    <tr><th>Empleado</th><th class="num">Neto nómina</th><th class="num">+ Dietas</th><th class="num">+ H. extra</th><th class="num">+ Extras</th><th class="num">− Anticipos</th><th class="num">− Gasolina</th><th class="num">− Descuentos</th><th class="num">A pagar</th><th>Estado</th></tr>
    ${lista.map((x) => `<tr class="clic" onclick="editarConductor('${x.conductor_id}','mes')"><td><b>${esc(x.nombre)}</b><br><small>${PUESTOS[x.puesto] || ''}${x.viajes ? ' · ' + x.viajes + ' viajes' : ''}</small></td>
      <td class="num">${Number(x.neto_base) ? eur(x.neto_base) : et('ambar', 'Sin nómina')}${x.neto_ajustado ? '<br><small>ajustado este mes</small>' : ''}</td>
      <td class="num">${cero(x.dietas)}</td><td class="num">${cero(x.horas_extra_importe)}${Number(x.horas_extra) ? '<br><small>' + num(x.horas_extra) + ' h</small>' : ''}</td><td class="num">${cero(x.extras)}</td>
      <td class="num">${cero(x.anticipos)}</td><td class="num">${cero(x.combustible)}</td><td class="num">${cero(x.descuentos)}</td>
      <td class="num"><b>${eur(x.total)}</b></td>
      <td>${x.pagado ? et('verde', 'Pagada ' + fecha(x.fecha_pago)) + (Number(x.total_pagado) !== Number(x.total) ? '<br>' + et('rojo', 'Ha cambiado: se pagó ' + eur(x.total_pagado)) : '') : et('ambar', 'Pendiente')}${x.ausencias ? '<br><small>' + esc(x.ausencias) + '</small>' : ''}</td></tr>`).join('')}
    ${lista.length ? `<tr class="totales-fila"><td><b>Total</b></td>${['neto_base', 'dietas', 'horas_extra_importe', 'extras', 'anticipos', 'combustible', 'descuentos', 'total'].map((k) => `<td class="num"><b>${eur(s(k))}</b></td>`).join('')}<td></td></tr>` : ''}
  </table>${lista.length ? '' : '<div class="vacio">No hay empleados en plantilla este mes.</div>'}</div>`;
  $('#nm-mes').onchange = (e) => { fCond.mes = e.target.value; pNominasMes(); };
}
const cero = (n) => (Number(n) ? eur(n) : '<span style="color:var(--gris)">—</span>');
async function excelNominas() {
  await cargarScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js');
  const n2 = (x) => Math.round(Number(x || 0) * 100) / 100;
  const ws = XLSX.utils.json_to_sheet(pNominasMes.lista.map((x) => ({ Empleado: x.nombre, DNI: x.dni || '', Puesto: PUESTOS[x.puesto] || '', Viajes: x.viajes, 'Neto nómina': n2(x.neto_base),
    Dietas: n2(x.dietas), 'Horas extra (h)': n2(x.horas_extra), 'Horas extra €': n2(x.horas_extra_importe), Extras: n2(x.extras), Anticipos: n2(x.anticipos), Gasolina: n2(x.combustible),
    Descuentos: n2(x.descuentos), 'A pagar': n2(x.total), Ausencias: x.ausencias || '', Pagada: x.pagado ? 'Sí ' + fecha(x.fecha_pago) : 'No' })));
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Nóminas'); XLSX.writeFile(wb, `nominas_${fCond.mes}.xlsx`);
}

/* Ficha del empleado */
function campoPers(c, [k, t, tipo = 'text']) {
  const id = 'cd-' + k;
  if (tipo === 'checkbox') return `<div><label>${t}</label><input type="checkbox" id="${id}" style="width:auto" ${c[k] ? 'checked' : ''}></div>`;
  if (typeof tipo === 'object') return `<div><label>${t}</label><select id="${id}">${Object.entries(tipo).map(([o, x]) => `<option value="${o}" ${String(c[k] ?? '') === o ? 'selected' : ''}>${x}</option>`).join('')}</select></div>`;
  if (tipo === 'money') return `<div><label>${t}</label><input id="${id}" inputmode="decimal" value="${numCampo(c[k])}"></div>`;
  return `<div><label>${t}</label><input id="${id}" type="${tipo}" value="${esc(c[k])}"></div>`;
}
async function editarConductor(id, pestana = 'ficha') {
  if (id === 'undefined' || id === 'null') id = null;
  const c = id ? await q(db().from('conductores').select('*').eq('id', id).single()) : { activo: true, puesto: 'conductor', num_pagas: 14, dias_vacaciones_anio: 30 };
  const tabs = [['ficha', 'Datos personales'], ['contrato', 'Contrato y salario'], ['mes', 'Ficha del mes'], ...Object.entries(SUBCOND).map(([k, x]) => [k, x.titulo]), ['documentos', 'Documentos']];
  let cuerpo = '';
  if (pestana === 'ficha' || pestana === 'contrato') {
    cuerpo = `<div class="rejilla">${CAMPOS_PERS[pestana].map((x) => campoPers(c, x)).join('')}</div>
      ${pestana === 'ficha' ? `${c.tc_conductor_id ? '<p class="ayuda">Vinculado a TransControl: el nombre se actualiza desde allí.</p>' : ''}<label>Notas</label><textarea id="cd-notas">${esc(c.notas)}</textarea>` : ''}
      ${pestana === 'contrato' ? `<p class="ayuda" style="margin-top:12px">La <b>nómina neta habitual</b> es la que se usa cada mes en la Ficha del mes; si un mes la gestoría da otro neto, se cambia solo para ese mes desde allí.
        ${c.salario_bruto_anual ? `Bruto mensual: <b>${eur(c.salario_bruto_anual / (c.num_pagas || 12))}</b> (${c.num_pagas || 12} pagas).` : ''}</p>` : ''}
      <div class="acciones"><button class="sec" onclick="cerrarModal();pConductores()">Cerrar</button><button onclick="guardarConductor(${id ? `'${id}'` : 'null'},'${pestana}')">Guardar</button></div>`;
  } else if (pestana === 'mes') {
    cuerpo = await fichaMes(c);
  } else if (pestana === 'documentos') {
    const docs = await q(db().from('conductor_documentos').select('*').eq('conductor_id', id).order('renovado').order('fecha_vencimiento'));
    cuerpo = `<p class="ayuda">Carné, CAP, tacógrafo, reconocimiento médico, contrato, formación de PRL, entrega de EPIs… Si un documento no caduca, deja la fecha vacía.</p>
    ${tablaVencimientos(docs, TIPOS_DOC, 'conductor_documentos', `editarConductor('${id}','documentos')`)}
    <div class="barra" style="margin-top:12px">
      <div class="campo"><label>Documento</label><select id="dc-tipo">${Object.entries(TIPOS_DOC).map(([k, t]) => `<option value="${k}">${t}</option>`).join('')}</select></div>
      <div class="campo"><label>Número</label><input id="dc-numero"></div>
      <div class="campo"><label>Caduca el</label><input type="date" id="dc-fecha"></div>
      ${campoArchivo('dc-archivo')}
      <button onclick="anadirDocumento('${id}')">Añadir</button></div>`;
  } else {
    cuerpo = await subtablaConductor(id, pestana);
  }
  modal(`<h1>${id ? esc(c.nombre) + ' <small style="font-weight:400;color:var(--gris)">' + (PUESTOS[c.puesto] || '') + '</small>' : 'Nuevo empleado'}</h1>
  ${id ? `<div class="barra">${tabs.map(([k, t]) => `<button class="${k === pestana ? '' : 'sec'} peq" onclick="editarConductor('${id}','${k}')">${t}</button>`).join('')}</div>`
    : '<p class="ayuda">Guarda los datos y después podrás rellenar el contrato, la nómina, la gasolina, los anticipos…</p>'}
  ${cuerpo}`);
}
async function guardarConductor(id, pestana = 'ficha') {
  const reg = {};
  for (const [k, t, tipo] of CAMPOS_PERS[pestana]) {
    const e = document.getElementById('cd-' + k); if (!e) continue;
    if (tipo === 'checkbox') reg[k] = e.checked;
    else if (tipo === 'money') { const n = leerNum(e.value); if (Number.isNaN(n)) return aviso(`${t}: importe no válido`, true); reg[k] = n; }
    else reg[k] = val('cd-' + k);
  }
  if (pestana === 'ficha') {
    reg.notas = val('cd-notas');
    if (!reg.nombre) return aviso('El nombre es obligatorio', true);
    if (reg.dni) reg.dni = reg.dni.toUpperCase().replace(/[\s-]/g, '');
    if (reg.iban) reg.iban = reg.iban.toUpperCase().replace(/\s+/g, '');
  }
  if (id) await q(db().from('conductores').update(reg).eq('id', id));
  else id = (await q(db().from('conductores').insert(reg).select('id').single())).id;
  await recargarMaestros(); aviso('Guardado'); editarConductor(id, pestana);
}
async function anadirDocumento(condId) {
  const archivo = await subirArchivo('dc-archivo', 'conductores/' + condId);
  await q(db().from('conductor_documentos').insert({ conductor_id: condId, tipo: val('dc-tipo'), numero: val('dc-numero'), fecha_vencimiento: val('dc-fecha'), archivo_url: archivo }));
  aviso('Documento añadido'); editarConductor(condId, 'documentos');
}

/* Ficha del mes: liquidación, movimientos, vacaciones y avisos de una persona */
async function fichaMes(c) {
  const ini = fCond.mes + '-01'; const fin = finMes(ini); const anio = fCond.mes.slice(0, 4);
  const [liq, comb, anti, conc, diet, horas, aus, docs] = await Promise.all([
    q(db().rpc('liquidacion_mes', { p_mes: ini, p_conductor: c.id })),
    q(db().from('combustible_conductor').select('*').eq('conductor_id', c.id).eq('mes_nomina', ini).order('fecha')),
    q(db().from('anticipos').select('*').eq('conductor_id', c.id).eq('mes_nomina', ini).order('fecha')),
    q(db().from('nomina_conceptos').select('*').eq('conductor_id', c.id).eq('mes_nomina', ini).order('creado_en')),
    q(db().from('dietas').select('*').eq('conductor_id', c.id).gte('fecha', ini).lte('fecha', fin).order('fecha')),
    q(db().from('horas_extra').select('*').eq('conductor_id', c.id).gte('fecha', ini).lte('fecha', fin).order('fecha')),
    q(db().from('ausencias').select('*').eq('conductor_id', c.id).lte('desde', anio + '-12-31').gte('hasta', anio + '-01-01').order('desde')),
    q(db().from('conductor_documentos').select('*').eq('conductor_id', c.id).eq('renovado', false).not('fecha_vencimiento', 'is', null).order('fecha_vencimiento'))
  ]);
  const L = liq[0] || { neto_base: c.neto_mensual || 0, total: 0 };
  fichaMes.datos = { c, L, comb, anti, conc, diet, horas, aus };
  // Vacaciones del año: días naturales de «vacaciones» dentro del año
  const dias = (a) => { const d1 = a.desde < anio + '-01-01' ? anio + '-01-01' : a.desde; const d2 = a.hasta > anio + '-12-31' ? anio + '-12-31' : a.hasta; return Math.round((new Date(d2) - new Date(d1)) / 86400000) + 1; };
  const vacUsadas = aus.filter((a) => a.tipo === 'vacaciones').reduce((s, a) => s + dias(a), 0);
  const ausMes = aus.filter((a) => a.desde <= fin && a.hasta >= ini);
  const margen = S.empresa?.dias_aviso_vencimientos ?? 30;
  const avisos = [
    ...docs.filter((d) => d.fecha_vencimiento <= sumarDias(hoy(), margen)).map((d) => `${TIPOS_DOC[d.tipo] || d.tipo} · ${estadoFecha(d.fecha_vencimiento)}`),
    ...(c.fin_contrato && c.fin_contrato <= sumarDias(hoy(), Math.max(margen, 30)) ? [`Fin de contrato · ${estadoFecha(c.fin_contrato)}`] : []),
    ...(!c.neto_mensual ? [et('ambar', 'No tiene puesta la nómina neta habitual (pestaña Contrato y salario)')] : [])
  ];
  const linea = (signo, txt, imp, det = '') => `<tr><td>${signo} ${txt}${det ? '<br><small>' + det + '</small>' : ''}</td><td class="num">${signo === '−' && Number(imp) ? '−' : ''}${eur(imp)}</td></tr>`;
  const lista = (arr, f) => arr.map(f).join(' · ');
  return `<div class="barra"><div class="campo"><label>Mes</label><input type="month" value="${fCond.mes}" onchange="fCond.mes=this.value;editarConductor('${c.id}','mes')"></div>
    <button class="sec" onclick="imprimirFichaMes()">🖨 Imprimir ficha del mes</button></div>
  ${avisos.length ? `<div class="alerta ambar" style="display:block">${avisos.join('<br>')}</div>` : ''}
  <div class="kpis">
    <div class="kpi"><div class="t">A pagar ${mesTexto(fCond.mes)}</div><div class="n">${eur(L.total)}</div><div class="t">${L.pagado ? 'Pagada el ' + fecha(L.fecha_pago) : 'Pendiente de pago'}</div></div>
    <div class="kpi"><div class="t">Viajes del mes</div><div class="n">${L.viajes ?? 0}</div><div class="t">${ausMes.length ? 'Ausencias: ' + esc(L.ausencias || '') : 'Sin ausencias'}</div></div>
    <div class="kpi"><div class="t">Vacaciones ${anio}</div><div class="n">${(c.dias_vacaciones_anio ?? 30) - vacUsadas} días</div><div class="t">le quedan · ha disfrutado ${vacUsadas} de ${c.dias_vacaciones_anio ?? 30}</div></div>
  </div>
  <div class="tabla-wrap"><table>
    <tr><td>Nómina neta del mes<br><small>${L.neto_ajustado ? 'Ajustada para este mes' : 'Neto habitual'} · cámbiala si la gestoría da otro importe</small></td>
      <td class="num"><input id="fm-neto" inputmode="decimal" style="width:120px;text-align:right" value="${numCampo(L.neto_base)}" onchange="guardarNetoMes('${c.id}')"></td></tr>
    ${linea('+', 'Dietas', L.dietas, lista(diet, (d) => fecha(d.fecha).slice(0, 5) + ' ' + d.tipo + ' ' + eur(d.importe)))}
    ${linea('+', 'Horas extra', L.horas_extra_importe, Number(L.horas_extra) ? num(L.horas_extra) + ' h × ' + eur(c.precio_hora_extra || 0) + (c.precio_hora_extra ? '' : ' (pon el precio de la hora extra en Contrato y salario)') : '')}
    ${linea('+', 'Extras, pluses, bonus', L.extras, lista(conc.filter((x) => !CONCEPTO_RESTA.includes(x.tipo)), (x) => esc(x.concepto || x.tipo) + ' ' + eur(x.importe)))}
    ${linea('−', 'Anticipos', L.anticipos, lista(anti, (a) => fecha(a.fecha).slice(0, 5) + ' ' + eur(a.importe)))}
    ${linea('−', 'Gasolina del taller', L.combustible, lista(comb, (g) => fecha(g.fecha).slice(0, 5) + ' ' + (g.litros ? num(g.litros) + ' l ' : '') + eur(g.importe)))}
    ${linea('−', 'Otros descuentos (multas, daños…)', L.descuentos, lista(conc.filter((x) => CONCEPTO_RESTA.includes(x.tipo)), (x) => esc(x.concepto || x.tipo) + ' ' + eur(x.importe)))}
    <tr class="totales-fila"><td><b>Total a pagar</b></td><td class="num" style="font-size:18px"><b>${eur(L.total)}</b></td></tr>
  </table></div>
  ${L.pagado && Number(L.total_pagado) !== Number(L.total) ? `<div class="alerta rojo" style="margin-top:8px">Se marcó como pagada con ${eur(L.total_pagado)} y ahora sale ${eur(L.total)}: algo ha cambiado después del pago.</div>` : ''}
  <p class="ayuda">Para añadir gasolina, anticipos, extras, dietas u horas usa sus pestañas de arriba (en el mismo mes).</p>
  <div class="acciones">
    ${L.pagado ? `<button class="sec" onclick="marcarNomina('${c.id}', false)">Desmarcar pago</button>` : ''}
    <button class="sec" onclick="cerrarModal();pConductores()">Cerrar</button>
    <button onclick="marcarNomina('${c.id}', true)">${L.pagado ? 'Volver a marcar pagada (' + eur(L.total) + ')' : 'Marcar como pagada'}</button>
  </div>`;
}
async function guardarNetoMes(cid) {
  const n = leerNum($('#fm-neto').value);
  if (Number.isNaN(n)) return aviso('Importe no válido', true);
  const neto = n === Number(fichaMes.datos.c.neto_mensual) ? null : n; // si es igual al habitual no se guarda ajuste
  await q(db().from('nominas').upsert({ conductor_id: cid, mes: fCond.mes + '-01', neto_base: neto }, { onConflict: 'conductor_id,mes' }));
  aviso('Neto del mes guardado'); editarConductor(cid, 'mes');
}
async function marcarNomina(cid, pagado) {
  const L = fichaMes.datos.L;
  const reg = { conductor_id: cid, mes: fCond.mes + '-01', pagado, fecha_pago: pagado ? hoy() : null, total_pagado: pagado ? L.total : null };
  await q(db().from('nominas').upsert(reg, { onConflict: 'conductor_id,mes' }));
  aviso(pagado ? 'Nómina marcada como pagada' : 'Pago desmarcado'); editarConductor(cid, 'mes');
}
function imprimirFichaMes() {
  const { c, L, comb, anti, conc, diet, horas } = fichaMes.datos; const e = S.empresa || {};
  const fila = (t, x, neg) => `<tr><td>${t}</td><td class="n">${neg && Number(x) ? '−' : ''}${eur(x)}</td></tr>`;
  const det = (titulo, filas, cols) => filas.length ? `<h3>${titulo}</h3><table><tr>${cols.map((k) => `<th${k[2] ? ' class="n"' : ''}>${k[0]}</th>`).join('')}</tr>${filas.map((r) => `<tr>${cols.map((k) => `<td${k[2] ? ' class="n"' : ''}>${k[1](r)}</td>`).join('')}</tr>`).join('')}</table>` : '';
  const w = window.open('', '_blank');
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Ficha ${esc(c.nombre)} ${fCond.mes}</title>
  <style>body{font-family:Arial,sans-serif;font-size:12px;color:#222;margin:30px}h1{color:#1f4e79;font-size:20px;margin:0}h3{margin:18px 0 6px;color:#1f4e79}
  table{width:100%;border-collapse:collapse}th{background:#1f4e79;color:#fff;padding:5px;text-align:left;font-size:11px}td{padding:4px 6px;border-bottom:1px solid #ddd}.n{text-align:right;white-space:nowrap}
  .tot td{font-weight:bold;font-size:14px;border-top:2px solid #222}.cab{display:flex;justify-content:space-between}@media print{.np{display:none}}</style></head><body>
  <p class="np"><button onclick="print()">Imprimir / Guardar PDF</button></p>
  <div class="cab"><div><h1>Ficha mensual · ${esc(mesTexto(fCond.mes))}</h1>${esc(e.razon_social || '')}</div>
  <div style="text-align:right"><b>${esc(c.nombre)}</b><br>DNI: ${esc(c.dni || '—')} · ${PUESTOS[c.puesto] || ''}<br>Viajes: ${L.viajes ?? 0}${L.ausencias ? '<br>Ausencias: ' + esc(L.ausencias) : ''}</div></div>
  <h3>Resumen</h3><table>${fila('Nómina neta', L.neto_base)}${fila('+ Dietas', L.dietas)}${fila('+ Horas extra (' + num(L.horas_extra) + ' h)', L.horas_extra_importe)}${fila('+ Extras, pluses, bonus', L.extras)}
  ${fila('− Anticipos', L.anticipos, 1)}${fila('− Gasolina del taller', L.combustible, 1)}${fila('− Otros descuentos', L.descuentos, 1)}<tr class="tot"><td>TOTAL A PAGAR</td><td class="n">${eur(L.total)}</td></tr></table>
  ${det('Gasolina', comb, [['Fecha', (r) => fecha(r.fecha)], ['Dónde', (r) => esc(r.lugar || '')], ['Vehículo', (r) => esc(r.vehiculo || '')], ['Litros', (r) => (r.litros ? num(r.litros) : ''), 1], ['Importe', (r) => eur(r.importe), 1]])}
  ${det('Anticipos', anti, [['Fecha', (r) => fecha(r.fecha)], ['Concepto', (r) => esc(r.concepto || '')], ['Importe', (r) => eur(r.importe), 1]])}
  ${det('Extras y descuentos', conc, [['Tipo', (r) => (TIPOS_CONCEPTO.find((t) => t[0] === r.tipo) || [, r.tipo])[1]], ['Concepto', (r) => esc(r.concepto || '')], ['Importe', (r) => eur(r.importe), 1]])}
  ${det('Dietas', diet, [['Fecha', (r) => fecha(r.fecha)], ['Tipo', (r) => esc(r.tipo)], ['Importe', (r) => eur(r.importe), 1]])}
  ${det('Horas extra', horas, [['Fecha', (r) => fecha(r.fecha)], ['Horas', (r) => num(r.horas), 1], ['Notas', (r) => esc(r.notas || '')]])}
  <p style="margin-top:40px">Firma del trabajador: ______________________</p></body></html>`);
  w.document.close();
}

/* Pestañas de movimientos (gasolina, anticipos, extras, dietas, horas, ausencias) */
async function subtablaConductor(id, tabla) {
  const cfg = SUBCOND[tabla]; const ini = fCond.mes + '-01'; const fin = finMes(ini);
  let qy = db().from(tabla).select('*').eq('conductor_id', id);
  if (cfg.filtro === 'rango') qy = qy.lte('desde', fin).gte('hasta', ini).order('desde');
  else if (cfg.filtro === 'mes_nomina') qy = qy.eq('mes_nomina', ini).order(cfg.orden || 'fecha');
  else qy = qy.gte(cfg.filtro, ini).lte(cfg.filtro, fin).order(cfg.filtro);
  const filas = await q(qy);
  const ops = (c) => c[2].map((o) => (Array.isArray(o) ? o : [o, o.replace('_', ' ')]));
  const mostrar = (c, x) => (Array.isArray(c[2]) ? esc((ops(c).find((o) => o[0] === x[c[0]]) || [, x[c[0]]])[1]) : c[2] === 'date' ? fecha(x[c[0]]) : c[2] === 'month' ? (x[c[0]] ? mesTexto(x[c[0]].slice(0, 7)) : '')
    : c[0] === 'importe' ? eur(x[c[0]]) : c[2] === 'number' ? num(x[c[0]]) : esc(x[c[0]]));
  const defecto = (c) => (c[2] === 'month' ? fCond.mes : c[2] === 'date' && c[0] !== 'hasta' ? (hoy().startsWith(fCond.mes) ? hoy() : ini) : c[0] === 'lugar' ? 'Taller' : '');
  const entrada = (c) => Array.isArray(c[2])
    ? `<select id="sc-${c[0]}">${ops(c).map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select>`
    : `<input id="sc-${c[0]}" type="${c[2] || 'text'}" ${c[2] === 'number' ? 'step="0.01"' : ''} value="${defecto(c)}">`;
  let total = cfg.total ? filas.reduce((a, x) => a + Number(x[cfg.total] || 0), 0) : null;
  let txtTotal = total != null ? (cfg.total === 'importe' ? eur(total) : num(total) + ' h') : '';
  if (tabla === 'nomina_conceptos') {
    const suma = filas.filter((x) => !CONCEPTO_RESTA.includes(x.tipo)).reduce((a, x) => a + Number(x.importe), 0);
    const resta = filas.filter((x) => CONCEPTO_RESTA.includes(x.tipo)).reduce((a, x) => a + Number(x.importe), 0);
    txtTotal = `suma ${eur(suma)} · resta ${eur(resta)}`;
  }
  return `${cfg.ayuda ? `<p class="ayuda">${cfg.ayuda}</p>` : ''}
  <div class="barra"><div class="campo"><label>Mes</label><input type="month" id="sc-mes" value="${fCond.mes}" onchange="fCond.mes=this.value;editarConductor('${id}','${tabla}')"></div>
    ${txtTotal ? `<p style="margin:0 0 8px">Total ${mesTexto(fCond.mes)}: <b>${txtTotal}</b></p>` : ''}</div>
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
    if (c[2] === 'number' && v != null) { v = leerNum(v); if (Number.isNaN(v)) return aviso(c[1] + ': número no válido', true); }
    reg[c[0]] = v;
  }
  const faltan = SUBCOND[tabla].campos.filter((c) => !OPCIONALES.includes(c[0]) && reg[c[0]] == null);
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
  const [lista, costes, ingresos, fijos] = await Promise.all([
    q(qy), q(db().from('v_coste_vehiculo_mes').select('*').eq('mes', ini)), q(db().from('v_ingreso_vehiculo_mes').select('*').eq('mes', ini)),
    q(db().from('v_vehiculos').select('matricula,coste_fijo_mes').is('fecha_baja', null))
  ]);
  const fijoDe = (m) => Number((fijos.find((x) => x.matricula === m) || {}).coste_fijo_mes || 0);
  const porCat = {}; lista.forEach((g) => (porCat[g.categoria] = (porCat[g.categoria] || 0) + Number(g.base)));
  const tot = (k) => lista.reduce((a, g) => a + Number(g[k] || 0), 0);
  const mats = [...new Set([...costes.map((c) => c.matricula), ...ingresos.map((c) => c.matricula), ...fijos.filter((x) => Number(x.coste_fijo_mes)).map((x) => x.matricula)])].sort();
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
  <p class="ayuda">Ingresos de los viajes con ese camión asignado − gastos variables del mes (gasoil, peajes, taller…) − coste fijo mensual (cuota o amortización + seguros, ITV… prorrateados, de la ficha de Flota). Las facturas de seguro, ITV o leasing no se restan dos veces.</p>
  <div class="tabla-wrap"><table><tr><th>Camión</th><th class="num">Viajes</th><th class="num">Ingresos</th><th class="num">Gasoil</th><th class="num">Litros</th><th class="num">Mantenimiento</th><th class="num">Gasto variable</th><th class="num">Coste fijo</th><th class="num">Resultado</th></tr>
  ${mats.map((m) => { const c = costes.find((x) => x.matricula === m) || {}; const i = ingresos.find((x) => x.matricula === m) || {}; const f = fijoDe(m);
    const r = Number(i.ingreso_estimado || 0) - Number(c.gasto_variable || 0) - f;
    return `<tr><td><b>${esc(m)}</b></td><td class="num">${i.viajes || 0}</td><td class="num">${eur(i.ingreso_estimado)}</td><td class="num">${eur(c.gasoil)}</td><td class="num">${num(c.litros, 0)}</td>
    <td class="num">${eur(c.mantenimiento)}</td><td class="num">${eur(c.gasto_variable)}</td><td class="num">${eur(f)}</td><td class="num" style="color:${r < 0 ? 'var(--rojo)' : 'var(--verde)'}"><b>${eur(r)}</b></td></tr>`; }).join('')}
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
    q(db().rpc('liquidacion_mes', { p_mes: ini }))
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
  <p class="ayuda">Viene de Personal → Nóminas del mes. Los anticipos, la gasolina y los descuentos son los que la gestoría tiene que descontar en la nómina.</p>
  <div class="tabla-wrap"><table><tr><th>Empleado</th><th>DNI</th><th class="num">Viajes</th><th class="num">Neto</th><th class="num">Dietas</th><th class="num">H. extra</th><th class="num">Extras</th><th class="num">Anticipos</th><th class="num">Gasolina</th><th class="num">Descuentos</th><th class="num">A pagar</th><th>Ausencias</th></tr>
  ${nominas.map((n) => `<tr><td>${esc(n.nombre)}</td><td>${esc(n.dni)}</td><td class="num">${n.viajes}</td><td class="num">${eur(n.neto_base)}</td><td class="num">${eur(n.dietas)}</td><td class="num">${num(n.horas_extra)} h</td><td class="num">${eur(n.extras)}</td><td class="num">${eur(n.anticipos)}</td><td class="num">${eur(n.combustible)}</td><td class="num">${eur(n.descuentos)}</td><td class="num"><b>${eur(n.total)}</b></td><td>${esc(n.ausencias)}</td></tr>`).join('')}
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
  hoja(d.nominas.map((n) => ({ Empleado: n.nombre, DNI: n.dni || '', Viajes: n.viajes, 'Neto nómina': n2(n.neto_base), Dietas: n2(n.dietas), 'Horas extra (h)': n2(n.horas_extra), 'Horas extra €': n2(n.horas_extra_importe), Extras: n2(n.extras), Anticipos: n2(n.anticipos), Gasolina: n2(n.combustible), Descuentos: n2(n.descuentos), 'A pagar': n2(n.total), Ausencias: n.ausencias || '' })), 'Nóminas');
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


arrancar();
