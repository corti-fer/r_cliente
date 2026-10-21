# Alta de clientes · Corti-Fer (v3.2)

Formulario web para que un cliente nuevo cargue sus datos, y un panel aparte para que administración lo revise, le asigne el número de cliente y lo dé de alta.

- **Formulario del cliente** (`index.html`): página pública. Es la que se envía al cliente.
- **Panel de administración** (`admin/index.html`): otra página, protegida con clave.
- **Servidor** (`apps-script/`): Google Apps Script vinculado a una planilla de Google, que funciona como base de datos y envía los emails.

Los cambios de esta versión, con los errores corregidos, están en **[CAMBIOS.md](CAMBIOS.md)**.

## Cómo funciona

```
Cliente (GitHub Pages)              Google Apps Script + Planilla             Administración (GitHub Pages)
index.html ──── envía (con ID) ───▶ ¿mismo ID? → devuelve el mismo número
                                     ¿CUIT ya cliente / en curso? → rechaza
                                     guarda fila · adjuntos en Drive
                                     email a administración ─────────────────▶ admin/?nro=ALTA-2026-0001
                                     acuse al cliente
                                                    ◀──── lista completa (1 consulta) ──── admin/index.html
                                                    ◀──── N° de cliente + "Dar de alta"
                                     valida N° único y CUIT no dado de alta
                                     estado = "Dada de alta"
                                     email al cliente: N° de cliente, CUIT y enlace
                                     https://www.corti-fer.com.ar/registracion.aspx?TipoRegistracion=1
```

Estados de una solicitud: **Nueva → En revisión → Dada de alta**, o **Rechazada**.

## Estructura

```
index.html                    formulario del cliente
admin/index.html              panel de administración
assets/css/base.css           estilos comunes y colores de marca
assets/css/cliente.css        estilos del formulario
assets/css/admin.css          estilos del panel
assets/js/config.js           ← URL del servidor y opciones (lo único que se edita)
assets/js/common.js           validaciones, normalización, ficha, conexión con el servidor
assets/js/cliente.js          lógica del formulario
assets/js/admin.js            lógica del panel
assets/img/                   logo, favicon, ícono para celulares, miniatura para compartir
apps-script/Code.gs           servidor (se pega en Apps Script; no se publica en GitHub Pages)
apps-script/appsscript.json   manifiesto de Apps Script
```

## Actualizar desde la versión anterior (tu caso)

1. **Apps Script:** abrí la planilla y entrá a **Extensiones → Apps Script**. Reemplazá todo el contenido de `Código.gs` por el de `apps-script/Code.gs` y guardá.
2. Elegí la función **`setup`** y tocá **Ejecutar**. Agrega las columnas nuevas, como "ID de envío", sin tocar los datos existentes. En el registro de ejecución vas a ver si hay **duplicados de antes**: dejá una solicitud por CUIT y pasá las demás a "Rechazada" desde el panel.
3. Andá a **Implementar → Administrar implementaciones → ✏️ editar → Versión: Nueva versión → Implementar**. Así la URL `/exec` no cambia. **Este paso es obligatorio:** sin él sigue funcionando el código viejo, y el panel lo avisa con un cartel rojo.
4. **GitHub:** reemplazá todos los archivos del repositorio por los de esta carpeta. Borrá `assets/img/logo-corti-fer.svg`, `logo-corti-fer.png` y `favicon.png` (ya no se usan) y los README viejos.
   - `config.js` ya tiene tu URL `/exec`.
   - En `index.html`, cambiá `TU-SITIO` en la línea `og:image` por la dirección real del sitio (es para la vista previa en WhatsApp).
5. Abrí la URL `/exec` en el navegador: tiene que responder `"version":"3.3"`.
6. Probá con los pasos de "Prueba antes de mandarlo a clientes", más abajo.

> **Cada vez que cambies algo en los archivos de la web**, subí el número `?v=3.3` en `index.html` y `admin/index.html` (por ejemplo a `?v=3.3`). Así nadie se queda con la versión vieja en caché.
> **Si cambiás `Code.gs`**, actualizá `API_VERSION` en `Code.gs` y en `config.js` con el mismo número.

## Instalación desde cero

### 1. Planilla y servidor (Google)

Conviene hacerlo con una cuenta de la empresa (por ejemplo `administracion@corti-fer.com.ar`): los emails salen desde esa cuenta.

