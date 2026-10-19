/**
 * Alta de clientes Corti-Fer — servidor en Google Apps Script.  Versión 3.2 (2026-10-16)
 *
 * - Base de datos: hoja "Solicitudes" de la planilla vinculada a este script.
 * - Adjuntos: una subcarpeta de Drive por solicitud.
 * - Emails: aviso a administración, acuse al cliente y email de alta con el enlace de registración.
 *
 * Reglas de negocio:
 * - Un mismo envío (ID de envío) se guarda UNA sola vez aunque el navegador reintente.
 * - El CUIT PUEDE repetirse (un cliente con varias sucursales tiene un número de cliente por sucursal):
 *   no se bloquea, se AVISA al cliente, a administración (email y panel) y se anota en la planilla.
 * - También se avisa cuando el número es de persona física (CUIL / CUIT de persona: prefijos 20-27).
 * - El número de cliente es obligatorio para dar de alta y NO puede repetirse.
 * - El nombre y apellido del vendedor / viajante es opcional.
 *
 * Propiedades del script (Configuración del proyecto > Propiedades del script). setup() crea las que faltan:
 *   ADMIN_KEY        clave del panel de administración
 *   NOTIFY_TO        email(s) que reciben el aviso de solicitud nueva (separados por coma)
 *   ADMIN_URL        URL del panel, ej. https://usuario.github.io/alta-clientes/admin/
 *   DRIVE_FOLDER_ID  carpeta de Drive donde se guardan los adjuntos
 *   SEND_RECEIPT     "si" / "no": acuse de recibo al cliente
 */

const API_VERSION = '3.2';

const CONF = {
  SHEET_NAME: 'Solicitudes',
  TZ: 'America/Argentina/Buenos_Aires',
  URL_REGISTRO: 'https://www.corti-fer.com.ar/registracion.aspx?TipoRegistracion=1',
  EMPRESA: 'Corti-Fer',
  COLOR: '#E11B2A',
  MAX_FILE_MB: 5,
  MAX_TOTAL_MB: 15,
  FILE_KEYS: ['cm05', 'f1276', 'exencion'],
  MIMES: ['application/pdf', 'image/jpeg', 'image/png'],
  ESTADOS: ['Nueva', 'En revisión', 'Dada de alta', 'Rechazada'],
  ABIERTOS: ['Nueva', 'En revisión'],
  PERSONA: ['20', '23', '24', '25', '26', '27'],   // prefijos de persona física (CUIL / CUIT personal)
  NRO_CLIENTE_RE: /^[A-Z0-9][A-Z0-9\-\/.]{0,19}$/,
  LOCK_MS: 20000,
  MAX_AUTH_FAILS: 10 // intentos fallidos de clave antes de bloquear 15 minutos
};

/* [clave interna, encabezado en la planilla]. El script busca las columnas por encabezado:
   se pueden reordenar en la hoja, pero NO cambiar los textos. */
const COLS = (function () {
  const c = [
    ['nro', 'Nro solicitud'], ['fecha', 'Fecha'], ['estado', 'Estado'],
    ['razon', 'Razón social'], ['fantasia', 'Nombre de fantasía'], ['cuit', 'CUIT'], ['email', 'Email'], ['vendedor', 'Vendedor / viajante'],
    ['movil', 'Teléfono móvil'], ['otroTel', 'Otro teléfono'],
    ['domCalle', 'Legal - Calle y número'], ['domCiudad', 'Legal - Ciudad'], ['domProv', 'Legal - Provincia'], ['domCP', 'Legal - CP'],
    ['mismoDom', 'Entrega en domicilio legal'],
    ['entCalle', 'Entrega - Calle y número'], ['entCiudad', 'Entrega - Ciudad'], ['entProv', 'Entrega - Provincia'], ['entCP', 'Entrega - CP'],
    ['entTel', 'Entrega - Teléfono'], ['transporte', 'Transporte']
  ];
  for (let i = 1; i <= 3; i++) c.push(['rn' + i, 'Ref. comercial ' + i + ' - Nombre'], ['rt' + i, 'Ref. comercial ' + i + ' - Teléfono'], ['rc' + i, 'Ref. comercial ' + i + ' - Contacto']);
  for (let i = 1; i <= 3; i++) c.push(['bn' + i, 'Ref. bancaria ' + i + ' - Banco'], ['bt' + i, 'Ref. bancaria ' + i + ' - Teléfono'], ['bc' + i, 'Ref. bancaria ' + i + ' - Contacto']);
  c.push(
    ['iva', 'Condición IVA'], ['convenio', 'Convenio Multilateral'], ['convNro', 'Nro. Convenio Multilateral'],
    ['cm05', 'Formulario CM05'], ['f1276', 'Formulario 1276'], ['exencion', 'Certificado de exención'], ['carpeta', 'Carpeta Drive'],
    ['duplicado', 'Otras solicitudes mismo CUIT'], ['obs', 'Observaciones'],
    ['fechaAlta', 'Fecha de alta'], ['nroCliente', 'Número de cliente'], ['notificado', 'Email de alta enviado'],
    ['historialEmails', 'Historial de notificaciones'], ['reqId', 'ID de envío'], ['tipoCuit', 'Tipo de CUIT']
  );
  return c;
})();

