/*
 * Panel de administración (admin/index.html).
 *
 * - Una sola llamada al servidor al entrar ("list"), que trae las solicitudes completas:
 *   abrir una ficha es instantáneo, sin esperar a Apps Script.
 * - Cada acción (estado, observaciones, alta) devuelve el registro actualizado y se reemplaza en memoria.
 * - La clave queda en sessionStorage: se borra al cerrar la pestaña.
 */
(function () {
  'use strict';
  const A = window.Alta, $ = A.$, esc = A.esc;
  const KEY_SS = 'altaAdmin.key';
  const ESTADOS = ['Nueva', 'En revisión', 'Dada de alta', 'Rechazada'];
  const ESTADOS_MANUALES = ['Nueva', 'En revisión', 'Rechazada'];
  const PILL = { 'Nueva': 'nueva', 'En revisión': 'rev', 'Dada de alta': 'ok', 'Rechazada': 'gris' };
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let KEY = null, LIST = [], CUR = null, BUSY = false, LOADING = false;
  const F = { q: '', estado: '' };
  const wantNro = new URLSearchParams(location.search).get('nro');

  const ssGet = () => { try { return sessionStorage.getItem(KEY_SS); } catch (e) { return null; } };
  const ssSet = (k) => { try { k ? sessionStorage.setItem(KEY_SS, k) : sessionStorage.removeItem(KEY_SS); } catch (e) { /* nada */ } };

  async function call(action, extra, timeout) {
    try {
      const r = await A.api(Object.assign({ action, key: KEY }, extra || {}), { timeout: timeout || 45000 });
      checkVersion(r.version);
      return r;
    } catch (err) {
      if (err.data) checkVersion(err.data.version);
      if (err.code === 'AUTH' && action !== 'list') logout('La clave dejó de ser válida. Ingresala de nuevo.');
      throw err;
    }
  }
  function checkVersion(v) {
    const want = A.CFG.API_VERSION, b = $('#verWarn');
    if (!want || !b) return;
    const bad = v !== want;
    b.hidden = !bad;
    if (bad) b.innerHTML = '<b>El servidor no está actualizado.</b> Apps Script responde con la versión ' + esc(v || 'anterior') + ' y esta web espera la ' + esc(want) +
      '. En Apps Script pegá el Code.gs nuevo, ejecutá <code>setup</code> y hacé <i>Implementar → Administrar implementaciones → editar → Nueva versión</i>.';
  }

  /* ---------- Sesión ---------- */
  function showLogin(msg) {
    $('#login').hidden = false; $('#panel').hidden = true; $('#logout').hidden = true;
    const e = $('#loginErr'); e.textContent = msg || ''; e.hidden = !msg;
    setTimeout(() => $('#clave').focus(), 0);
  }
  function showPanel() { $('#login').hidden = true; $('#panel').hidden = false; $('#logout').hidden = false; }
  function logout(msg) { KEY = null; ssSet(null); LIST = []; CUR = null; showLogin(msg); }

  $('#loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = $('#clave').value.trim(); if (!v) return;
    const b = $('#loginBtn'); b.disabled = true; b.textContent = 'Ingresando…';
    KEY = v;
    try {
      const r = await call('list');
      ssSet(KEY); $('#clave').value = '';
      showPanel(); setList(r.items, wantNro);
    } catch (err) {
      KEY = null;
      showLogin(err.code === 'AUTH' ? 'Clave incorrecta.' : err.message);
    } finally { b.disabled = false; b.textContent = 'Ingresar'; }
  });
  $('#logout').addEventListener('click', () => logout());

  /* ---------- Lista ---------- */
  async function loadList(selectNro) {
    if (LOADING) return;
    LOADING = true;
    const btn = $('#refresh'); btn.disabled = true; btn.textContent = 'Actualizando…';
    if (!LIST.length) $('#list').innerHTML = skeleton();
    try {
      const r = await call('list');
      setList(r.items, selectNro || (CUR && CUR.nro));
    } catch (err) {
      if (err.code === 'AUTH') { logout('La clave dejó de ser válida. Ingresala de nuevo.'); return; }
      {
        if (LIST.length) A.toast('No se pudo actualizar: ' + err.message, 4000);
        else $('#list').innerHTML = '<div class="errbox"><p>No se pudieron cargar las solicitudes.</p><p class="small">' + esc(err.message) + '</p><button type="button" class="btn sm" id="retryList">Reintentar</button></div>';
      }
    } finally { LOADING = false; btn.disabled = false; btn.textContent = 'Actualizar'; }
  }
  const skeleton = () => '<div class="sk"></div><div class="sk"></div><div class="sk"></div>';

  function setList(items, selectNro) {
    LIST = items || [];
    const sel = LIST.find((s) => s.nro === selectNro) || LIST[0] || null;
    CUR = sel;
    renderMetrics(); renderList(); renderDetail();
  }
  function filtered() {
    const q = F.q.toLowerCase().replace(/[-\s]/g, '');
    return LIST.filter((s) => (!F.estado || s.estado === F.estado) &&
      (!q || [s.razon, s.fantasia, s.cuit, s.email, s.nro, s.nroCliente, s.vendedor].join('|').toLowerCase().replace(/[-\s]/g, '').indexOf(q) >= 0));
  }
  const parseDate = (v) => { const m = String(v || '').match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null; };

  function renderMetrics() {
    const counts = {}; LIST.forEach((s) => { counts[s.estado] = (counts[s.estado] || 0) + 1; });
    const now = new Date();
    const monthKey = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const altasMes = LIST.filter((s) => s.estado === 'Dada de alta' && String(s.fechaAlta || '').slice(0, 7) === monthKey).length;
    const dur = LIST.map((s) => { const a = parseDate(s.fecha), b = parseDate(s.fechaAlta); return a && b && b >= a ? (b - a) / 86400000 : null; }).filter((v) => v !== null);
    const avg = dur.length ? (dur.reduce((a, b) => a + b, 0) / dur.length).toFixed(1).replace('.', ',') : '—';
    $('#metrics').innerHTML = [
      ['Nuevas', counts['Nueva'] || 0, 'Nueva', 'hi'],
      ['En revisión', counts['En revisión'] || 0, 'En revisión', ''],
      ['Altas este mes', altasMes, 'Dada de alta', ''],
      ['Días promedio hasta el alta', avg, '', ''],
      ['Total de solicitudes', LIST.length, '', '']
    ].map((m) => '<button type="button" class="metric ' + m[3] + (m[2] && F.estado === m[2] ? ' on' : '') + '"' + (m[2] ? ' data-filtro="' + m[2] + '"' : ' disabled') + '><b>' + m[1] + '</b><span>' + m[0] + '</span></button>').join('');
    $('#fEstado').innerHTML = '<option value="">Todos los estados (' + LIST.length + ')</option>' +
      ESTADOS.map((e) => '<option value="' + e + '"' + (F.estado === e ? ' selected' : '') + '>' + e + ' (' + (counts[e] || 0) + ')</option>').join('');
  }
  function renderList() {
    const items = filtered();
    $('#list').innerHTML = items.length ? items.map((s) =>
      '<button type="button" class="item" data-nro="' + esc(s.nro) + '"' + (CUR && CUR.nro === s.nro ? ' aria-current="true"' : '') + '>' +
      '<span class="n">' + esc(s.razon || '(sin razón social)') + '</span>' +
      (cuitRepetido(s) ? '<span class="flag">CUIT repetido</span>' : '') +
      '<span class="m"><span class="mono">' + esc(s.nro) + ' · ' + esc((s.fecha || '').slice(0, 10)) + (s.nroCliente ? ' · Cl. ' + esc(s.nroCliente) : '') + '</span>' +
      '<span class="pill ' + (PILL[s.estado] || '') + '">' + esc(s.estado) + '</span></span></button>'
    ).join('') : '<p class="muted pad">' + (LIST.length ? 'No hay solicitudes con ese filtro.' : 'Todavía no hay solicitudes.') + '</p>';
  }
  $('#q').addEventListener('input', (e) => { F.q = e.target.value; renderList(); });
  $('#fEstado').addEventListener('change', (e) => { F.estado = e.target.value; renderMetrics(); renderList(); });
  $('#metrics').addEventListener('click', (e) => {
    const b = e.target.closest('[data-filtro]'); if (!b) return;
    F.estado = F.estado === b.dataset.filtro ? '' : b.dataset.filtro; renderMetrics(); renderList();
  });
  $('#refresh').addEventListener('click', () => loadList());
  $('#list').addEventListener('click', (e) => {
    if (e.target.id === 'retryList') { loadList(); return; }
    const b = e.target.closest('.item'); if (!b) return;
    CUR = LIST.find((s) => s.nro === b.dataset.nro) || null;
    renderList(); renderDetail();
    if (window.innerWidth < 860) $('#detail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  /* ---------- Detalle ---------- */
  function filesOf(r) {
    const o = {};
    A.FILE_KEYS.forEach((k) => { if (r[k]) o[k] = { text: 'Ver archivo', url: r[k] }; });
    return o;
  }
  /* El CUIT puede repetirse (sucursales): se avisa, no se bloquea. */
  const otherSameCuit = (r) => LIST.filter((s) => s.nro !== r.nro && s.cuit === r.cuit && s.estado !== 'Rechazada');
  const cuitRepetido = (r) => r.estado !== 'Rechazada' && otherSameCuit(r).length > 0;
  const descOtra = (s) => '<a href="#" data-goto-nro="' + esc(s.nro) + '">' + esc(s.nro) + '</a> · ' + esc(s.estado) + (s.nroCliente ? ' · cliente <b>' + esc(s.nroCliente) + '</b>' : '') + (s.razon ? ' · ' + esc(s.razon) : '');

  /* Valida el número de cliente antes de ir al servidor (el servidor lo vuelve a controlar). */
  function nroClienteError(r, v) {
    const n = A.normNroCliente(v);
    if (!n) return 'Ingresá el número de cliente asignado en Magnus.';
    if (!A.nroClienteOk(n)) return 'Solo números o letras, sin espacios (hasta 20).';
    const usado = LIST.find((s) => s.nro !== r.nro && s.nroCliente && A.normNroCliente(s.nroCliente) === n);
    if (usado) return 'Ese número ya lo tiene ' + usado.razon + ' (' + usado.nro + ').';
    return '';
  }
  function nroField(r, btnHtml) {
    return '<div class="nrocli"><div class="f"><label for="nroCli">Número de cliente en Magnus</label>' +
      '<div class="inline"><input id="nroCli" class="mono" type="text" autocapitalize="characters" spellcheck="false" autocomplete="off" maxlength="20" placeholder="Ej. 10458" value="' + esc(r.nroCliente || '') + '" aria-describedby="nroCliErr">' + btnHtml + '</div>' +
      '<span class="err" id="nroCliErr" role="alert"></span></div></div>';
  }
  function altaBox(r) {
    if (r.estado === 'Dada de alta' && r.notificado) {
      return '<div class="altabox ok"><div class="cl"><span>Cliente N°</span><b class="mono">' + esc(r.nroCliente || '—') + '</b></div>' +
        '<div><b>Dada de alta el ' + esc(r.fechaAlta) + '.</b><br>Email con número de cliente y enlace de registración enviado a ' + esc(r.email) + ' el ' + esc(r.notificado) + '.' +
        '<details class="reenvio"><summary>Corregir número o reenviar email</summary>' + nroField(r, '<button type="button" class="btn sm" data-act="reenviar">Reenviar email</button>') + '</details></div></div>';
    }
    if (r.estado === 'Dada de alta') {
      return '<div class="altabox warn"><div><b>Dada de alta, pero el email no salió.</b><br>Revisá la dirección (' + esc(r.email) + ') y volvé a intentar.</div>' +
        nroField(r, '<button type="button" class="btn pri" data-act="reenviar">Enviar email de alta</button>') + '</div>';
    }
    if (r.estado === 'Rechazada') {
      return '<div class="altabox gris"><div><b>Solicitud rechazada.</b><br>Para darla de alta, primero pasala a "En revisión".</div></div>';
    }
    return '<div class="altabox"><div><b>Dar de alta</b><br>Cargá el cliente en Magnus y copiá acá el número asignado. Se le envía a <strong>' + esc(r.email) + '</strong> un email con su número de cliente y el enlace para crear su usuario en la web.</div>' +
      nroField(r, '<button type="button" class="btn pri" data-act="aprobar">Dar de alta y enviar email</button>') + '</div>';
  }
  function renderDetail() {
    const r = CUR;
    if (!r) { $('#detail').innerHTML = '<p class="muted">' + (LIST.length ? 'Elegí una solicitud de la lista.' : 'Todavía no hay solicitudes.') + '</p>'; return; }
    const g = A.rowsOf(r, filesOf(r));
    const pend = [];
    g.forEach((b) => b.r.forEach((x) => { if (x[1] === 'Pendiente') pend.push(x[0]); }));
    let h = '<div class="dethead"><div><h2>' + esc(r.razon) + '</h2><div class="mono sub">' + esc(r.nro) + ' · recibida ' + esc(r.fecha) + '</div>' +
      (r.vendedor ? '<div class="vend">Vendedor / viajante: <b>' + esc(r.vendedor) + '</b></div>' : '') + '</div>' +
      '<div class="acts"><button class="btn sm" type="button" data-act="fila">Copiar fila</button><button class="btn sm" type="button" data-act="xlsx">Descargar Excel</button></div></div>';
    h += '<div class="estado" role="group" aria-label="Estado"><span class="pill big ' + (PILL[r.estado] || '') + '">' + esc(r.estado) + '</span>' +
      (r.estado === 'Dada de alta' ? '' : ESTADOS_MANUALES.filter((e) => e !== r.estado).map((e) => '<button type="button" data-estado="' + e + '">Pasar a ' + e + '</button>').join('')) + '</div>';
    const otras = otherSameCuit(r);
    if (otras.length) h += '<div class="banner cuitdup"><b>CUIT repetido.</b> También figura en:<ul>' + otras.map((s) => '<li>' + descOtra(s) + '</li>').join('') + '</ul>' +
      'Si es otra sucursal, dala de alta con un <b>número de cliente distinto</b>. Si es la misma, pasá esta solicitud a "Rechazada".</div>';
    if (A.esPersona(r.cuit)) h += '<div class="banner"><b>CUIL / persona física.</b> El número empieza con ' + esc(String(r.cuit).slice(0, 2)) + '. Verificá que sea el CUIT con el que factura.</div>';
    if (pend.length) h += '<div class="banner">Documentación pendiente: ' + pend.map(esc).join(', ') + '.</div>';
    h += altaBox(r);
    g.forEach((b) => {
      if (!b.r.length) return;
      h += '<div class="grp"><h3>' + b.g + '</h3>';
      b.r.forEach((x) => {
        const v = x[1], text = A.valText(v), raw = A.valRaw(v);
        const shown = !text ? '—' : (v && v.url ? '<a href="' + esc(v.url) + '" target="_blank" rel="noopener">' + esc(text) + '</a>' : esc(text));
        h += '<div class="row"><span class="k">' + esc(x[0]) + '</span><span class="v' + (text ? '' : ' empty') + (text === 'Pendiente' ? ' pend' : '') + '">' + shown + '</span>' +
          (text && text !== 'Pendiente' ? '<button class="btn sm ghost" type="button" data-cp="' + esc(raw) + '">Copiar</button>' : '<span></span>') + '</div>';
      });
      h += '</div>';
    });
    if (r.carpeta) h += '<p class="small"><a href="' + esc(r.carpeta) + '" target="_blank" rel="noopener">Abrir carpeta de documentación en Drive</a></p>';
    if (r.historialEmails) h += '<div class="grp"><h3>Historial de emails de alta</h3><pre class="history">' + esc(r.historialEmails) + '</pre></div>';
    h += '<div class="grp"><h3>Observaciones internas</h3><textarea id="obs" rows="3" maxlength="2000" placeholder="Notas para administración (no las ve el cliente)">' + esc(r.obs) + '</textarea>' +
      '<div class="right"><button type="button" class="btn sm" data-act="obs">Guardar observaciones</button></div></div>';
    $('#detail').innerHTML = h;
  }

  function replaceItem(item, msg) {
    const i = LIST.findIndex((s) => s.nro === item.nro);
    if (i >= 0) LIST[i] = item; else LIST.unshift(item);
    CUR = item;
    renderMetrics(); renderList(); renderDetail();
    if (msg) A.toast(msg);
  }
  async function act(fn, btn, busyText) {
    if (BUSY) return;
    BUSY = true;
    const old = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; if (busyText) btn.textContent = busyText; }
    try { await fn(); }
    catch (err) {
      if (err.code === 'AUTH') return;
      if (err.data && err.data.item) replaceItem(err.data.item);
      else if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = old; }
      if (err.code === 'CLIENT_NUMBER' || err.code === 'CLIENT_NUMBER_DUP') { showNroErr(err.message); }
      else A.toast(err.message, 5000);
      if (err.code === 'NOTFOUND' || err.code === 'STATE') loadList();
    } finally { BUSY = false; }
  }
  function showNroErr(msg) {
    const e = $('#nroCliErr'); if (!e) { A.toast(msg, 5000); return; }
    e.textContent = msg; e.closest('.f').classList.toggle('bad', !!msg);
    if (msg) $('#nroCli').focus();
  }
  function doAlta(t, force) {
    const r = CUR, inp = $('#nroCli');
    const v = A.normNroCliente(inp ? inp.value : r.nroCliente);
    const m = nroClienteError(r, v);
    if (m) { showNroErr(m); return; }
    showNroErr('');
    const txt = force
      ? '¿Enviar el email de alta a ' + r.email + '?\n\nNúmero de cliente: ' + v
      : 'Vas a dar de alta a:\n\n' + r.razon + '\nCUIT ' + A.fmtCuit(r.cuit) + (A.esPersona(r.cuit) ? ' (persona física / CUIL)' : '') + '\nNúmero de cliente: ' + v +
        (otherSameCuit(r).some((s) => s.estado === 'Dada de alta') ? '\n\nATENCIÓN: este CUIT ya es cliente (N° ' + otherSameCuit(r).filter((s) => s.nroCliente).map((s) => s.nroCliente).join(', ') + '). Se crea otra cuenta para esta sucursal.' : '') +
        '\n\nSe le envía un email a ' + r.email + ' con el número de cliente y el enlace para crear su usuario.\n\n¿Continuar?';
    if (!confirm(txt)) return;
    act(async () => {
      const res = await call('approve', { nro: r.nro, nroCliente: v, force: !!force }, 60000);
      replaceItem(res.item, force ? 'Email enviado.' : 'Cliente dado de alta. Email enviado.');
    }, t, 'Enviando…');
  }

  $('#detail').addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto-nro]');
    if (g) { e.preventDefault(); CUR = LIST.find((s) => s.nro === g.dataset.gotoNro) || CUR; renderList(); renderDetail(); return; }
    const t = e.target.closest('button'); if (!t || !CUR) return;
    const r = CUR;
    if (t.dataset.cp !== undefined) { A.copy(t.dataset.cp, 'Copiado'); return; }
    if (t.dataset.estado) {
      act(async () => { const res = await call('setEstado', { nro: r.nro, estado: t.dataset.estado }); replaceItem(res.item, 'Estado actualizado'); }, t, 'Guardando…');
      return;
    }
    switch (t.dataset.act) {
      case 'aprobar': doAlta(t, false); break;
      case 'reenviar': doAlta(t, true); break;
      case 'obs':
        act(async () => { const res = await call('setObs', { nro: r.nro, obs: $('#obs').value }); replaceItem(res.item, 'Observaciones guardadas'); }, t, 'Guardando…');
        break;
      case 'fila': {
        const vals = [r.nro, r.nroCliente || ''];
        A.rowsOf(r, filesOf(r)).forEach((b) => b.r.forEach((x) => vals.push(A.valRaw(x[1]))));
        A.copy(vals.join('\t'), 'Fila copiada. Pegala en tu planilla.');
        break;
      }
      case 'xlsx': exportXlsx(r, t); break;
    }
  });
  $('#detail').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'nroCli') {
      e.preventDefault();
      const b = $('#detail [data-act="aprobar"], #detail [data-act="reenviar"]'); if (b) b.click();
    }
  });
  $('#detail').addEventListener('input', (e) => { if (e.target.id === 'nroCli') showNroErr(''); });

  /* Excel: la librería (≈900 KB) se descarga recién la primera vez que se usa. */
  let xlsxP = null;
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve();
    if (!xlsxP) xlsxP = new Promise((ok, ko) => {
      const s = document.createElement('script'); s.src = XLSX_URL; s.onload = ok;
      s.onerror = () => { xlsxP = null; ko(new Error('No se pudo descargar el generador de Excel.')); };
      document.head.appendChild(s);
    });
    return xlsxP;
  }
  async function exportXlsx(r, btn) {
    btn.disabled = true;
    try {
      await loadXlsx();
      const aoa = [['FICHA DE ALTA DE CLIENTE', r.nro], ['Estado', r.estado], ['Número de cliente', r.nroCliente || ''], ['Recibida', r.fecha], ['Fecha de alta', r.fechaAlta || ''], []];
      A.rowsOf(r, filesOf(r)).forEach((b) => { aoa.push([b.g.toUpperCase()]); b.r.forEach((x) => aoa.push([x[0], A.valRaw(x[1])])); aoa.push([]); });
      const ws = XLSX.utils.aoa_to_sheet(aoa); ws['!cols'] = [{ wch: 30 }, { wch: 60 }];
      const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Ficha');
      XLSX.writeFile(wb, 'Alta ' + r.nro + ' - ' + String(r.razon).replace(/[^\w\- ]+/g, '').trim().slice(0, 40) + '.xlsx');
    } catch (err) { A.toast(err.message + ' Usá "Copiar fila".', 4000); }
    finally { btn.disabled = false; }
  }

  /* ---------- Arranque ---------- */
  KEY = ssGet();
  if (KEY) { showPanel(); loadList(wantNro); } else showLogin();
})();
