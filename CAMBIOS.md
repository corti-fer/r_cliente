# Cambios de la versión 3.2 (16/10/2026)

## CUIT repetido: ahora avisa, no bloquea

Un cliente que ya tiene cuenta puede dar de alta **otras sucursales con el mismo CUIT**, cada una con su propio número de cliente en Magnus. Por eso se quitaron los bloqueos de la versión 3.0 y se reemplazaron por avisos:

| Dónde | Qué se ve |
|---|---|
| Formulario, paso 1 | Apenas escribe el CUIT, un aviso amarillo: "Este CUIT ya tiene una cuenta en Corti-Fer. Si es **otra sucursal**, seguí adelante…", con el enlace para crear su usuario web por si ya era cliente. Si tiene una solicitud en curso, se lo dice. **Puede continuar igual.** |
| Email a administración | El asunto empieza con **[CUIT repetido]** y el cuerpo lista las otras solicitudes con su estado y número de cliente. |
| Panel, lista | Etiqueta "CUIT repetido" en cada solicitud que comparte CUIT (las rechazadas no cuentan). |
| Panel, ficha | Aviso con las otras solicitudes (link, estado, número de cliente y razón social), **arriba** del botón de alta. |
| Confirmación de alta | Si el CUIT ya es cliente: "ATENCIÓN: este CUIT ya es cliente (N° 10458). Se crea otra cuenta para esta sucursal." |
| Planilla | La columna "Otras solicitudes mismo CUIT" ahora incluye el número de cliente de cada una. |

Lo que **sigue protegido**:
- **El número de cliente no puede repetirse nunca.** Cada sucursal necesita uno distinto.
- **El mismo envío no se guarda dos veces**, gracias al ID de envío.

También se volvió a permitir reabrir una solicitud rechazada aunque el CUIT tenga otras.

## Aviso de CUIL / persona física

Los números que empiezan con **20, 23, 24, 25, 26 o 27** son de persona física (CUIL o CUIT personal, como el de un monotributista). No se bloquean, pero se avisa:
- **Al cliente:** "Este número es de persona física (CUIL / CUIT personal). Verificá que sea el CUIT con el que facturás."
- **A administración:** en el email y en la ficha, y en la confirmación de alta aparece "(persona física / CUIL)".
- **En la planilla:** queda en la columna nueva **"Tipo de CUIT"** ("Persona física (CUIL)" o "Empresa"). `setup()` la completa también en las filas que ya existían.

## Campo obligatorio: Vendedor / viajante

- Va en el paso 1, en la sección **"Tu vendedor en Corti-Fer"**, con la ayuda "Nombre y apellido de la persona de Corti-Fer que te atiende".
- **Obligatorio**, con nombre y apellido: al menos dos palabras de 2 letras o más, sin números. Si escriben solo "Juan", se les pide el apellido.
- Se guarda prolijo: "juan  PÉREZ" queda "Juan Pérez".
- Aparece en:
  - la revisión antes de enviar
  - la planilla (columna nueva **"Vendedor / viajante"**)
  - el email a administración
  - la ficha del panel, debajo de la razón social
  - "Copiar fila" y el Excel
  - el email de alta al cliente, como "Tu vendedor"
- La búsqueda del panel también encuentra por vendedor.

## Para actualizar desde la 3.0 / 3.1

1. Pegá el `Code.gs` nuevo en Apps Script.
2. Ejecutá **`setup`**: agrega las columnas "Vendedor / viajante" y "Tipo de CUIT".
3. Publicá la implementación: **Implementar → Administrar implementaciones → ✏️ → Nueva versión**.
4. Subí los archivos de la web. Ya tienen `?v=3.2`, así que los navegadores bajan los nuevos.

Las solicitudes cargadas antes de esta versión no tienen vendedor: en la ficha simplemente no aparece.

## Pruebas

- **Servidor (43 casos, todos OK).** Se agregaron:
  - vendedor obligatorio y con apellido
  - CUIT repetido aceptado y avisado en el email
  - CUIL detectado
  - mismo CUIT dado de alta como sucursal con otro número
  - número de cliente repetido sigue rechazado
  - `revisarDuplicados` trata el CUIT repetido como información
- **Navegador:**
  - aviso de CUIT ya cliente (sin error) y de CUIL
  - vendedor vacío y con un solo nombre
  - envío con corte de conexión sin duplicar
  - panel con etiqueta y aviso de CUIT repetido
  - confirmación con "ATENCIÓN"
  - aviso de persona física
  - sin errores de JavaScript

---

# Cambios de la versión 3.0 (16/10/2026)

> Nota: en la 3.2 el bloqueo por CUIT repetido (puntos 1 y 5) se cambió por avisos. Ver arriba.

Revisión completa de la versión que se nos envió (`corti-fer-alta-corregido.zip`). Abajo están los errores encontrados, la causa de cada uno y cómo quedó resuelto.