/* ============================================================
 * Puntos de entrada
 * ============================================================ */

function doGet() {
  return json_({ ok: true, servicio: 'alta-clientes', version: API_VERSION });
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'Solicitud inválida.', code: 'BAD_REQUEST' });
  }
  try {
    let out;
    switch (body.action) {
      case 'submit': out = submit_(body); break;
      case 'checkCuit': out = checkCuit_(body.cuit); break;
      case 'login':
      case 'list': auth_(body.key); out = list_(); break;
      case 'setEstado': auth_(body.key); out = setEstado_(body.nro, body.estado); break;
      case 'setObs': auth_(body.key); out = setObs_(body.nro, body.obs); break;
      case 'approve': auth_(body.key); out = approve_(body.nro, body.nroCliente, !!body.force); break;
      default: out = { ok: false, error: 'Acción desconocida. ¿Está actualizada la implementación?', code: 'BAD_ACTION' };
    }
    out.version = API_VERSION;
    return json_(out);
  } catch (err) {
    if (err.user) return json_(Object.assign({ ok: false, error: err.message, code: err.code || '', version: API_VERSION }, err.extra || {}));
    console.error(err && err.stack || err);
    return json_({ ok: false, error: 'Error interno. Probá de nuevo en unos minutos.', code: 'INTERNAL', version: API_VERSION });
  }
}

/* ============================================================
 * Cliente: nueva solicitud
 * ============================================================ */

function submit_(body) {
  // Robots: completan el campo oculto. Respondemos "ok" sin guardar nada.
  if (body.hp) return { ok: true, nro: 'ALTA-0000' };

  const reqId = String(body.reqId || '').replace(/[^\w\-]/g, '').slice(0, 64);
  const d = normalize_(body.data || {});
  const errs = validate_(d);
  if (errs.length) fail_('Revisá estos datos: ' + errs.join(', ') + '.', 'VALIDATION');
  const files = checkFiles_(body.files || {}, d);

  let nro, rowIndex, dup;
  withLock_(function () {
    const T = table_();

    // 1) Idempotencia: el mismo envío reintentado devuelve el mismo número, sin duplicar.
    if (reqId) {
      const prev = T.recs.filter(function (r) { return r.reqId === reqId; })[0];
      if (prev) { nro = prev.nro; return; }
    }

    // 2) CUIT repetido: se permite (sucursales), pero queda anotado para avisar.
    dup = describeSame_(T.recs.filter(function (r) { return r.cuit === d.cuit; }));

    // 3) Número correlativo: nunca repite, aunque se borre la propiedad o se copie el proyecto.
    nro = nextNro_(T.recs);

    const rec = Object.assign({}, d, {
      nro: nro, fecha: now_(), estado: 'Nueva', reqId: reqId, tipoCuit: tipoCuit_(d.cuit),
      mismoDom: d.mismoDom ? 'Sí' : 'No', duplicado: dup
    });
    rowIndex = appendRecord_(T, rec);
    SpreadsheetApp.flush();
  });
  if (!rowIndex) return { ok: true, nro: nro, repetido: true };

  // Adjuntos y emails fuera del bloqueo (Drive y Mail pueden tardar)
  const extra = {};
  if (Object.keys(files).length) {
    try {
      const folder = DriveApp.getFolderById(prop_('DRIVE_FOLDER_ID')).createFolder(nro + ' - ' + d.razon.slice(0, 60));
      Object.keys(files).forEach(function (k) { extra[k] = folder.createFile(files[k]).getUrl(); });
      extra.carpeta = folder.getUrl();
    } catch (err) {
      console.error('Adjuntos ' + nro + ': ' + err);
      extra.obs = 'No se pudieron guardar los adjuntos. Pedírselos al cliente.';
    }
    try { updateByNro_(nro, extra); } catch (err) { console.error('Guardar links ' + nro + ': ' + err); }
  }

  try { mailAdmin_(Object.assign({}, d, extra, { nro: nro, duplicado: dup, tipoCuit: tipoCuit_(d.cuit) })); } catch (err) { console.error('Mail admin ' + nro + ': ' + err); }
  if (String(prop_('SEND_RECEIPT') || 'si').toLowerCase() !== 'no') {
    try { mailReceipt_(d, nro); } catch (err) { console.error('Mail acuse ' + nro + ': ' + err); }
  }
  return { ok: true, nro: nro };
}

