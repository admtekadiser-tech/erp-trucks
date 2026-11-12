/* ERP TRUCKS · Diseño de la factura (mismo estilo que las de Invoice2go)
   Se usa para «Ver / imprimir PDF» y para los PDF del paquete de la gestoría.
   Las páginas se montan aquí (13 líneas en la primera, 22 en las demás) para que
   la cabecera y el «1 / 3» salgan igual al imprimir y al generar el ZIP.
   Se carga DESPUÉS de app.js: sustituye a htmlFactura, imprimirFactura y descargarZipGestoria de app.js. */
'use strict';

const FUENTE_FACTURA = '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inconsolata:wght@400;700&display=swap">';
const AZUL_FACTURA = '#2c5aa0';
const CSS_FACTURA = `
.fx{font-family:'Inconsolata',Consolas,'Courier New',monospace;color:#555;width:210mm}
.fx *{box-sizing:border-box}
.fx-pg{position:relative;width:210mm;height:296mm;padding:0 9.5mm;background:#fff;overflow:hidden;break-after:page;page-break-after:always}
.fx-pg:last-child{break-after:auto;page-break-after:auto}
.fx-logo{text-align:center;padding-top:10mm;height:51mm}.fx-logo img{width:40mm;height:40mm;object-fit:contain}
.fx-emp{text-align:center;font-weight:700;font-size:31px;color:#444;letter-spacing:.4px;line-height:1.2}
.fx-linea{border-top:1.6px solid ${AZUL_FACTURA};margin:2.5mm -9.5mm 0}
.fx-tit{text-align:center;font-weight:700;font-size:17px;color:#444;margin:6mm 0 3mm}
.fx-datos{display:flex;justify-content:space-between;gap:8mm;font-size:11px;line-height:1.75}
.fx-izq{border-collapse:collapse}.fx-izq td{padding:0;vertical-align:top;white-space:nowrap}.fx-izq td:first-child{width:35mm}.fx-izq tr.sep td{padding-top:2.4mm}
.fx-der{text-align:right;white-space:nowrap}
.fx-run{text-align:center;font-family:'DejaVu Serif',Georgia,'Times New Roman',serif;font-size:13px;color:#222;padding-top:5mm}
.fx-t{width:calc(100% + 19mm);margin:9mm -9.5mm 0;border-collapse:collapse;font-size:10px;table-layout:fixed}
.fx-t.sig{margin-top:5mm}
.fx-t th{font-weight:700;font-size:12.5px;color:#444;text-align:left;padding:0 0 3mm;border-bottom:1.6px solid ${AZUL_FACTURA}}
.fx-t td{padding:3.7mm 0;line-height:1.4;vertical-align:top}
.fx-t th:first-child,.fx-t td:first-child{padding-left:9.5mm}
.fx-t th:last-child,.fx-t td:last-child{padding-right:9.5mm}
.fx-t td:first-child{padding-right:4mm;word-wrap:break-word}
.fx .n{text-align:right;white-space:nowrap}
.fx-cierre{width:105mm;margin:8mm -9.5mm 0 auto}
.fx-tot{width:100%;border-collapse:collapse;font-size:10px}
.fx-tot td{padding:.6mm 0;text-align:right;white-space:nowrap}
.fx-tot td:first-child{width:62%}.fx-tot td:last-child{padding-right:9.5mm}
.fx-tot tr.pag td{padding:3.4mm 0 2.4mm}.fx-tot tr.pag td:last-child{padding-right:9.5mm}
.fx-tot tr.ap td{font-weight:700;font-size:18px;color:#444;padding:2.6mm 0;border-top:1.6px solid ${AZUL_FACTURA};border-bottom:1.6px solid ${AZUL_FACTURA}}
.fx-tot tr.ap td:last-child{padding-right:9.5mm}
.fx-pie{margin-top:9mm;font-size:10px;line-height:1.6}
.fx-num{position:absolute;left:0;right:0;bottom:6mm;text-align:center;font-family:'DejaVu Serif',Georgia,'Times New Roman',serif;font-size:13px;color:#222}
.fx-marca{position:absolute;top:110mm;left:0;right:0;text-align:center;font-size:90px;font-weight:700;color:rgba(200,0,0,.10);transform:rotate(-25deg);pointer-events:none}`;