---

## 1. Registros duplicados

| Problema | Causa | Solución |
|---|---|---|
| La misma solicitud quedaba guardada dos veces | El navegador cortaba la espera a los **25 segundos**, pero Apps Script seguía trabajando (Drive y emails tardan más) y la fila **sí se guardaba**. El cliente veía un error, tocaba "Enviar" de nuevo y se creaba una segunda fila. | Cada envío lleva un **ID de envío** único. Si llega dos veces, el servidor devuelve el mismo número de solicitud y no crea otra fila ni manda otro email. Ahora la espera es de 90 s, con hasta **3 reintentos automáticos** seguros. |
| Un mismo CUIT podía cargar varias solicitudes | El CUIT repetido solo generaba un aviso, no se bloqueaba. | Ahora se rechaza si el CUIT **ya es cliente** ("Dada de alta") o si tiene una solicitud **abierta** ("Nueva" o "En revisión"). Si la anterior está "Rechazada", puede volver a pedir el alta. |
| Un mismo CUIT podía darse de alta dos veces | No había ningún control al aprobar. | El servidor no deja aprobar un CUIT que ya está dado de alta en otra solicitud, y el panel muestra el aviso con un link a esa solicitud. |
| El número de solicitud podía repetirse (ALTA-2026-0001 dos veces) | El correlativo dependía solo de una propiedad del script, que se pierde al copiar o recrear el proyecto. | Ahora se toma el mayor entre esa propiedad y el número más alto que ya está en la planilla. |
| El número de cliente podía repetirse | No se controlaba. | Se rechaza un número que ya tiene otro cliente, y el error dice cuál. |
| Hay duplicados de antes de esta versión | — | Nueva función **`revisarDuplicados()`** en Apps Script. Lista números de solicitud, CUIT y números de cliente repetidos. **No borra nada.** `setup()` la ejecuta sola. |

## 2. "Guarda los datos en caché"

| Problema | Causa | Solución |
|---|---|---|
| El formulario aparecía lleno con los datos de un cliente anterior | El borrador quedaba guardado en el navegador **para siempre**: en una PC compartida, el siguiente cliente veía los datos del anterior. | Ahora el borrador **vence a los 3 días** (se cambia en `config.js`) y hay un botón **"Empezar de nuevo"**. Al enviar, se borra. Los borradores de la versión anterior se eliminan solos. |
| Después de actualizar los archivos se seguía viendo la versión vieja | GitHub Pages y el navegador guardan en caché los `.js` y `.css`. | Todos los archivos se cargan con `?v=3.0`. En cada actualización se cambia ese número y el navegador baja los nuevos sí o sí. |
| La web y Apps Script quedaban en versiones distintas | Si no se publicaba una "Nueva versión" de la implementación, seguía activo el código viejo. | El servidor informa su versión. Si no coincide con la que espera la web, el panel muestra un **aviso rojo** con los pasos para actualizarlo. |

## 3. Carga lenta y pedidos que se colgaban

| Problema | Solución |
|---|---|
| Para entrar al panel se hacían 3 consultas seguidas a Apps Script (verificar clave, lista, ficha), de 1 a 3 s cada una | Ahora es **una sola consulta**, que trae todas las solicitudes completas. Abrir una ficha es instantáneo: no consulta al servidor. |
| Cada acción leía la planilla 3 o 4 veces (encabezados, buscar fila, leer fila…) | Ahora se lee **una vez por pedido** y se escriben solo las celdas que cambian. |
| El logo pesaba **315 KB** (era un PNG metido dentro de un SVG) y además había un PNG de 236 KB | El logo nuevo es un PNG optimizado de **13 KB**, con el mismo aspecto. Se agregaron favicon y un ícono para celulares. |
| Se descargaban 3 familias tipográficas | Ahora es una sola (Saira, parecida a la letra del logo). El resto del texto usa la fuente del sistema. |
| El panel bajaba siempre la librería de Excel (≈900 KB) | Ahora se descarga solo cuando se toca "Descargar Excel". |
| Si el servidor estaba ocupado, el pedido esperaba en silencio y terminaba en "Error interno" | Ahora devuelve "El sistema está ocupado" (código `BUSY`) y el formulario reintenta solo. |
| El cliente no sabía si el envío seguía en curso | Se agregó un indicador que gira, y a los 8 s aparece el mensaje "Sigue enviando, no cierres esta página". Si intenta cerrar la pestaña, el navegador le avisa. |
| Al adjuntar un archivo la página saltaba arriba de todo | Ahora mantiene la posición. |

## 4. Número de cliente