/* Consulta rápida desde el formulario: ¿este CUIT ya está registrado? ¿es de persona física?
   Solo informa: no bloquea nada (un cliente puede sumar sucursales con el mismo CUIT). */
function checkCuit_(cuit) {
  cuit = String(cuit || '').replace(/\D/g, '');
  if (!cuitOk_(cuit)) return { ok: true, estado: 'invalido' };
  const recs = table_().recs.filter(function (r) { return r.cuit === cuit && r.estado !== 'Rechazada'; });
  const out = { ok: true, tipo: tipoCuit_(cuit), estado: 'libre' };
  if (recs.some(function (r) { return r.estado === 'Dada de alta'; })) out.estado = 'cliente';
  else if (recs.length) out.estado = 'en_curso';
  return out;
}

/* "Persona física (CUIL)" para prefijos 20–27, "Empresa" para 30/33/34. */
function tipoCuit_(cuit) { return CONF.PERSONA.indexOf(String(cuit).slice(0, 2)) >= 0 ? 'Persona física (CUIL)' : 'Empresa'; }

/* Texto para la columna "Otras solicitudes mismo CUIT": nro, estado y número de cliente. */
function describeSame_(recs) {
  return recs.map(function (r) { return r.nro + ' (' + r.estado + (r.nroCliente ? ', cliente ' + r.nroCliente : '') + ')'; }).join(', ');
}

function nextNro_(recs) {
  const year = Utilities.formatDate(new Date(), CONF.TZ, 'yyyy');
  const P = PropertiesService.getScriptProperties();
  const re = new RegExp('^ALTA-' + year + '-(\\d+)$');
  let max = Number(P.getProperty('SEQ_' + year) || '0');
  recs.forEach(function (r) { const m = re.exec(r.nro); if (m) max = Math.max(max, Number(m[1])); });
  const seq = max + 1;
  P.setProperty('SEQ_' + year, String(seq));
  return 'ALTA-' + year + '-' + ('0000' + seq).slice(-4);
}

function checkFiles_(files, d) {
  const out = {};
  const allowed = { f1276: true, cm05: d.convenio === 'Sí', exencion: d.iva === 'Exento' };
  let total = 0;
  CONF.FILE_KEYS.forEach(function (k) {
    const f = files[k];
    if (!f || !allowed[k]) return;
    if (CONF.MIMES.indexOf(f.mime) < 0) fail_('Tipo de archivo no permitido. Solo PDF, JPG o PNG.', 'FILE');
    let bytes;
    try { bytes = Utilities.base64Decode(String(f.b64 || '')); } catch (e) { fail_('Un archivo adjunto llegó dañado. Volvé a adjuntarlo.', 'FILE'); }
    if (!bytes.length) return;
    if (bytes.length > CONF.MAX_FILE_MB * 1024 * 1024) fail_('Un archivo supera los ' + CONF.MAX_FILE_MB + ' MB.', 'FILE');
    total += bytes.length;
    const ext = f.mime === 'application/pdf' ? '.pdf' : f.mime === 'image/png' ? '.png' : '.jpg';
    const label = { cm05: 'CM05', f1276: 'F1276', exencion: 'Exencion' }[k];
    const safe = String(f.name || '').replace(/\.[^.]+$/, '').replace(/[^\w\-. ]+/g, '').slice(0, 60);
    out[k] = Utilities.newBlob(bytes, f.mime, label + (safe ? ' - ' + safe : '') + ext);
  });
  if (total > CONF.MAX_TOTAL_MB * 1024 * 1024) fail_('Los adjuntos suman más de ' + CONF.MAX_TOTAL_MB + ' MB.', 'FILE');
  return out;
}

/* ============================================================
 * Administración
 * ============================================================ */

function auth_(key) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('authFails') || '0');
  if (fails >= CONF.MAX_AUTH_FAILS) fail_('Demasiados intentos fallidos. Esperá 15 minutos.', 'LOCKED');
  const real = prop_('ADMIN_KEY');
  if (!real) fail_('El servidor no tiene clave de administración configurada (ejecutá setup).', 'CONFIG');
  if (!safeEqual_(String(key || ''), real)) {
    cache.put('authFails', String(fails + 1), 900);
    fail_('Clave incorrecta.', 'AUTH');
  }
  if (fails) cache.remove('authFails');
}

/* Devuelve todas las solicitudes completas (la más nueva primero): el panel abre cada ficha
   sin volver a consultar al servidor. */
function list_() {
  const items = table_().recs.map(publicRecord_).reverse();
  return { ok: true, items: items };
}

