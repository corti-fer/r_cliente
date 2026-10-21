/*
 * Configuración del sitio. Es el ÚNICO archivo que hay que editar al publicar.
 *
 * API_URL: URL de la aplicación web de Google Apps Script (termina en /exec).
 *          Implementar > Administrar implementaciones > URL de la app web.
 * API_VERSION: versión del servidor que espera esta web. Si Code.gs no se actualizó
 *          (Implementar > Administrar implementaciones > Nueva versión), el panel avisa.
 */
window.ALTA_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxv4WVY0xswqI76NJthX3xWejBj2QY-S1XOEQfi1Q20FJ375vAj8lVGshwCVz17gJQ/exec',
  API_VERSION: '3.3',
  MAX_FILE_MB: 5,        // tamaño máximo por archivo adjunto
  MAX_TOTAL_MB: 15,      // tamaño máximo sumando todos los adjuntos
  DRAFT_DAYS: 3          // días que se conserva un formulario a medio completar en el navegador
};
