/*
 * Formulario de alta para el cliente (index.html).
 * Pasos: Cliente → Entrega → Referencias → Impositivo → Revisar → Enviar.
 *
 * - El borrador se guarda en este navegador (sin adjuntos) y vence a los CFG.DRAFT_DAYS días.
 * - Cada envío lleva un ID único (reqId): si la conexión se corta y se reintenta, el servidor
 *   devuelve el mismo número de solicitud en lugar de crear otra.
 * - El CUIT se consulta al servidor apenas es válido. Si ya está registrado se AVISA (no se bloquea:
 *   un cliente puede dar de alta otra sucursal con el mismo CUIT). También se avisa si es un CUIL /
 *   CUIT de persona física.
 * - El nombre y apellido del vendedor / viajante es opcional.
 */
(function () {
  'use strict';
  const A = window.Alta, $ = A.$, esc = A.esc, req = A.req;
  const STEPS = ['Cliente', 'Entrega', 'Referencias', 'Impositivo', 'Revisar'];
  const DRAFT = 'altaCliente.draft.v4';
  const OLD_DRAFTS = ['altaCliente.draft'];
  const DRAFT_MS = (A.CFG.DRAFT_DAYS || 3) * 86400000;
  const MAX_FILE = (A.CFG.MAX_FILE_MB || 5) * 1024 * 1024;
  const MAX_TOTAL = (A.CFG.MAX_TOTAL_MB || 15) * 1024 * 1024;
  const OK_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
  const URL_REGISTRO = 'https://www.corti-fer.com.ar/registracion.aspx?TipoRegistracion=1';

  let D = {}, step = 0, FILES = {}, DONE = null, SENDING = false, reqId = A.uid();
  const CUIT_ST = {};            // cuit → { estado: 'libre' | 'cliente' | 'en_curso' | 'consultando' }
  let cuitTimer = null;

  /* ---------- Reglas por campo ---------- */
  const TEL = 'Ingresá código de área y número, sin 0 ni 15 (10 dígitos).';
  const CP = 'Ingresá 4 números (por ejemplo 2000) o el CPA completo (S2000ABC).';
  const cuitDigits = () => String(D.cuit || '').replace(/\D/g, '');
  const RULES = {
    razon: (v) => req(v) ? '' : 'Escribí la razón social tal como figura en ARCA.',
    cuit: (v) => {
      if (!req(v)) return 'Ingresá el CUIT.';
      if (!A.cuitOk(v)) return 'Este CUIT no es válido. Revisá los 11 números.';
      return '';
    },
    vendedor: (v) => !req(v) || A.nombreOk(v) ? '' : 'Si lo completás, ingresá nombre y apellido (por ejemplo: Juan Pérez).',
    email: (v) => !req(v) ? 'Ingresá un email.' : (A.mailOk(v) ? '' : 'Falta algo en el email, por ejemplo @ o el dominio.'),
    movil: (v) => !req(v) ? 'Ingresá un teléfono móvil.' : (A.phoneOk(v) ? '' : TEL),
    otroTel: (v) => !req(v) || A.phoneOk(v) ? '' : TEL,
    domCalle: (v) => req(v) ? '' : 'Ingresá calle y número.',
    domCiudad: (v) => req(v) ? '' : 'Ingresá la ciudad.',
    domProv: (v) => req(v) ? '' : 'Elegí la provincia.',
    domCP: (v) => !req(v) ? 'Ingresá el código postal.' : (A.cpOk(v) ? '' : CP),
    entCalle: (v) => D.mismoDom || req(v) ? '' : 'Ingresá calle y número de entrega.',
    entCiudad: (v) => D.mismoDom || req(v) ? '' : 'Ingresá la ciudad.',
    entProv: (v) => D.mismoDom || req(v) ? '' : 'Elegí la provincia.',
    entCP: (v) => D.mismoDom ? '' : (!req(v) ? 'Ingresá el código postal.' : (A.cpOk(v) ? '' : CP)),
    entTel: (v) => !req(v) || A.phoneOk(v) ? '' : TEL,
    transporteOtro: (v) => D.transporte !== 'Otro' || req(v) ? '' : 'Escribí el nombre del transporte seleccionado como Otro.',
    iva: (v) => req(v) ? '' : 'Elegí la condición ante el IVA.',
    convenio: (v) => req(v) ? '' : 'Indicá si sos contribuyente de Convenio Multilateral.',
    convNro: (v) => D.convenio !== 'Sí' || req(v) ? '' : 'Ingresá el número de inscripción en Convenio Multilateral.'
  };
  for (let i = 1; i <= 3; i++) {
    RULES['rt' + i] = (v) => !req(v) || A.phoneOk(v) ? '' : 'Teléfono con código de área, 10 dígitos.';
    RULES['bt' + i] = RULES['rt' + i];
  }
  const STEPKEYS = [
    ['razon', 'cuit', 'email', 'movil', 'otroTel', 'vendedor', 'domCalle', 'domCiudad', 'domProv', 'domCP'],
    ['entCalle', 'entCiudad', 'entProv', 'entCP', 'entTel', 'transporte', 'transporteOtro'],
    ['rt1', 'rt2', 'rt3', 'bt1', 'bt2', 'bt3'],
    ['iva', 'convenio', 'convNro'],
    []
  ];
  const stepHasErrors = (s) => STEPKEYS[s].some((k) => RULES[k] && RULES[k](D[k]));

  /* No se consulta ni se informa al solicitante si el CUIT ya está registrado.
     La revisión de CUIT duplicados queda exclusivamente en el panel de administración. */
  function checkCuitSoon() {}
  function cuitWarn() {
    const w = $('#w_cuit');
    if (w) { w.innerHTML = ''; w.hidden = true; }
  }

  /* ---------- Plantillas ---------- */
  function fld(k, label, o) {
    o = o || {};
    const cls = 'f' + (o.span === '' ? '' : ' ' + (o.span || 'c6'));
    const v = D[k] || '';
    let input;
    if (o.type === 'select') {
      input = '<select id="' + k + '" data-k="' + k + '"' + (o.ac ? ' autocomplete="' + o.ac + '"' : '') + ' aria-describedby="e_' + k + '"><option value="">Elegir…</option>' +
        o.opts.map((x) => '<option' + (x === v ? ' selected' : '') + '>' + esc(x) + '</option>').join('') + '</select>';
    } else {
      input = '<input id="' + k + '" data-k="' + k + '" type="' + (o.type || 'text') + '" value="' + esc(v) + '"' +
        (o.ph ? ' placeholder="' + esc(o.ph) + '"' : '') + (o.ac ? ' autocomplete="' + o.ac + '"' : '') +
        (o.inputmode ? ' inputmode="' + o.inputmode + '"' : '') + (o.list ? ' list="' + o.list + '"' : '') +
        (o.max ? ' maxlength="' + o.max + '"' : '') + (o.mono ? ' class="mono"' : '') + ' aria-describedby="e_' + k + '">';
    }
    return '<div class="' + cls + '" data-f="' + k + '"><label for="' + k + '">' + label + (o.opt ? ' <span class="opt">(opcional)</span>' : '') + '</label>' + input +
      (o.hint ? '<span class="hint">' + o.hint + '</span>' : '') + '<span class="okmark">' + (o.okmsg || '') + '</span><span class="err" id="e_' + k + '"></span>' +
      '<span class="warnmsg" id="w_' + k + '" role="status" hidden></span></div>';
  }
  function fileBox(k, label, hint, later) {
    const f = FILES[k];
    return '<div class="f c6" data-f="' + k + '"><span class="lab">' + label + ' <span class="opt">(' + (later ? 'podés enviarlo después' : 'opcional') + ')</span></span>' +
      '<label class="file' + (f ? ' has' : '') + '" for="' + k + '"><input type="file" id="' + k + '" data-file="' + k + '" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png">' +
      '<span class="btn sm" aria-hidden="true">' + (f ? 'Cambiar' : 'Adjuntar') + '</span><span class="name">' + (f ? esc(f.name) : esc(hint) + ' · PDF o foto, hasta ' + (A.CFG.MAX_FILE_MB || 5) + ' MB') + '</span>' +
      (f ? '<button type="button" class="linkbtn" data-rmfile="' + k + '">Quitar</button>' : '') + '</label></div>';
  }

  function view(s) {
    if (s === 0) return '<h2>Datos del cliente</h2><p class="lead">Tal como figuran en ARCA. Son 2 minutos.</p><div class="grid">' +
      fld('razon', 'Razón social', { ac: 'organization', hint: 'Se carga en mayúsculas.', max: 200 }) +
      fld('fantasia', 'Nombre de fantasía', { opt: 1, max: 200 }) +
      fld('cuit', 'CUIT', { mono: 1, inputmode: 'numeric', ph: '30-12345678-9', span: 'c3', okmsg: 'CUIT válido', max: 13 }) +
      fld('email', 'Email', { type: 'email', ac: 'email', span: 'c3', hint: 'Acá te avisamos cuando tu cuenta esté activa.', max: 200 }) +
      fld('movil', 'Teléfono móvil', { type: 'tel', ac: 'tel-national', inputmode: 'tel', ph: '3416004728', span: 'c3', hint: 'Con código de área, sin 0 ni 15.' }) +
      fld('otroTel', 'Otro teléfono', { type: 'tel', inputmode: 'tel', opt: 1, span: 'c3' }) +
      '</div><div class="sec">Tu vendedor en Corti-Fer</div><div class="grid">' +
      fld('vendedor', 'Vendedor / viajante', { ac: 'off', ph: 'Nombre y apellido (opcional)', hint: 'Si lo sabés, indicá quién te atiende en Corti-Fer.', max: 80, opt: true }) +
      '</div><div class="sec">Domicilio legal</div><div class="grid">' +
      fld('domCalle', 'Calle y número', { ac: 'address-line1', max: 200 }) +
      fld('domCiudad', 'Ciudad', { ac: 'address-level2', span: 'c3', max: 200 }) +
      fld('domProv', 'Provincia', { type: 'select', opts: A.PROV, ac: 'address-level1', span: 'c3' }) +
      fld('domCP', 'Código postal', { ac: 'postal-code', span: 'c2 keep', max: 8 }) + '</div>';

    if (s === 1) return '<h2>Entrega de productos</h2><p class="lead">Dónde y cómo querés recibir tus pedidos.</p>' +
      '<label class="check"><input type="checkbox" id="mismoDom" data-k="mismoDom"' + (D.mismoDom ? ' checked' : '') + '><span><b>Entregar en el domicilio legal</b><br><span class="hint">' +
      (esc(D.domCalle) || 'Domicilio legal') + (D.domCiudad ? ', ' + esc(D.domCiudad) : '') + '</span></span></label>' +
      '<div class="grid" id="entGrid"' + (D.mismoDom ? ' hidden' : '') + '>' +
      fld('entCalle', 'Calle y número', { max: 200 }) + fld('entCiudad', 'Ciudad', { span: 'c3', max: 200 }) + fld('entProv', 'Provincia', { type: 'select', opts: A.PROV, span: 'c3' }) +
      fld('entCP', 'Código postal', { span: 'c2 keep', max: 8 }) + fld('entTel', 'Teléfono de contacto en destino', { type: 'tel', opt: 1, span: 'c4', inputmode: 'tel' }) + '</div>' +
      '<div class="grid gap-top">' + fld('transporte', 'Transporte', { type: 'select', opts: A.TRANSP, hint: 'Seleccioná el transporte de la lista.', opt: 1 }) +
      '<div id="transporteOtroBox" class="f c6" data-f="transporteOtro"' + (D.transporte === 'Otro' ? '' : ' hidden') + '><label for="transporteOtro">¿Qué transporte? <span class="req">(obligatorio)</span></label><input id="transporteOtro" data-k="transporteOtro" type="text" maxlength="200" value="' + esc(D.transporteOtro || '') + '" placeholder="Escribí el nombre del transporte" aria-describedby="e_transporteOtro"><span class="err" id="e_transporteOtro"></span></div></div>';

    if (s === 2) {
      let h = '<h2>Referencias</h2><p class="lead">La referencia comercial es obligatoria: completá nombre y teléfono de al menos una. Las referencias bancarias son opcionales.</p><div class="sec">Referencias comerciales</div><div class="reflist">';
      for (let i = 1; i <= 3; i++) h += '<div class="refrow">' + fld('rn' + i, 'Nombre o razón social', { span: '' }) + fld('rt' + i, 'Teléfono', { type: 'tel', inputmode: 'tel', span: '' }) + fld('rc' + i, 'Contacto', { span: '' }) + '</div>';
      h += '</div><div class="sec">Referencias bancarias</div><div class="reflist">';
      for (let i = 1; i <= 3; i++) h += '<div class="refrow">' + fld('bn' + i, 'Banco', { span: '' }) + fld('bt' + i, 'Teléfono', { type: 'tel', inputmode: 'tel', span: '' }) + fld('bc' + i, 'Contacto', { span: '' }) + '</div>';
      return h + '</div>';
    }

    if (s === 3) return '<h2>Datos impositivos</h2><p class="lead">Con esto administración deja tu cuenta lista para facturar.</p><div class="grid">' +
      fld('iva', 'Condición ante el IVA', { type: 'select', opts: A.IVA }) +
      '<div class="f c6" data-f="convenio"><span class="lab" id="lbConv">¿Sos contribuyente de Convenio Multilateral?</span><div class="seg" role="radiogroup" aria-labelledby="lbConv">' +
      '<label><input type="radio" name="convenio" data-k="convenio" value="Sí"' + (D.convenio === 'Sí' ? ' checked' : '') + '>Sí</label>' +
      '<label><input type="radio" name="convenio" data-k="convenio" value="No"' + (D.convenio === 'No' ? ' checked' : '') + '>No</label></div><span class="err" id="e_convenio"></span></div>' +
      '<div id="convBox" class="contents"' + (D.convenio === 'Sí' ? '' : ' hidden') + '>' + fld('convNro', 'Número de inscripción', { span: 'c3', mono: 1, max: 30 }) +
      fileBox('cm05', 'Formulario CM05', 'Constancia de Convenio Multilateral', true) + '</div>' +
      '</div><div class="sec">Documentación</div><div class="grid">' +
      fileBox('f1276', 'Formulario 1276', 'Si corresponde a tu actividad') +
      '<div id="exBox" class="contents"' + (D.iva === 'Exento' ? '' : ' hidden') + '>' + fileBox('exencion', 'Certificado de exención de impuestos', 'Necesario si sos exento', true) + '</div></div>';

    return reviewHTML();
  }

  function filesForReview() {
    const o = {};
    Object.keys(FILES).forEach((k) => { o[k] = FILES[k].name; });
    return o;
  }
  function reviewHTML() {
    const g = A.rowsOf(A.normalize(D), filesForReview());
    let h = '<h2>Revisá y enviá</h2><p class="lead">Si algo está mal, tocá Editar. Cuando esté todo bien, enviá la solicitud.</p><div class="rev">';
    g.forEach((b) => {
      h += '<div class="revb"><div class="revh">' + b.g + '<button type="button" data-goto="' + b.step + '">Editar</button></div>';
      if (!b.r.length) h += '<p class="revempty">Sin referencias cargadas. Administración puede pedírtelas más adelante.</p>';
      else {
        h += '<dl class="kv">';
        b.r.forEach((x) => {
          const v = A.valText(x[1]);
          h += '<dt>' + esc(x[0]) + '</dt><dd' + (v ? (v === 'Pendiente' ? ' class="pend"' : '') : ' class="empty"') + '>' + (v ? esc(v) : '—') + '</dd>';
        });
        h += '</dl>';
      }
      h += '</div>';
    });
    return h + '</div><p class="legal">Al enviar, aceptás que Corti-Fer use estos datos para evaluar y gestionar tu cuenta de cliente.</p>';
  }

  /* ---------- Render ---------- */
  let lastStep = -1;
  function render() {
    if (DONE) { renderDone(); return; }
    $('#steps').innerHTML = STEPS.map((s, i) => '<li class="' + (i < step ? 'done' : i === step ? 'cur' : '') + '"><button type="button" data-goto="' + i + '"' +
      (i === step ? ' aria-current="step"' : '') + '><span class="bar"></span><span class="lbl">' + s + '</span></button></li>').join('');
    $('#stepmeta').textContent = 'Paso ' + (step + 1) + ' de ' + STEPS.length + ' · ' + STEPS[step];
    $('#savednote').hidden = false;
    $('#form').innerHTML = '<div class="errsum" id="errsum" role="alert"></div>' + view(step) +
      '<div class="nav">' + (step > 0 ? '<button type="button" class="btn" id="back">Volver</button>' : '') +
      '<button type="submit" class="btn pri r" id="next">' + (step === 4 ? 'Enviar solicitud' : 'Continuar') + '</button></div>' +
      '<p class="sending" id="sending" aria-live="polite" hidden></p>';
    STEPKEYS[step].forEach((k) => { if (D[k]) softCheck(k); });
    if (step !== lastStep) { window.scrollTo({ top: 0 }); lastStep = step; }
  }
  function renderDone() {
    $('#steps').innerHTML = ''; $('#stepmeta').textContent = ''; $('#savednote').hidden = true;
    $('#form').innerHTML = '<div class="done-box"><div class="tick"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
      '<h2>Recibimos tu solicitud</h2><p class="lead">Tu número de solicitud es</p><div class="nro">' + esc(DONE.nro) + '</div>' +
      '<ul class="next"><li><b>1</b><span>Administración revisa tus datos y la documentación.</span></li>' +
      '<li><b>2</b><span>Si falta algo, te escribimos a <strong>' + esc(DONE.email) + '</strong>.</span></li>' +
      '<li><b>3</b><span>Cuando tu cuenta esté dada de alta te llega un email con tu <strong>número de cliente</strong> y el enlace para crear tu usuario en la web.</span></li></ul>' +
      '<div class="nav"><a class="btn" href="https://www.corti-fer.com.ar/">Ir a corti-fer.com.ar</a><button type="button" class="btn r" id="again">Cargar otra solicitud</button></div></div>';
    lastStep = -1;
    window.scrollTo({ top: 0 });
  }

  /* ---------- Validación ---------- */
  function setErr(k, msg) {
    const w = document.querySelector('[data-f="' + k + '"]'); if (!w) return;
    const e = w.querySelector('.err');
    w.classList.toggle('bad', !!msg);
    if (e) {
      e.textContent = msg || '';
    }
    if (k === 'cuit') cuitWarn();
    w.classList.toggle('good', !msg && !!D[k] && k === 'cuit');
    w.querySelectorAll('input,select').forEach((inp) => inp.setAttribute('aria-invalid', msg ? 'true' : 'false'));
  }
  const softCheck = (k) => { if (RULES[k]) setErr(k, RULES[k](D[k])); };

  /* Avisos del CUIT (no impiden continuar): ya registrado y/o persona física. */
  function cuitWarn() {
    const w = $('#w_cuit'); if (!w) return;
    const c = cuitDigits(), msgs = [];
    if (A.cuitOk(c)) {
      const st = CUIT_ST[c];
      if (st && st.estado === 'cliente') msgs.push('Este CUIT ya tiene una cuenta en Corti-Fer. Si es <b>otra sucursal</b>, seguí adelante: se le asigna un número de cliente nuevo. Si ya sos cliente y solo querés comprar por la web, <a href="' + URL_REGISTRO + '" target="_blank" rel="noopener">creá tu usuario acá</a>.');
      else if (st && st.estado === 'en_curso') msgs.push('Ya hay una solicitud de alta en curso con este CUIT. Si es <b>otra sucursal</b>, seguí adelante; si no, no hace falta enviarla de nuevo.');
      if (A.esPersona(c)) msgs.push('Este número es de <b>persona física (CUIL / CUIT personal)</b>. Verificá que sea el CUIT con el que facturás.');
    }
    w.innerHTML = msgs.map((m) => '<span>' + m + '</span>').join('');
    w.hidden = !msgs.length;
  }
  function validateStep(s) {
    const bad = [];
    STEPKEYS[s].forEach((k) => { const m = RULES[k] ? RULES[k](D[k]) : ''; setErr(k, m); if (m) bad.push(k); });
    if (s === 2) {
      const hasCommercialReference = [1, 2, 3].some((i) => req(D['rn' + i]) && req(D['rt' + i]));
      if (!hasCommercialReference) {
        bad.push('rn1');
        const firstRef = document.getElementById('rn1');
        if (firstRef) {
          const msg = document.getElementById('e_rn1');
          if (msg) msg.textContent = 'Cargá al menos una referencia comercial con nombre y teléfono.';
          const wrap = firstRef.closest('.f');
          if (wrap) wrap.classList.add('bad');
        }
      }
    }
    const box = $('#errsum');
    if (box) {
      if (bad.length) {
        box.textContent = 'Revisá ' + (bad.length === 1 ? 'este campo' : 'estos ' + bad.length + ' campos') + ' antes de continuar.';
        box.classList.add('on');
        const el = document.getElementById(bad[0]) || document.querySelector('[data-f="' + bad[0] + '"] input');
        if (el) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); }
      } else box.classList.remove('on');
    }
    return !bad.length;
  }
  function firstInvalidStepBefore(to) {
    for (let s = 0; s < to; s++) if (stepHasErrors(s)) return s;
    return -1;
  }
  function showStepError(s) { step = s; render(); validateStep(s); }

  /* ---------- Borrador (vence solo; nunca queda el de otro cliente para siempre) ---------- */
  function save() {
    try { localStorage.setItem(DRAFT, JSON.stringify({ D, step, reqId, ts: Date.now() })); } catch (e) { /* sin almacenamiento */ }
  }
  function load() {
    try { OLD_DRAFTS.forEach((k) => localStorage.removeItem(k)); } catch (e) { /* nada */ }
    try {
      const j = JSON.parse(localStorage.getItem(DRAFT) || 'null');
      if (!j || !j.D || typeof j.D !== 'object') return;
      if (!j.ts || Date.now() - j.ts > DRAFT_MS) { clearDraft(); return; }
      D = j.D; step = Math.min(Math.max(+j.step || 0, 0), 4);
      if (j.reqId) reqId = String(j.reqId);
      if (Object.keys(D).some((k) => req(D[k]))) $('#resetDraft').hidden = false;
    } catch (e) { clearDraft(); }
  }
  function clearDraft() { try { localStorage.removeItem(DRAFT); } catch (e) { /* nada */ } }
  function resetAll() {
    D = {}; FILES = {}; DONE = null; step = 0; reqId = A.uid(); clearDraft();
    $('#resetDraft').hidden = true; render();
  }

  /* ---------- Envío ---------- */
  function toB64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(new Error('No se pudo leer el archivo ' + file.name + '. Volvé a adjuntarlo.'));
      r.readAsDataURL(file);
    });
  }
  function relevantFiles() {
    const keys = ['f1276'];
    if (D.convenio === 'Sí') keys.push('cm05');
    if (D.iva === 'Exento') keys.push('exencion');
    return keys.filter((k) => FILES[k]);
  }
  const RETRY = ['TIMEOUT', 'NETWORK', 'BUSY', 'HTTP', 'PARSE'];

  async function enviar() {
    if (SENDING) return;
    const s = firstInvalidStepBefore(4);
    if (s >= 0) { showStepError(s); return; }

    const keys = relevantFiles();
    const total = keys.reduce((t, k) => t + FILES[k].size, 0);
    const box = $('#errsum');
    if (total > MAX_TOTAL) {
      box.textContent = 'Los adjuntos suman más de ' + (A.CFG.MAX_TOTAL_MB || 15) + ' MB. Quitá alguno o envialo más tarde por email.';
      box.classList.add('on'); return;
    }

    SENDING = true;
    const btn = $('#next'), back = $('#back'), note = $('#sending');
    btn.disabled = true; if (back) back.disabled = true;
    btn.textContent = 'Enviando…';
    box.classList.remove('on');
    note.hidden = false; note.textContent = keys.length ? 'Subiendo tus datos y adjuntos…' : 'Enviando tus datos…';
    const slow = setTimeout(() => { note.textContent = 'Sigue enviando, puede tardar hasta un minuto. No cierres esta página.'; }, 8000);

    try {
      const files = {};
      for (const k of keys) files[k] = { name: FILES[k].name, mime: FILES[k].type, b64: await toB64(FILES[k]) };
      const data = A.normalize(D);
      const payload = { action: 'submit', reqId, data, files, hp: ($('#hp') || {}).value || '' };

      let r, lastErr;
      for (let intento = 1; intento <= 3; intento++) {
        try { r = await A.api(payload, { timeout: 90000 }); break; }
        catch (err) {
          lastErr = err;
          if (RETRY.indexOf(err.code) < 0 || intento === 3) throw err;
          note.textContent = 'La conexión se cortó. Reintentando (' + (intento + 1) + ' de 3)…';
          await new Promise((ok) => setTimeout(ok, 2500 * intento));
        }
      }
      if (!r) throw lastErr;
      DONE = { nro: r.nro, email: data.email };
      D = {}; FILES = {}; step = 0; reqId = A.uid(); clearDraft();
      $('#resetDraft').hidden = true;
      renderDone();
    } catch (err) {
      box.textContent = 'No pudimos enviar la solicitud. ' + err.message + ' Tus datos siguen cargados: podés volver a tocar "Enviar solicitud" sin riesgo de duplicarla.';
      box.classList.add('on');
      box.scrollIntoView({ block: 'center', behavior: 'smooth' });
      btn.disabled = false; if (back) back.disabled = false; btn.textContent = 'Enviar solicitud';
      note.hidden = true;
    } finally {
      clearTimeout(slow);
      SENDING = false;
    }
  }

  /* ---------- Eventos ---------- */
  const form = $('#form');
  form.addEventListener('input', (e) => {
    const t = e.target, k = t.dataset.k; if (!k) return;
    D[k] = t.type === 'checkbox' ? t.checked : t.value;
    if (k === 'cuit') {
      t.value = D.cuit = A.fmtCuit(t.value);
      if (A.cuitOk(D.cuit)) { softCheck('cuit'); checkCuitSoon(); } else cuitWarn();
    }
    if (k === 'mismoDom') $('#entGrid').hidden = D.mismoDom;
    if (k === 'transporte') { const ob = $('#transporteOtroBox'); if (ob) ob.hidden = D.transporte !== 'Otro'; if (D.transporte !== 'Otro') setErr('transporteOtro', ''); else if (!req(D.transporteOtro)) setErr('transporteOtro', 'Escribí el nombre del transporte seleccionado como Otro.'); }
    if (k === 'convenio') { $('#convBox').hidden = D.convenio !== 'Sí'; setErr('convenio', ''); }
    if (k === 'iva') $('#exBox').hidden = D.iva !== 'Exento';
    const w = t.closest('.f'); if (w && w.classList.contains('bad') && k !== 'cuit') softCheck(k);
    save();
  });
  form.addEventListener('focusout', (e) => {
    const k = e.target.dataset && e.target.dataset.k;
    if (k && RULES[k] && e.target.type !== 'radio' && D[k] !== undefined) softCheck(k);
  });
  form.addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset.file) return;
    const f = t.files && t.files[0]; if (!f) return;
    if (OK_TYPES.indexOf(f.type) < 0) { A.toast('Solo PDF, JPG o PNG.'); t.value = ''; return; }
    if (f.size > MAX_FILE) { A.toast('El archivo pesa más de ' + (A.CFG.MAX_FILE_MB || 5) + ' MB.'); t.value = ''; return; }
    FILES[t.dataset.file] = f;
    render();
  });
  form.addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rmfile]');
    if (rm) { e.preventDefault(); delete FILES[rm.dataset.rmfile]; render(); return; }
    if (e.target.id === 'back' && !SENDING) { step--; save(); render(); return; }
    if (e.target.id === 'again') resetAll();
  });
  document.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]'); if (!g || DONE || SENDING) return;
    const to = +g.dataset.goto;
    if (to > step) { const s = firstInvalidStepBefore(to); if (s >= 0) { showStepError(s); return; } }
    step = to; save(); render();
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault(); if (DONE || SENDING) return;
    if (!validateStep(step)) return;
    if (step < 4) { step++; save(); render(); return; }
    enviar();
  });
  $('#resetDraft').addEventListener('click', () => {
    if (confirm('¿Borrar los datos cargados y empezar de nuevo?')) resetAll();
  });
  window.addEventListener('beforeunload', (e) => { if (SENDING) { e.preventDefault(); e.returnValue = ''; } });

  load(); render();
  if (A.cuitOk(D.cuit)) checkCuitSoon();
})();