function setEstado_(nro, estado) {
  if (['Nueva', 'En revisión', 'Rechazada'].indexOf(estado) < 0) fail_('Estado no válido.', 'VALIDATION');
  return withLock_(function () {
    const T = table_();
    const f = findIn_(T, nro);
    if (f.rec.estado === 'Dada de alta') fail_('La solicitud ya está dada de alta.', 'STATE');
    return { ok: true, item: publicRecord_(writeRec_(T, f, { estado: estado })) };
  });
}

function setObs_(nro, obs) {
  return withLock_(function () {
    const T = table_();
    const f = findIn_(T, nro);
    return { ok: true, item: publicRecord_(writeRec_(T, f, { obs: String(obs || '').slice(0, 2000) })) };
  });
}

/* Dar de alta (o reenviar el email de alta). El alta queda guardada aunque el email falle. */
function approve_(nro, nroCliente, force) {
  return withLock_(function () {
    const T = table_();
    const f = findIn_(T, nro);
    let r = f.rec;
    if (r.estado === 'Rechazada') fail_('La solicitud está rechazada. Pasala a "En revisión" antes de darla de alta.', 'STATE');
    if (r.notificado && !force) fail_('El email de alta ya se envió el ' + r.notificado + '. Usá "Reenviar email".', 'ALREADY');
    if (!isMail_(r.email)) fail_('El email del cliente no es válido. Corregilo en la planilla.', 'VALIDATION');

    nroCliente = normNroCliente_(nroCliente || r.nroCliente);
    if (!nroCliente) fail_('Ingresá el número de cliente.', 'CLIENT_NUMBER');
    if (!CONF.NRO_CLIENTE_RE.test(nroCliente)) fail_('Número de cliente no válido: usá solo números o letras (hasta 20).', 'CLIENT_NUMBER');

    // El CUIT puede repetirse (sucursales); el número de cliente, nunca.
    T.recs.forEach(function (o) {
      if (o.nro === r.nro) return;
      if (o.nroCliente && normNroCliente_(o.nroCliente) === nroCliente) fail_('El número de cliente ' + nroCliente + ' ya está asignado a ' + o.razon + ' (' + o.nro + ').', 'CLIENT_NUMBER_DUP');
    });

    const hist = (r.historialEmails ? r.historialEmails + '\n' : '') + now_() + ' · envío a ' + r.email + ' (cliente ' + nroCliente + ')';
    r = writeRec_(T, f, { estado: 'Dada de alta', nroCliente: nroCliente, fechaAlta: r.fechaAlta || now_(), historialEmails: hist + ' · enviando…' });
    SpreadsheetApp.flush();

    try {
      mailAlta_(r);
    } catch (err) {
      console.error('Mail alta ' + nro + ': ' + err);
      r = writeRec_(T, f, { historialEmails: hist + ' · ERROR: ' + String(err && err.message || err).slice(0, 200) });
      fail_('El cliente quedó dado de alta, pero el email no se pudo enviar. Probá "Enviar email de alta" de nuevo.', 'MAIL', { item: publicRecord_(r) });
    }
    r = writeRec_(T, f, { notificado: now_(), historialEmails: hist + ' · ENVIADO' });
    return { ok: true, item: publicRecord_(r) };
  });
}

function normNroCliente_(v) { return String(v || '').trim().toUpperCase().replace(/\s+/g, ''); }

/* ============================================================
 * Emails
 * ============================================================ */

function mailAdmin_(r) {
  const to = prop_('NOTIFY_TO');
  if (!to) return;
  const link = prop_('ADMIN_URL') ? prop_('ADMIN_URL').replace(/\/?$/, '/') + '?nro=' + encodeURIComponent(r.nro) : '';
  const adj = [['cm05', 'CM05'], ['f1276', 'Formulario 1276'], ['exencion', 'Exención']]
    .filter(function (x) { return r[x[0]]; }).map(function (x) { return x[1]; }).join(', ') || 'Ninguno';
  const rows = [
    ['Razón social', r.razon], ['Nombre de fantasía', r.fantasia], ['CUIT', fmtCuit_(r.cuit) + ' · ' + r.tipoCuit], ['Email', r.email],
    ['Vendedor / viajante', r.vendedor],
    ['Teléfono', r.movil], ['Localidad', r.domCiudad + ', ' + r.domProv], ['Condición IVA', r.iva],
    ['Convenio Multilateral', r.convenio], ['Adjuntos', adj]
  ];
  let html = '<p>Entró una nueva solicitud de alta de cliente: <b>' + h_(r.nro) + '</b>.</p>' + tableHtml_(rows);
  if (r.duplicado) html += '<p style="color:#8A5700;background:#FDF1D8;padding:10px 12px;border-radius:6px"><b>CUIT repetido:</b> ya figura en ' + h_(r.duplicado) + '. Si es otra sucursal, asignale un número de cliente distinto.</p>';
  if (r.tipoCuit && r.tipoCuit.indexOf('Persona') === 0) html += '<p style="color:#8A5700;background:#FDF1D8;padding:10px 12px;border-radius:6px"><b>CUIL / persona física:</b> el número empieza con ' + h_(r.cuit.slice(0, 2)) + '. Verificá que sea el CUIT con el que factura.</p>';
  if (link) html += button_(link, 'Abrir en el panel');
  MailApp.sendEmail({
    to: to,
    replyTo: r.email,
    name: CONF.EMPRESA + ' · Altas',
    subject: (r.duplicado ? '[CUIT repetido] ' : '') + 'Nueva solicitud de alta: ' + r.razon + ' (' + r.nro + ')',
    htmlBody: wrap_(html),
    body: 'Nueva solicitud de alta ' + r.nro + '\n' + rows.map(function (x) { return x[0] + ': ' + x[1]; }).join('\n') +
      (r.duplicado ? '\n\nCUIT REPETIDO: ya figura en ' + r.duplicado : '') + (link ? '\n\nPanel: ' + link : '')
  });
}

