# Cambios en lista de transportes

- Se reemplazó la lista anterior por los transportes proporcionados, ordenados alfabéticamente.
- Se agregó la opción **Otro**.
- Al seleccionar **Otro**, aparece el campo **¿Qué transporte?**, que es obligatorio para continuar.
- El nombre ingresado en ese campo se guarda en el campo `transporte` existente, por lo que no requiere crear una nueva columna en la planilla.
- Verificados sintácticamente `assets/js/common.js` y `assets/js/cliente.js` con Node.js.

Nota: se normalizaron mayúsculas, acentos y duplicados aparentes de la lista original (por ejemplo, la línea repetida de Logística Pampeana / Expreso Rocinante se representó como dos opciones distintas: `Logística Pampeana` y `Logística Pampeana - Expreso Rocinante`).