- **Antes:** una ventana `prompt()` del navegador, sin validación, que el bloqueador de ventanas podía impedir.
- **Ahora:** un campo dentro de la ficha, **"Número de cliente en Magnus"**, junto al botón "Dar de alta y enviar email".
  - Valida antes de enviar: obligatorio, solo números o letras (hasta 20), sin espacios, y que no lo tenga otro cliente. El error se muestra debajo del campo.
  - Con **Enter** se confirma.
  - La confirmación muestra razón social, CUIT, número y email. Antes mostraba un `\n\n` literal por un error de escritura.
  - Una vez dado de alta, el número se ve grande en la ficha y aparece en la lista ("Cl. 10458"). También se puede buscar por él.
  - Desde "Corregir número o reenviar email" se cambia el número y se reenvía el email.
- **Email de alta:** el número de cliente figura en el asunto ("Cliente N° 10458") y en una tabla junto al CUIT y la razón social.

## 5. Validación de CUIT (error de la versión recibida)

La versión recibida, cuando el dígito verificador daba 10, lo **recalculaba con el prefijo 23** y aceptaba el resultado. Eso hacía pasar como válidos CUIT que **no existen**: por ejemplo, un `20-…` cuyo número real es `23-…`.

Ahora se aplica la regla correcta. Si el cálculo da 10, ese número no existe, porque ARCA le asigna otro prefijo, y el número nuevo se valida como cualquier otro. Se aceptan los prefijos 20, 23, 24, 25, 26, 27, 30, 33 y 34.

**Aviso temprano:** apenas el cliente escribe un CUIT válido, el formulario consulta al servidor. Si ya es cliente, se lo avisa en el paso 1 con el link para crear su usuario web. Si tiene una solicitud en curso, se lo dice ahí mismo, sin hacerle completar los 5 pasos.

## 6. Otros errores corregidos

- **`admin.css`:** la regla `.history` tenía `\n` escritos como texto, así que el historial de emails nunca tomaba estilo.
- **Mensajes técnicos al cliente:** "Verificá la URL /exec en assets/js/config.js…" se le mostraba al cliente. Ahora el cliente ve un mensaje claro y el detalle técnico queda en la consola (F12).
- **Clave vencida:** si la clave guardada en la pestaña dejaba de ser válida, el panel quedaba en blanco. Ahora vuelve a la pantalla de ingreso.
- **Reabrir solicitudes:** no se puede pasar una solicitud rechazada a "Nueva" o "En revisión" si el CUIT ya tiene otra abierta o dada de alta.
- **Adjuntos:** el servidor ahora también controla el tamaño total (15 MB), no solo el de cada archivo.
- **Escritura en la planilla:** al actualizar una fila se escriben solo las celdas que cambian. Así no se pisan columnas ni fórmulas agregadas a mano.

## 7. Diseño con la marca Corti-Fer

- Paleta basada en el **rojo del logo (#E11B2A)** y negro, sobre grises neutros. Los colores de texto cumplen contraste AA.
- Encabezado blanco con el logo y un filete rojo debajo. El encabezado queda blanco también en modo oscuro, para que el logo se lea bien.
- Título "Alta de *cliente*" en cursiva, al estilo del logo. Barras de pasos inclinadas, con el paso actual en rojo y los completados en negro.
- Botones principales, opciones elegidas, numeración y el número de solicitud en rojo de marca.
- Panel: indicadores con "Nuevas" destacado. Al tocar un indicador se filtra la lista. Los estados se distinguen por color: Nueva en rojo, En revisión en ámbar, Dada de alta en verde y Rechazada en gris.
- Emails con encabezado y botón en rojo Corti-Fer.
- Modo oscuro completo.

---

## Pruebas realizadas

- **Servidor (41 casos, todos OK)**, con una planilla, Drive y emails simulados:
  - envío repetido sin duplicar
  - CUIT abierto, CUIT cliente y CUIT rechazado que vuelve a solicitar
  - correlativo sin contador
  - número de cliente obligatorio, inválido y repetido
  - mismo CUIT dado de alta dos veces
  - email que falla, reenvío y corrección del número
  - servidor ocupado, robots y bloqueo de clave
  - el listado hace una sola lectura de la planilla
- **Navegador real (Chromium), celular y escritorio, claro y oscuro:**
  - formulario completo con un corte de conexión simulado en el envío: reintenta con el mismo ID y termina bien
  - borrador al recargar y borrador vencido
  - aviso de CUIT ya cliente
  - panel: una sola llamada al entrar
  - errores del campo de número de cliente
  - alta completa
  - aviso de versión desactualizada
  - sin errores de JavaScript

**Falta probarlo en tu cuenta real de Google** (permisos, emails reales y Drive). Ver los pasos en el README.


## Ajuste de validación — Vendedor opcional
- El campo «Vendedor / viajante» ya no es obligatorio en el formulario.
- Si queda vacío, el formulario permite avanzar y enviar la solicitud.
- Si se completa, se valida que tenga nombre y apellido.
- El servidor también acepta el campo vacío para evitar rechazos al guardar.