function mailReceipt_(d, nro) {
  const html = '<p>Hola,</p><p>Recibimos la solicitud de alta de <b>' + h_(d.razon) + '</b>. Tu número de solicitud es <b>' + h_(nro) + '</b>.</p>' +
    '<p>Administración va a revisar tus datos. Si falta algo, te escribimos a este email. Cuando tu cuenta esté dada de alta te vamos a enviar tu número de cliente y el enlace para crear tu usuario en la web.</p>' +
    '<p>Gracias,<br>' + CONF.EMPRESA + '</p>';
  MailApp.sendEmail({
    to: d.email,
    name: CONF.EMPRESA,
    subject: 'Recibimos tu solicitud de alta (' + nro + ')',
    htmlBody: wrap_(html),
    body: 'Recibimos la solicitud de alta de ' + d.razon + '. Número: ' + nro + '.\nCuando tu cuenta esté dada de alta te enviamos tu número de cliente y el enlace para crear tu usuario en la web.\n\n' + CONF.EMPRESA
  });
}

function mailAlta_(r) {
  const nombre = r.fantasia || r.razon;
  const html = '<p>Hola <b>' + h_(nombre) + '</b>,</p>' +
    '<p>¡Tu cuenta de cliente en ' + CONF.EMPRESA + ' ya está dada de alta!</p>' +
    tableHtml_([['Número de cliente', r.nroCliente], ['CUIT', fmtCuit_(r.cuit)], ['Razón social', r.razon]].concat(r.vendedor ? [['Tu vendedor', r.vendedor]] : [])) +
    '<p>Para ver precios y hacer pedidos, creá tu usuario en nuestra web con estos datos y este mismo email:</p>' +
    button_(CONF.URL_REGISTRO, 'Crear mi cuenta') +
    '<p style="font-size:13px;color:#555">Si el botón no funciona, copiá este enlace en el navegador:<br>' + h_(CONF.URL_REGISTRO) + '</p>' +
    '<p>Gracias por elegirnos,<br>' + CONF.EMPRESA + '</p>';
  MailApp.sendEmail({
    to: r.email,
    name: CONF.EMPRESA,
    subject: 'Tu cuenta en ' + CONF.EMPRESA + ' está activa · Cliente N° ' + r.nroCliente,
    htmlBody: wrap_(html),
    body: 'Hola ' + nombre + ',\n\nTu cuenta de cliente en ' + CONF.EMPRESA + ' ya está dada de alta.\n' +
      'Número de cliente: ' + r.nroCliente + '\nCUIT: ' + fmtCuit_(r.cuit) + '\n\n' +
      'Creá tu usuario en: ' + CONF.URL_REGISTRO + '\n\n' + CONF.EMPRESA
  });
}

function wrap_(inner) {
  return '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#161616;max-width:560px">' +
    '<div style="border-top:4px solid ' + CONF.COLOR + ';padding-top:6px;margin-bottom:16px;font:700 20px Arial,sans-serif;font-style:italic;color:' + CONF.COLOR + '">' + CONF.EMPRESA + '</div>' +
    inner + '</div>';
}
function button_(url, text) {
  return '<p style="margin:20px 0"><a href="' + h_(url) + '" style="background:' + CONF.COLOR + ';color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600;display:inline-block">' + h_(text) + '</a></p>';
}
function tableHtml_(rows) {
  return '<table style="border-collapse:collapse;font-size:14px">' + rows.map(function (x) {
    return '<tr><td style="padding:4px 14px 4px 0;color:#555">' + h_(x[0]) + '</td><td style="padding:4px 0"><b>' + h_(x[1] || '—') + '</b></td></tr>';
  }).join('') + '</table>';
}

