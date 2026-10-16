/*
 * Código compartido por el formulario del cliente y el panel de administración:
 * listas, validaciones, normalización de datos, armado de la ficha y llamada a la API.
 * Las mismas reglas están repetidas en apps-script/Code.gs (el servidor no confía en el navegador).
 */
(function () {
  'use strict';

  const CFG = window.ALTA_CONFIG || {};

  const PROV = ['CABA', 'Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'];
  const IVA = ['Responsable Inscripto', 'Monotributo', 'Exento', 'No Responsable', 'Consumidor Final'];
  const TRANSP = ['Cruz del Sur', 'Vía Cargo', 'Andreani', 'OCA', 'Correo Argentino', 'Expreso propio del cliente', 'Retira en depósito'];
  const FILE_KEYS = ['cm05', 'f1276', 'exencion'];

  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------- Validaciones ----------
   * CUIT: prefijo válido + dígito verificador módulo 11. Si el cálculo da 10, ese CUIT no existe:
   * ARCA le asigna otro prefijo (23, 24, 33, 34) y el nuevo número se valida igual que cualquier otro.
   * No consulta ARCA: confirma que el número está bien formado, no que esté inscripto.
   */
  function cuitOk(raw) {
    const s = String(raw || '').replace(/\D/g, '');
    if (s.length !== 11) return false;
    if (['20', '23', '24', '25', '26', '27', '30', '33', '34'].indexOf(s.slice(0, 2)) < 0) return false;
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    let t = 0;
    for (let i = 0; i < 10; i++) t += w[i] * +s[i];
    let dv = 11 - (t % 11);
    if (dv === 11) dv = 0;
    return dv !== 10 && dv === +s[10];
  }
  function fmtCuit(s) {
    s = String(s || '').replace(/\D/g, '').slice(0, 11);
    let o = s.slice(0, 2);
    if (s.length > 2) o += '-' + s.slice(2, 10);
    if (s.length > 10) o += '-' + s.slice(10);
    return o;
  }
  const phone = (raw) => String(raw || '').replace(/\D/g, '').replace(/^0+/, '');
  const phoneOk = (raw) => phone(raw).length === 10;
  const cpOk = (v) => /^\d{4}$/.test(String(v || '').trim()) || /^[A-Za-z]\d{4}[A-Za-z]{3}$/.test(String(v || '').trim());
  const mailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
  const req = (v) => String(v == null ? '' : v).trim().length > 0;
  /* Persona física (CUIL / CUIT personal): prefijos 20 a 27. Empresas: 30, 33, 34. */
  const esPersona = (c) => ['20', '23', '24', '25', '26', '27'].indexOf(String(c || '').replace(/\D/g, '').slice(0, 2)) >= 0;
  /* Nombre y apellido: al menos dos palabras de 2+ letras; solo letras, espacios, ' . - */
  const LETRAS = "A-Za-zÁÉÍÓÚÜÑáéíóúüñ";
  function nombreOk(v) {
    v = String(v || '').replace(/\s+/g, ' ').trim();
    return new RegExp("^[" + LETRAS + "' .\\-]+$").test(v) &&
      v.split(' ').filter((w) => w.replace(new RegExp('[^' + LETRAS + ']', 'g'), '').length >= 2).length >= 2;
  }
  const nombre = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúüñ])/g, (m, a, b) => a + b.toUpperCase());
  /* Número de cliente de Magnus: números y letras, sin espacios, hasta 20. */
  const normNroCliente = (v) => String(v || '').trim().toUpperCase().replace(/\s+/g, '');
  const nroClienteOk = (v) => /^[A-Z0-9][A-Z0-9\-\/.]{0,19}$/.test(normNroCliente(v));

  /* ---------- Normalización (lo que se guarda en la planilla) ---------- */
  const up = (v) => String(v || '').trim().toUpperCase();
  const tr = (v) => String(v || '').trim();

  function normalize(D) {
    const m = !!D.mismoDom;
    const o = {
      razon: up(D.razon), fantasia: tr(D.fantasia),
      cuit: String(D.cuit || '').replace(/\D/g, ''),
      email: tr(D.email).toLowerCase(), vendedor: nombre(D.vendedor),
      movil: phone(D.movil), otroTel: phone(D.otroTel),
      domCalle: up(D.domCalle), domCiudad: up(D.domCiudad), domProv: tr(D.domProv), domCP: up(D.domCP),
      mismoDom: m,
      entCalle: up(m ? D.domCalle : D.entCalle), entCiudad: up(m ? D.domCiudad : D.entCiudad),
      entProv: tr(m ? D.domProv : D.entProv), entCP: up(m ? D.domCP : D.entCP),
      entTel: phone(D.entTel), transporte: tr(D.transporte),
      iva: tr(D.iva), convenio: tr(D.convenio),
      convNro: D.convenio === 'Sí' ? tr(D.convNro) : ''
    };
    for (let i = 1; i <= 3; i++) {
      o['rn' + i] = tr(D['rn' + i]); o['rt' + i] = phone(D['rt' + i]); o['rc' + i] = tr(D['rc' + i]);
      o['bn' + i] = tr(D['bn' + i]); o['bt' + i] = phone(D['bt' + i]); o['bc' + i] = tr(D['bc' + i]);
    }
    return o;
  }

  /*
   * Ficha agrupada a partir de datos YA normalizados.
   * files[k] puede ser texto (nombre del archivo) o {text, url} (link a Drive).
   */
  function rowsOf(d, files) {
    files = files || {};
    const refs = (p, a, b, c) => {
      const o = [];
      for (let i = 1; i <= 3; i++) {
        if (d[a + i] || d[b + i] || d[c + i]) o.push([p + ' ' + i, [d[a + i], d[b + i], d[c + i]].filter(Boolean).join(' · ')]);
      }
      return o;
    };
    const fl = (k, need) => files[k] ? files[k] : (need ? 'Pendiente' : '');
    return [
      { g: 'Datos del cliente', step: 0, r: [['Razón social', d.razon], ['Nombre de fantasía', d.fantasia], ['CUIT', d.cuit ? fmtCuit(d.cuit) : ''], ['Email', d.email], ['Teléfono móvil', d.movil], ['Otro teléfono', d.otroTel], ['Vendedor / viajante', d.vendedor]] },
      { g: 'Domicilio legal', step: 0, r: [['Calle y número', d.domCalle], ['Ciudad', d.domCiudad], ['Provincia', d.domProv], ['Código postal', d.domCP]] },
      { g: 'Domicilio de entrega', step: 1, r: [['Calle y número', d.entCalle], ['Ciudad', d.entCiudad], ['Provincia', d.entProv], ['Código postal', d.entCP], ['Teléfono en destino', d.entTel], ['Transporte', d.transporte]] },
      { g: 'Referencias', step: 2, r: refs('Comercial', 'rn', 'rt', 'rc').concat(refs('Bancaria', 'bn', 'bt', 'bc')) },
      { g: 'Datos impositivos', step: 3, r: [['Condición ante el IVA', d.iva], ['Convenio Multilateral', d.convenio], ['Nro. Convenio Multilateral', d.convenio === 'Sí' ? d.convNro : ''], ['Formulario CM05', d.convenio === 'Sí' ? fl('cm05', 1) : ''], ['Formulario 1276', fl('f1276')], ['Certificado de exención', d.iva === 'Exento' ? fl('exencion', 1) : '']] }
    ];
  }
  const valText = (v) => (v && typeof v === 'object') ? (v.text || '') : (v || '');
  const valRaw = (v) => (v && typeof v === 'object') ? (v.url || v.text || '') : (v || '');

  /* Identificador único por envío: el servidor lo usa para no duplicar si el navegador reintenta. */
  function uid() {
    try { if (crypto.randomUUID) return crypto.randomUUID(); } catch (e) { /* sigue */ }
    const a = new Uint8Array(16);
    try { crypto.getRandomValues(a); } catch (e) { for (let i = 0; i < 16; i++) a[i] = Math.random() * 256; }
    return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- API (Google Apps Script) ----------
   * Se envía como text/plain para evitar el "preflight" CORS, que Apps Script no soporta.
   * opts.timeout: milisegundos (por defecto 30 s). Los errores traen:
   *   message → texto para mostrar a la persona;  code → para decidir qué hacer;  detail → técnico (consola).
   */
  async function api(body, opts) {
    opts = opts || {};
    const mk = (code, msg, detail, extra) => { const e = new Error(msg); e.code = code; e.detail = detail || ''; Object.assign(e, extra || {}); return e; };
    if (!CFG.API_URL || CFG.API_URL.indexOf('PEGAR_ACA') >= 0) {
      throw mk('CONFIG', 'El formulario todavía no está configurado. Avisanos por teléfono o email.', 'Falta API_URL en assets/js/config.js');
    }
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const ms = opts.timeout || 30000;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), ms) : null;
    let res, j;
    try {
      res = await fetch(CFG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(body),
        redirect: 'follow',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined
      });
      if (!res.ok) throw mk('HTTP', 'El servidor no respondió bien. Probá de nuevo en un momento.', 'HTTP ' + res.status);
      try { j = await res.json(); } catch (err) {
        throw mk('PARSE', 'El servidor respondió algo inesperado. Probá de nuevo en un momento.', 'La respuesta no es JSON: ¿la implementación de Apps Script está publicada para "Cualquier usuario"?');
      }
    } catch (err) {
      if (err.code) { console.warn('[API]', body.action, err.detail); throw err; }
      const timedOut = err && err.name === 'AbortError';
      const e = timedOut
        ? mk('TIMEOUT', 'El servidor está tardando más de lo normal.', 'Sin respuesta en ' + Math.round(ms / 1000) + ' s')
        : mk('NETWORK', 'No pudimos conectarnos. Revisá tu conexión a internet y probá de nuevo.', String(err && err.message || err));
      console.warn('[API]', body.action, e.detail);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (CFG.API_VERSION && j.version && j.version !== CFG.API_VERSION) {
      console.warn('[API] versión del servidor ' + j.version + ', la web espera ' + CFG.API_VERSION);
    }
    if (!j.ok) throw mk(j.code || 'ERROR', j.error || 'Error desconocido.', '', { data: j });
    return j;
  }

  /* ---------- UI chica compartida ---------- */
  let tt;
  function toast(m, ms) {
    const t = $('#toast'); if (!t) return;
    t.textContent = m; t.classList.add('on');
    clearTimeout(tt); tt = setTimeout(() => t.classList.remove('on'), ms || 2600);
  }
  function copy(text, msg) {
    const done = () => toast(msg || 'Copiado');
    const fb = () => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('No se pudo copiar'); }
      ta.remove();
    };
    try { navigator.clipboard.writeText(text).then(done, fb); } catch (e) { fb(); }
  }

  window.Alta = { CFG, PROV, IVA, TRANSP, FILE_KEYS, $, esc, cuitOk, fmtCuit, phone, phoneOk, cpOk, mailOk, req, esPersona, nombreOk, nombre, normNroCliente, nroClienteOk, normalize, rowsOf, valText, valRaw, uid, api, toast, copy };
})();
