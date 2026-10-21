# Cambios: asignación obligatoria de viajante

- Al dar de alta un cliente o reenviar el email, administración debe seleccionar un viajante de una lista desplegable.
- La selección reemplaza el texto previo de `Vendedor / viajante` en el registro.
- El email de alta se envía al cliente y con copia (CC) al correo asociado al viajante.
- Para `Decima Jose`, la copia se envía a las dos direcciones proporcionadas.
- La opción `Cortifer` envía copia a ecommercecortifer@gmail.com.
- El servidor valida la selección contra su lista permitida, de modo que no depende solamente de la validación del navegador.
- La lista y el mapa de destinatarios deben mantenerse sincronizados si se agregan o cambian viajantes.

## Para aplicar el cambio

1. Publicar los archivos estáticos actualizados en GitHub Pages.
2. Copiar `apps-script/Code.gs` al proyecto de Google Apps Script.
3. Guardar y crear una nueva implementación de la aplicación web (o editar la implementación existente para usar la nueva versión).
4. Probar con una solicitud de prueba y verificar que el cliente recibe el email y el viajante seleccionado aparece en CC.