/* ============================================================
 * Normalización y validación (igual que assets/js/common.js)
 * ============================================================ */

function normalize_(D) {
  const up = function (v) { return String(v || '').trim().toUpperCase().slice(0, 200); };
  const tr = function (v) { return String(v || '').trim().slice(0, 200); };
  const ph = function (v) { return String(v || '').replace(/\D/g, '').replace(/^0+/, '').slice(0, 15); };
  const m = D.mismoDom === true || D.mismoDom === 'Sí';
  const o = {
    razon: up(D.razon), fantasia: tr(D.fantasia), cuit: String(D.cuit || '').replace(/\D/g, ''),
    email: tr(D.email).toLowerCase(), vendedor: nombre_(D.vendedor), movil: ph(D.movil), otroTel: ph(D.otroTel),
    domCalle: up(D.domCalle), domCiudad: up(D.domCiudad), domProv: tr(D.domProv), domCP: up(D.domCP),
    mismoDom: m,
    entCalle: up(m ? D.domCalle : D.entCalle), entCiudad: up(m ? D.domCiudad : D.entCiudad),
    entProv: tr(m ? D.domProv : D.entProv), entCP: up(m ? D.domCP : D.entCP),
    entTel: ph(D.entTel), transporte: tr(D.transporte),
    iva: tr(D.iva), convenio: tr(D.convenio), convNro: D.convenio === 'Sí' ? tr(D.convNro) : ''
  };
  for (let i = 1; i <= 3; i++) {
    o['rn' + i] = tr(D['rn' + i]); o['rt' + i] = ph(D['rt' + i]); o['rc' + i] = tr(D['rc' + i]);
    o['bn' + i] = tr(D['bn' + i]); o['bt' + i] = ph(D['bt' + i]); o['bc' + i] = tr(D['bc' + i]);
  }
  return o;
}

function validate_(d) {
  const e = [];
  const cp = function (v) { return /^\d{4}$/.test(v) || /^[A-Z]\d{4}[A-Z]{3}$/.test(v); };
  if (!d.razon) e.push('razón social');
  if (!cuitOk_(d.cuit)) e.push('CUIT');
  if (!isMail_(d.email)) e.push('email');
  if (d.vendedor && !nombreOk_(d.vendedor)) e.push('nombre y apellido del vendedor / viajante');
  if (d.movil.length !== 10) e.push('teléfono móvil');
  if (!d.domCalle || !d.domCiudad || !d.domProv || !cp(d.domCP)) e.push('domicilio legal');
  if (!d.mismoDom && (!d.entCalle || !d.entCiudad || !d.entProv || !cp(d.entCP))) e.push('domicilio de entrega');
  if (['Responsable Inscripto', 'Monotributo', 'Exento', 'No Responsable', 'Consumidor Final'].indexOf(d.iva) < 0) e.push('condición ante el IVA');
  if (['Sí', 'No'].indexOf(d.convenio) < 0) e.push('Convenio Multilateral');
  if (d.convenio === 'Sí' && !d.convNro) e.push('número de Convenio Multilateral');
  return e;
}

/* CUIT/CUIL: prefijo válido + dígito verificador módulo 11.
   Cuando el cálculo da 10, ARCA asigna OTRO prefijo (23/24/33/34) y el CUIT resultante
   se valida igual que cualquier otro: por eso un resultado 10 siempre es inválido. */
function cuitOk_(s) {
  s = String(s || '');
  if (!/^\d{11}$/.test(s)) return false;
  if (['20', '23', '24', '25', '26', '27', '30', '33', '34'].indexOf(s.slice(0, 2)) < 0) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let t = 0;
  for (let i = 0; i < 10; i++) t += w[i] * Number(s[i]);
  let dv = 11 - (t % 11);
  if (dv === 11) dv = 0;
  return dv !== 10 && dv === Number(s[10]);
}
/* Nombre y apellido: espacios normalizados y Mayúscula Inicial ("juan  PEREZ" → "Juan Perez"). */
function nombre_(v) {
  return String(v || '').replace(/\s+/g, ' ').trim().slice(0, 80).toLowerCase()
    .replace(/(^|[\s'-])([a-záéíóúüñ])/g, function (m, a, b) { return a + b.toUpperCase(); });
}
/* Al menos dos palabras de 2+ letras, solo letras, espacios, apóstrofo, punto o guion. */
function nombreOk_(v) {
  v = String(v || '');
  return /^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ' .\-]+$/.test(v) && v.split(' ').filter(function (w) { return w.replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, '').length >= 2; }).length >= 2;
}
function isMail_(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '')); }
function fmtCuit_(s) { s = String(s || ''); return s.length === 11 ? s.slice(0, 2) + '-' + s.slice(2, 10) + '-' + s.slice(10) : s; }

/* ============================================================
 * Planilla: UNA lectura por pedido y UNA escritura por fila
 * ============================================================ */

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONF.SHEET_NAME);
  if (!sh) throw new Error('No existe la hoja "' + CONF.SHEET_NAME + '". Ejecutá setup().');
  return sh;
}

