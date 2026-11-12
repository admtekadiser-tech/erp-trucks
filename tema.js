/* ERP TRUCKS CROS · Modo oscuro
   Añade «🌙 Modo oscuro / ☀️ Modo claro» al pie del menú. La elección se guarda en cada
   navegador (cada persona elige la suya). No toca datos ni Supabase. */
'use strict';
(function () {
  const CLAVE = 'erp-tema';
  const raiz = document.documentElement;
  const leer = () => { try { return localStorage.getItem(CLAVE); } catch { return null; } };
  const guardar = (v) => { try { localStorage.setItem(CLAVE, v); } catch { /* sin almacenamiento: dura hasta recargar */ } };
  const oscuro = () => raiz.dataset.tema === 'oscuro';

  function aplicar(t) {
    if (t === 'oscuro') raiz.dataset.tema = 'oscuro'; else delete raiz.dataset.tema;
    const b = document.getElementById('b-tema');
    if (b) { b.textContent = oscuro() ? '☀️ Modo claro' : '🌙 Modo oscuro'; b.title = oscuro() ? 'Volver a los colores claros' : 'Fondo oscuro para descansar la vista'; }
  }
  window.cambiarTema = () => { const t = oscuro() ? 'claro' : 'oscuro'; guardar(t); aplicar(t); };

  // El menú se vuelve a pintar en cada cambio de página: se añade el botón cada vez que aparece
  function ponerBoton() {
    const pie = document.querySelector('.menu .pie');
    if (!pie || document.getElementById('b-tema')) return;
    pie.insertAdjacentHTML('afterbegin', '<div class="tema"><a id="b-tema" onclick="cambiarTema()"></a></div>');
    aplicar(oscuro() ? 'oscuro' : 'claro');
  }
  aplicar(leer());
  new MutationObserver(ponerBoton).observe(document.getElementById('app'), { childList: true });
  ponerBoton();
  // Si se cambia en otra pestaña abierta del ERP, esta también cambia
  window.addEventListener('storage', (e) => { if (e.key === CLAVE) aplicar(e.newValue); });
})();