function htmlFactura(f, lineas) {
  const e = S.empresa || {};
  const c = S.clientes.find((x) => x.id === f.cliente_id) || {};
  const borr = f.estado === 'borrador';
  const nFact = borr ? 'Sin número' : f.codigo;
  const razon = e.razon_social || 'Datos de empresa sin rellenar';
  const pct = num(f.iva_pct, Number(f.iva_pct) % 1 ? 2 : 0);
  const cant = (x) => num(x, Number(x) % 1 ? 2 : 0);
  const cobrado = borr ? 0 : Number(f.cobrado || 0);

  // Reparto en páginas: cada línea ocupa 1 hueco (algo más si la descripción no cabe en una línea)
  const PRIMERA = 13, RESTO = 22, HUECO_TOTALES = 5.5;
  const alto = (l) => 1 + 0.35 * (Math.max(1, Math.ceil(String(l.concepto || '').length / 44)) - 1);
  const paginas = []; let actual = []; let usado = 0; let cabe = PRIMERA;
  for (const l of lineas) {
    const h = alto(l);
    if (actual.length && usado + h > cabe) { paginas.push(actual); actual = []; usado = 0; cabe = RESTO; }
    actual.push(l); usado += h;
  }
  if (usado + HUECO_TOTALES > cabe && actual.length) { paginas.push(actual); actual = []; }
  paginas.push(actual);
  const total = paginas.length;

  const dirCliente = [c.direccion, [c.cp, c.poblacion].filter(Boolean).join(' '), c.provincia ? '(' + c.provincia + ')' : '']
    .filter(Boolean).map(esc).join('<br>');
  const dirEmpresa = [e.direccion, [e.cp, e.poblacion].filter(Boolean).join(' ')].filter(Boolean).join(', ');

  const primera = `
    ${window.LOGO_FACTURA ? `<div class="fx-logo"><img src="${window.LOGO_FACTURA}" alt=""></div>` : '<div style="height:20mm"></div>'}
    <div class="fx-emp">${esc(razon)}</div><div class="fx-linea"></div>
    <div class="fx-tit">${borr ? 'Prefactura' : 'Factura'}</div>
    <div class="fx-datos">
      <table class="fx-izq">
        <tr><td>Factura n.°:</td><td>${esc(nFact)}</td></tr>
        <tr><td>Fecha:</td><td>${fecha(f.fecha) || '—'}</td></tr>
        ${f.vencimiento && !borr ? `<tr><td>Vencimiento:</td><td>${fecha(f.vencimiento)}</td></tr>` : ''}
        <tr class="sep"><td>Facturado a:</td><td>${esc(c.nombre)}${c.cif ? ' ' + esc(c.cif) : ''}${dirCliente ? '<br>' + dirCliente : ''}</td></tr>
      </table>
      <div class="fx-der">${[dirEmpresa, e.email, e.telefono, e.cif ? 'CIF: ' + e.cif : ''].filter(Boolean).map(esc).join('<br>')}</div>
    </div>`;
  const corrida = `<div class="fx-run">${esc(razon)} - Factura ${esc(nFact)} - ${fecha(f.fecha) || ''}</div>`;
  const cabTabla = `<colgroup><col style="width:41%"><col style="width:13%"><col style="width:16.5%"><col style="width:13.5%"><col style="width:16%"></colgroup>
    <tr><th>Descripción</th><th class="n">Cantidad</th><th class="n">Tarifa</th><th class="n">IVA</th><th class="n">Importe</th></tr>`;
  const fila = (l) => `<tr><td>${esc(l.concepto)}</td><td class="n">${cant(l.cantidad)}</td><td class="n">${eur(l.precio)}</td><td class="n">${pct} %</td><td class="n">${eur(l.importe)}</td></tr>`;
  const cierre = `
    <div class="fx-cierre"><table class="fx-tot">
      <tr><td>Subtotal</td><td>${eur(f.base)}</td></tr>
      <tr><td>IVA ${pct} % (${eur(f.base)})</td><td>${eur(f.iva)}</td></tr>
      <tr><td>Total</td><td>${eur(f.total)}</td></tr>
      <tr class="pag"><td>Pagado</td><td>${eur(cobrado)}</td></tr>
      <tr class="ap"><td>Total a pagar</td><td>${eur(Number(f.total || 0) - cobrado)}</td></tr>
    </table></div>
    <div class="fx-pie">Forma de pago: ${esc(c.forma_pago || 'Transferencia')}${e.iban ? '<br>IBAN: ' + esc(e.iban) : ''}</div>`;

  return `<div class="fx"><style>${CSS_FACTURA}</style>${paginas.map((ls, i) => `
  <div class="fx-pg">
    ${borr ? '<div class="fx-marca">BORRADOR</div>' : ''}
    ${i === 0 ? primera : corrida}
    ${ls.length ? `<table class="fx-t${i ? ' sig' : ''}">${cabTabla}${ls.map(fila).join('')}</table>` : ''}
    ${i === total - 1 ? cierre : ''}
    <div class="fx-num">${i + 1} / ${total}</div>
  </div>`).join('')}</div>`;
}