/* Lee encabezados y datos en una sola llamada a la planilla. */
function table_() {
  const sh = sheet_();
  const lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) throw new Error('La hoja está vacía. Ejecutá setup().');
  const all = sh.getRange(1, 1, lastRow, lastCol).getDisplayValues();
  const heads = all[0];
  const map = {};
  COLS.forEach(function (c) { const i = heads.indexOf(c[1]); if (i >= 0) map[c[0]] = i; });
  if (map.nro === undefined) throw new Error('La hoja no tiene la columna "Nro solicitud". Ejecutá setup().');
  const rows = all.slice(1);
  const recs = [];
  rows.forEach(function (row, i) {
    const r = rowToRec_(row, map);
    r._row = i + 2;
    if (r.nro) recs.push(r);
  });
  return { sh: sh, map: map, width: lastCol, rows: rows, recs: recs };
}

function rowToRec_(row, map) {
  const r = {};
  COLS.forEach(function (c) { r[c[0]] = map[c[0]] !== undefined ? String(row[map[c[0]]] || '') : ''; });
  return r;
}

function findIn_(T, nro) {
  nro = String(nro || '').trim();
  if (!nro) fail_('Falta el número de solicitud.', 'VALIDATION');
  const rec = T.recs.filter(function (r) { return r.nro === nro; })[0];
  if (!rec) fail_('No se encontró la solicitud ' + nro + '. Tocá Actualizar.', 'NOTFOUND');
  return { row: rec._row, rec: rec };
}

function appendRecord_(T, rec) {
  const row = new Array(T.width).fill('');
  Object.keys(T.map).forEach(function (k) { if (rec[k] !== undefined) row[T.map[k]] = cell_(rec[k]); });
  const r = T.sh.getLastRow() + 1;
  T.sh.getRange(r, 1, 1, T.width).setNumberFormat('@').setValues([row]);
  return r;
}

/* Escribe solo las celdas que cambian (Apps Script las agrupa en un único envío) y no toca
   el resto de la fila, así no se pisan columnas o fórmulas agregadas a mano. Sin lecturas extra. */
function writeRec_(T, f, changes) {
  Object.keys(changes).forEach(function (k) {
    if (T.map[k] === undefined) return;
    T.sh.getRange(f.row, T.map[k] + 1).setNumberFormat('@').setValue(cell_(changes[k]));
    f.rec[k] = String(changes[k] == null ? '' : changes[k]);
  });
  return f.rec;
}

function updateByNro_(nro, changes) {
  withLock_(function () { const T = table_(); writeRec_(T, findIn_(T, nro), changes); });
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(CONF.LOCK_MS)) fail_('El sistema está ocupado. Probá de nuevo en unos segundos.', 'BUSY');
  try { return fn(); } finally { lock.releaseLock(); }
}

/* El panel recibe mismoDom como booleano; sin datos internos. */
function publicRecord_(r) {
  const o = Object.assign({}, r);
  o.mismoDom = r.mismoDom === 'Sí';
  delete o._row;
  delete o.reqId;
  return o;
}

/* ============================================================
 * Utilidades
 * ============================================================ */

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function prop_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }
function now_() { return Utilities.formatDate(new Date(), CONF.TZ, 'yyyy-MM-dd HH:mm'); }
function fail_(msg, code, extra) { const e = new Error(msg); e.user = true; e.code = code || ''; e.extra = extra; throw e; }
function h_(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
/* Evita que un texto del cliente se interprete como fórmula en la planilla. */
function cell_(v) { v = String(v == null ? '' : v); return /^[=+\-@]/.test(v) ? "'" + v : v; }
function safeEqual_(a, b) {
  const ha = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, a);
  const hb = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, b);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha[i] ^ hb[i];
  return diff === 0;
}

/* ============================================================
 * Instalación: ejecutar setup() UNA vez (y de nuevo tras cada actualización: agrega columnas nuevas)
 * ============================================================ */

