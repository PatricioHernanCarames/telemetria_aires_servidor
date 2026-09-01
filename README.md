# Reiniciador A/A — Dashboard web

Frontend estático para publicar directamente con **GitHub Pages**.

## Archivos

- `index.html` — estructura del dashboard.
- `styles.css` — diseño responsive.
- `config.js` — URL pública del backend y `device_id`.
- `app.js` — consulta del backend, telemetría, eventos y gráficos.

## 1. Configurar la URL de Render

Editar `config.js`:

```js
window.AA_DASHBOARD_CONFIG = {
  API_BASE_URL: "https://TU-SERVICIO.onrender.com",
  DEVICE_ID: "reiniciador_sala_aa",
  REFRESH_MS: 15000,
  HISTORY_HOURS: 24,
  EVENTS_LIMIT: 40,
  OFFLINE_AFTER_SECONDS: 150
};
```

`DEVICE_ID` debe coincidir con el `device_id` configurado en el ESP32.

## 2. Contrato GET esperado del backend

La página consulta:

```text
GET /api/dashboard?device_id=reiniciador_sala_aa&hours=24&events_limit=40
```

Respuesta recomendada:

```json
{
  "ok": true,
  "device_id": "reiniciador_sala_aa",
  "server_time": "2026-09-01T12:30:00.000Z",
  "latest": {
    "device_id": "reiniciador_sala_aa",
    "created_at_local": "2026-09-01T09:29:51-03:00",
    "received_at": "2026-09-01T12:29:52.120Z",
    "uptime_s": 14850,
    "type": "telemetry",
    "line_present": true,
    "wifi_connected": true,
    "wifi_ssid": "MiRed",
    "wifi_rssi": -58,
    "restart_state": 0,
    "auto_restart_enabled": true,
    "config_ap_active": false,
    "room_temp_c": 23.40,
    "york_current_a": 5.82,
    "york_current_state": "working",
    "queue_events": 0,
    "queue_bytes": 0
  },
  "history": [
    {
      "received_at": "2026-09-01T12:00:00.000Z",
      "room_temp_c": 23.9,
      "york_current_a": 5.8
    }
  ],
  "events": [
    {
      "device_id": "reiniciador_sala_aa",
      "event": "power_restored",
      "line_present": true,
      "created_at_local": "2026-09-01T09:10:00-03:00",
      "received_at": "2026-09-01T12:10:01.000Z"
    }
  ]
}
```

El frontend también tolera algunos nombres alternativos (`telemetry`, `samples`,
`recent_events`, `data.latest`) para facilitar la integración.

## 3. Seguridad

**No colocar en `config.js` el `x-api-token` que usa el ESP32 para hacer POST.**

El token del ESP32 es una credencial de escritura y quedaría públicamente visible
si se sube a GitHub.

Si se desea proteger la lectura del dashboard:

1. El backend puede aceptar un token diferente y de sólo lectura por
   `x-dashboard-token`.
2. Desde la web, abrir **Configuración** e ingresar ese token.
3. El navegador lo conserva en `localStorage`; no forma parte del repositorio.

Para máxima privacidad, el backend debe decidir qué campos devuelve. Por ejemplo,
puede omitir `wifi_ssid` si no se quiere exponerlo al dashboard.

## 4. CORS en Render

El backend debe permitir el origen de GitHub Pages, por ejemplo:

```text
https://TU-USUARIO.github.io
```

Durante las primeras pruebas puede habilitarse el origen exacto del sitio del
proyecto. Evitar `*` si posteriormente se usa un token de lectura.

Debe aceptar:

- Método `GET`
- Header `Accept`
- Header opcional `x-dashboard-token`

## 5. Publicar en GitHub Pages

1. Crear un repositorio, por ejemplo `reiniciador-aa-web`.
2. Subir estos archivos en la raíz.
3. Ir a **Settings → Pages**.
4. En **Build and deployment**, seleccionar **Deploy from a branch**.
5. Elegir la rama `main` y carpeta `/ (root)`.
6. Guardar.

GitHub publicará el sitio bajo una URL similar a:

```text
https://TU-USUARIO.github.io/reiniciador-aa-web/
```

## Datos que ya muestra

- Estado general / última telemetría.
- Presencia de 220 V.
- Temperatura de sala.
- Corriente y estado del York.
- Estado interno de la máquina de reinicio.
- Wi‑Fi, SSID y RSSI.
- Reinicio automático.
- AP de configuración.
- Cola offline de LittleFS.
- Falla SCT013, si existe.
- Gráfico de temperatura.
- Gráfico de corriente.
- Eventos recientes.

La página refresca automáticamente cada 15 segundos y permite actualización manual.
