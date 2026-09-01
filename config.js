/*
  CONFIGURACIÓN PÚBLICA DEL SITIO

  1) Cambiá API_BASE_URL por la URL de tu servicio de Render.
  2) DEVICE_ID debe coincidir con cfg.deviceId del ESP32.
  3) No pongas aquí el x-api-token usado por el ESP32 para escribir telemetría.

  Si el endpoint GET /api/dashboard requiere un token de lectura, ingresalo
  desde el botón "Configuración": se guarda localmente en el navegador.
*/
window.AA_DASHBOARD_CONFIG = {
  API_BASE_URL: "https://TU-SERVICIO.onrender.com",
  DEVICE_ID: "reiniciador_sala_aa",
  REFRESH_MS: 15000,
  HISTORY_HOURS: 24,
  EVENTS_LIMIT: 40,
  OFFLINE_AFTER_SECONDS: 150
};