1. Crear una planilla de Google, por ejemplo "Altas de clientes", y entrar a **Extensiones → Apps Script**.
2. Pegar `apps-script/Code.gs`. Opcional: en Configuración del proyecto, tildar "Mostrar el archivo de manifiesto" y pegar `appsscript.json`.
3. Ejecutar **`setup`** y aceptar los permisos (planilla, Drive y email). El registro muestra la **clave de administración**.
4. Ir a **Implementar → Nueva implementación → Aplicación web**, con "Ejecutar como: **Yo**" y "Acceso: **Cualquier usuario**". Copiar la URL `/exec`.
5. Revisar en **Configuración del proyecto → Propiedades del script**:

| Propiedad | Para qué |
|---|---|
| `ADMIN_KEY` | Clave del panel. Se puede cambiar cuando quieras. |
| `NOTIFY_TO` | Quién recibe el aviso de solicitud nueva. Varios separados por coma. |
| `ADMIN_URL` | URL del panel, por ejemplo `https://corti-fer.github.io/r_cliente/admin/`. |
| `DRIVE_FOLDER_ID` | Carpeta de los adjuntos (la crea `setup`). |
| `SEND_RECEIPT` | `si` / `no`: si se manda o no el acuse de recibo al cliente. |

Para probar el email de alta sin un cliente real, ejecutá `probarEmailAlta`: te llega a vos.

### 2. Páginas (GitHub)

1. Crear el repositorio y subir todos los archivos.
2. Pegar la URL `/exec` en `assets/js/config.js`.
3. Ir a **Settings → Pages → Deploy from a branch → `main` / root**.
4. Queda publicado así:
   - Cliente: `https://<usuario>.github.io/<repo>/`
   - Administración: `https://<usuario>.github.io/<repo>/admin/`

## Reglas que aplica el sistema

- **Un envío, una fila.** Si el cliente toca "Enviar" dos veces o se corta internet, no se duplica.
- **El CUIT puede repetirse** (un cliente con varias sucursales tiene un número de cliente por sucursal). No se bloquea, pero se avisa:
  - al cliente, en el paso 1, apenas escribe el CUIT;
  - a administración, en el asunto del email ("[CUIT repetido]"), en la lista ("CUIT repetido") y en la ficha, con las otras solicitudes y sus números de cliente;
  - en la confirmación de alta, si ese CUIT ya es cliente.
- **CUIL / persona física** (CUIT que empieza con 20, 23, 24, 25, 26 o 27): se avisa al cliente, en el email y en la ficha. La planilla lo anota en la columna "Tipo de CUIT".
- **Vendedor / viajante:** nombre y apellido obligatorios. Se guarda con Mayúscula Inicial y aparece en la ficha, el email a administración y el email de alta.
- **Número de cliente:**
  - Es obligatorio para dar de alta.
  - Lleva solo números o letras, hasta 20.
  - No puede repetirse.
  - Se envía al cliente en el email de alta.
- **Si el email de alta falla, el alta queda guardada.** El panel lo muestra en amarillo con el botón "Enviar email de alta", y cada intento queda en el historial.

## Seguridad

- Los datos están en la planilla y solo se leen con la clave de administración. Sin clave el panel no muestra nada.
- La clave queda guardada solo en la pestaña del navegador. Tras 10 intentos fallidos se bloquea el ingreso 15 minutos. Si la clave se filtra, cambiá `ADMIN_KEY`.
- Los adjuntos quedan en Drive como privados de la cuenta dueña.
- El servidor vuelve a validar todo, y un texto que empiece con `=` nunca se guarda como fórmula.
- La validación del CUIT controla el formato y el dígito verificador. **No consulta ARCA.**

## Límites

- Emails por día: 100 con Gmail común y 1.500 con Google Workspace. Cada solicitud usa 2 y cada alta 1.
- Adjuntos: 5 MB por archivo y 15 MB en total.
- Un envío con adjuntos puede tardar entre 5 y 30 segundos, porque Apps Script no es instantáneo. El formulario espera hasta 90 s y reintenta solo, sin duplicar.
- No cambies los textos de los encabezados de la planilla. Las columnas sí se pueden reordenar.

## Prueba antes de mandarlo a clientes

1. Cargá una solicitud con tu email. Verificá:
   - la fila en la planilla, con "ID de envío"
   - el aviso a `NOTIFY_TO`
   - el acuse en tu email
   - el adjunto en Drive
2. Volvé a cargar el **mismo CUIT**: tiene que avisar (sin bloquear) y el email a administración tiene que llegar con "[CUIT repetido]".
3. Abrí el link del aviso e ingresá la clave: la solicitud tiene que aparecer abierta.
4. Cargá un número de cliente y tocá **Dar de alta y enviar email**. Te tiene que llegar el email con el número y el botón "Crear mi cuenta".
5. Cargá el mismo CUIT como otra sucursal y dale de alta con **otro** número de cliente. Con el mismo número tiene que rechazarlo.