// Ventana con la factura lista para imprimir o «Guardar como PDF» (el nombre del archivo sale del título)
async function imprimirFactura(id) {
  const ventana = window.open('', '_blank');
  const [f, lineas] = await Promise.all([
    q(db().from('v_facturas').select('*').eq('id', id).single()),
    q(db().from('factura_lineas').select('*').eq('factura_id', id).order('orden'))
  ]);
  const cli = (S.clientes.find((x) => x.id === f.cliente_id) || {}).nombre || '';
  const titulo = f.estado === 'borrador' ? `Prefactura ${cli}` : `Factura ${f.codigo} ${cli}`;
  ventana.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(titulo)}</title>${FUENTE_FACTURA}
  <style>@page{size:A4;margin:0}body{margin:0;background:#e6e8eb}.np{text-align:center;padding:14px;font-family:Arial,sans-serif}
  .np button{font-size:15px;padding:8px 18px;cursor:pointer}.fx{margin:0 auto}.fx-pg{margin:0 auto 14px;box-shadow:0 1px 8px rgba(0,0,0,.25)}
  @media print{body{background:#fff}.np{display:none}.fx-pg{margin:0;box-shadow:none}}</style></head><body>
  <div class="np"><button onclick="print()">🖨 Imprimir / Guardar PDF</button></div>${htmlFactura(f, lineas)}</body></html>`);
  ventana.document.close();
}

// PDF (Blob) de una factura para el ZIP de la gestoría
async function pdfFactura(f, lineas) {
  try { await Promise.all([document.fonts.load('400 12px Inconsolata'), document.fonts.load('700 12px Inconsolata')]); } catch (_) { /* sigue con la fuente de reserva */ }
  return html2pdf().set({
    margin: 0, image: { type: 'jpeg', quality: 0.95 },
    html2canvas: { scale: 2, useCORS: true, scrollX: 0, scrollY: 0 },
    jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
    pagebreak: { mode: ['css'] }
  }).from(htmlFactura(f, lineas)).outputPdf('blob');
}

// Paquete de la gestoría (igual que en app.js, pero con los PDF de factura en el formato nuevo)
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
      zip.file(`facturas_emitidas/${String(f.codigo).replace(/[\\/]+/g, '-')}.pdf`, await pdfFactura(f, lineas));
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