function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(CONF.SHEET_NAME) || ss.insertSheet(CONF.SHEET_NAME);
  const heads = COLS.map(function (c) { return c[1]; });

  if (sh.getLastRow() === 0) {
    if (sh.getMaxColumns() < heads.length) sh.insertColumnsAfter(sh.getMaxColumns(), heads.length - sh.getMaxColumns());
    sh.getRange(1, 1, 1, heads.length).setValues([heads]).setFontWeight('bold').setBackground('#FDE8EA');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(4);
  } else {
    const cur = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const missing = heads.filter(function (h) { return cur.indexOf(h) < 0; });
    if (missing.length) {
      const start = sh.getLastColumn() + 1;
      if (sh.getMaxColumns() < start + missing.length - 1) sh.insertColumnsAfter(sh.getMaxColumns(), start + missing.length - 1 - sh.getMaxColumns());
      sh.getRange(1, start, 1, missing.length).setValues([missing]).setFontWeight('bold').setBackground('#FDE8EA');
    }
  }
  // Todo como texto: que no se pierdan ceros ni se conviertan CUIT/teléfonos en números
  sh.getRange(2, 1, Math.max(sh.getMaxRows() - 1, 1), sh.getMaxColumns()).setNumberFormat('@');

  const P = PropertiesService.getScriptProperties();
  if (!P.getProperty('ADMIN_KEY')) P.setProperty('ADMIN_KEY', Utilities.getUuid().replace(/-/g, '').slice(0, 20));
  if (!P.getProperty('NOTIFY_TO')) P.setProperty('NOTIFY_TO', Session.getEffectiveUser().getEmail());
  if (!P.getProperty('SEND_RECEIPT')) P.setProperty('SEND_RECEIPT', 'si');
  if (!P.getProperty('DRIVE_FOLDER_ID')) P.setProperty('DRIVE_FOLDER_ID', DriveApp.createFolder('Altas de clientes - documentación').getId());
  if (!P.getProperty('ADMIN_URL')) P.setProperty('ADMIN_URL', '');

  completarTipoCuit_();
  const dups = revisarDuplicados();
  Logger.log('Listo. Versión ' + API_VERSION + '. Hoja: ' + CONF.SHEET_NAME);
  Logger.log('Clave de administración: ' + P.getProperty('ADMIN_KEY'));
  Logger.log('Avisos a: ' + P.getProperty('NOTIFY_TO'));
  Logger.log('Carpeta de adjuntos: https://drive.google.com/drive/folders/' + P.getProperty('DRIVE_FOLDER_ID'));
  if (!P.getProperty('ADMIN_URL')) Logger.log('Falta completar ADMIN_URL con la URL del panel en GitHub Pages.');
  Logger.log('Cupo de emails restante hoy: ' + MailApp.getRemainingDailyQuota());
  if (dups) Logger.log('ATENCIÓN: hay números de solicitud o de cliente repetidos, ver arriba.');
}

/* Completa "Tipo de CUIT" en filas viejas que no lo tienen. */
function completarTipoCuit_() {
  const T = table_();
  if (T.map.tipoCuit === undefined) return;
  T.recs.forEach(function (r) { if (!r.tipoCuit && r.cuit) writeRec_(T, { row: r._row, rec: r }, { tipoCuit: tipoCuit_(r.cuit) }); });
}

/* Informe de duplicados existentes (de versiones anteriores). No borra nada: solo lista. */
function revisarDuplicados() {
  const T = table_();
  const by = function (key) {
    const m = {};
    T.recs.forEach(function (r) { if (r[key]) (m[r[key]] = m[r[key]] || []).push(r); });
    return Object.keys(m).filter(function (k) { return m[k].length > 1; }).map(function (k) { return [k, m[k]]; });
  };
  let n = 0;
  by('nro').forEach(function (x) { n++; Logger.log('Nro de solicitud repetido ' + x[0] + ' en filas ' + x[1].map(function (r) { return r._row; }).join(', ')); });
  // CUIT repetido es válido (sucursales): solo se informa para revisar.
  by('cuit').forEach(function (x) {
    const vivos = x[1].filter(function (r) { return r.estado !== 'Rechazada'; });
    if (vivos.length > 1) Logger.log('Info: CUIT ' + fmtCuit_(x[0]) + ' en ' + vivos.length + ' solicitudes (¿sucursales?): ' + describeSame_(vivos));
  });
  by('nroCliente').forEach(function (x) { n++; Logger.log('Número de cliente ' + x[0] + ' repetido en: ' + x[1].map(function (r) { return r.nro; }).join(', ')); });
  if (!n) Logger.log('Sin duplicados.');
  return n;
}

/* Prueba del email de alta: llega a tu propia cuenta. */
function probarEmailAlta() {
  mailAlta_({ razon: 'CLIENTE DE PRUEBA S.R.L.', fantasia: '', cuit: '30712345671', nroCliente: '12345', vendedor: 'Juan Pérez', email: Session.getEffectiveUser().getEmail() });
}
