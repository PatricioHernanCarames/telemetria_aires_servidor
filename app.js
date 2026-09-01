(() => {
  "use strict";

  const DEFAULTS = Object.assign({
    API_BASE_URL: "",
    DEVICE_ID: "reiniciador_sala_aa",
    REFRESH_MS: 15000,
    HISTORY_HOURS: 24,
    EVENTS_LIMIT: 40,
    OFFLINE_AFTER_SECONDS: 150
  }, window.AA_DASHBOARD_CONFIG || {});

  const LS_KEY = "aa_restart_dashboard_settings_v1";

  const $ = (id) => document.getElementById(id);

  const stateNames = {
    0: "Normal",
    1: "Corte de energía",
    2: "Espera tras retorno",
    3: "Enviando TCL ON",
    4: "Configurando TCL",
    5: "Verificando York",
    6: "Enviando York POWER",
    7: "Configurando York",
    8: "Espera de verificación",
    9: "Finalizando"
  };

  const eventNames = {
    boot: "Arranque del controlador",
    power_cut: "Corte de energía",
    power_restored: "Energía restaurada",
    restart_started: "Reinicio iniciado",
    restart_completed: "Reinicio completado",
    restart_failed: "Reinicio fallido",
    ir_sent: "Comando IR enviado",
    queue_overflow: "Desborde de cola local",
    wifi_connected: "Wi-Fi conectado",
    wifi_disconnected: "Wi-Fi desconectado",
    sct_fault: "Falla de lectura SCT013",
    auto_restart_disabled: "Reinicio automático deshabilitado"
  };

  let timer = null;
  let lastDashboard = null;

  function getSettings() {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY) || "{}");
    } catch (_) {}
    return {
      apiUrl: cleanBaseUrl(saved.apiUrl || DEFAULTS.API_BASE_URL),
      deviceId: saved.deviceId || DEFAULTS.DEVICE_ID,
      token: saved.token || ""
    };
  }

  function saveSettings(settings) {
    localStorage.setItem(LS_KEY, JSON.stringify(settings));
  }

  function cleanBaseUrl(url) {
    return String(url || "").trim().replace(/\/+$/, "");
  }

  function hasPlaceholderUrl(url) {
    return !url || /TU-SERVICIO/i.test(url);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function boolText(value, yes = "Sí", no = "No") {
    if (value === true || value === 1 || value === "1") return yes;
    if (value === false || value === 0 || value === "0") return no;
    return "—";
  }

  function numberOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }

  function formatNumber(value, digits = 1) {
    const n = numberOrNull(value);
    return n === null ? "—" : n.toFixed(digits);
  }

  function formatBytes(value) {
    const n = numberOrNull(value);
    if (n === null) return "—";
    if (n < 1024) return `${Math.round(n)} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
  }

  function formatDuration(seconds) {
    const n = numberOrNull(seconds);
    if (n === null || n < 0) return "—";
    const total = Math.floor(n);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    if (d > 0) return `${d} d ${h} h`;
    if (h > 0) return `${h} h ${m} min`;
    return `${m} min`;
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function formatDateTime(value) {
    const d = parseDate(value);
    if (!d) return value ? String(value) : "—";
    return new Intl.DateTimeFormat("es-AR", {
      dateStyle: "short",
      timeStyle: "medium"
    }).format(d);
  }

  function relativeTime(value) {
    const d = parseDate(value);
    if (!d) return "—";
    const delta = Math.round((Date.now() - d.getTime()) / 1000);
    if (delta < 0) return "ahora";
    if (delta < 60) return `hace ${delta} s`;
    if (delta < 3600) return `hace ${Math.floor(delta / 60)} min`;
    if (delta < 86400) return `hace ${Math.floor(delta / 3600)} h`;
    return `hace ${Math.floor(delta / 86400)} d`;
  }

  function latestTimestamp(latest) {
    return latest.received_at ||
      latest.server_received_at ||
      latest.created_at ||
      latest.created_at_local ||
      null;
  }

  function normalizeDashboard(raw) {
    if (!raw || typeof raw !== "object") throw new Error("Respuesta JSON vacía o inválida.");

    // Contrato preferido:
    // { ok, device_id, latest, history, events, server_time }
    let latest = raw.latest || raw.device || raw.telemetry_latest || null;
    let history = raw.history || raw.telemetry || raw.samples || [];
    let events = raw.events || raw.recent_events || [];

    // Si el backend entrega latest dentro de telemetry.
    if (!latest && Array.isArray(history) && history.length) {
      latest = history[history.length - 1];
    }

    // Acepta {data:{...}}.
    if (!latest && raw.data && typeof raw.data === "object") {
      latest = raw.data.latest || raw.data.device || null;
      history = raw.data.history || raw.data.telemetry || history;
      events = raw.data.events || events;
    }

    if (!latest) latest = {};

    return {
      ok: raw.ok !== false,
      device_id: raw.device_id || latest.device_id || getSettings().deviceId,
      latest,
      history: Array.isArray(history) ? history : [],
      events: Array.isArray(events) ? events : [],
      server_time: raw.server_time || raw.now || null
    };
  }

  async function fetchDashboard() {
    const settings = getSettings();

    if (hasPlaceholderUrl(settings.apiUrl)) {
      throw new Error("Configurá primero la URL de Render desde el botón «Configuración».");
    }

    const url = new URL(settings.apiUrl + "/api/dashboard");
    url.searchParams.set("device_id", settings.deviceId);
    url.searchParams.set("hours", String(DEFAULTS.HISTORY_HOURS));
    url.searchParams.set("events_limit", String(DEFAULTS.EVENTS_LIMIT));

    const headers = { "Accept": "application/json" };
    if (settings.token) headers["x-dashboard-token"] = settings.token;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    try {
      const response = await fetch(url.toString(), {
        method: "GET",
        headers,
        cache: "no-store",
        signal: controller.signal
      });

      let payload = null;
      try {
        payload = await response.json();
      } catch (_) {
        throw new Error(`El backend respondió HTTP ${response.status}, pero no devolvió JSON.`);
      }

      if (!response.ok || payload?.ok === false) {
        const reason = payload?.error || payload?.message || `HTTP ${response.status}`;
        throw new Error(`Backend: ${reason}`);
      }

      return normalizeDashboard(payload);
    } finally {
      clearTimeout(timeout);
    }
  }

  function setConnection(kind, text) {
    const pill = $("connectionPill");
    pill.className = "pill";
    pill.classList.add(kind === "good" ? "pill-good" :
                       kind === "warn" ? "pill-warn" :
                       kind === "bad" ? "pill-bad" : "pill-neutral");
    $("connectionText").textContent = text;
  }

  function showError(message) {
    $("errorBanner").textContent = message;
    $("errorBanner").classList.remove("hidden");
  }

  function clearError() {
    $("errorBanner").classList.add("hidden");
    $("errorBanner").textContent = "";
  }

  function deriveOnline(latest) {
    const stamp = latestTimestamp(latest);
    const d = parseDate(stamp);
    if (!d) return null;
    return (Date.now() - d.getTime()) / 1000 <= DEFAULTS.OFFLINE_AFTER_SECONDS;
  }

  function restartStateName(value) {
    const key = Number(value);
    return Number.isFinite(key) && stateNames[key] ? stateNames[key] : (value ?? "—");
  }

  function currentStateName(value) {
    const map = {
      working: "Equipo funcionando",
      off_or_standby: "Apagado / standby",
      intermediate: "Consumo intermedio"
    };
    return map[value] || value || "—";
  }

  function updateOverview(data) {
    const t = data.latest || {};
    const online = deriveOnline(t);
    const isCut = t.line_present === false || t.line_present === 0;

    $("deviceSubtitle").textContent = data.device_id || "Equipo sin identificar";
    $("lastSeen").textContent = relativeTime(latestTimestamp(t));
    $("uptime").textContent = formatDuration(t.uptime_s);
    $("restartStateText").textContent = `Estado de reinicio: ${restartStateName(t.restart_state)}`;

    const dot = $("systemStatusDot");
    dot.className = "status-dot";

    if (online === false) {
      $("systemStatus").textContent = "Sin telemetría";
      dot.classList.add("status-bad");
      setConnection("bad", "Equipo sin reportar");
    } else if (isCut) {
      $("systemStatus").textContent = "Corte de energía";
      dot.classList.add("status-warn");
      setConnection(online === true ? "good" : "warn", online === true ? "Backend conectado" : "Estado incierto");
    } else {
      $("systemStatus").textContent = "Operativo";
      dot.classList.add("status-good");
      setConnection(online === true ? "good" : "warn", online === true ? "Backend conectado" : "Datos recibidos");
    }

    $("linePresent").textContent =
      t.line_present === true || t.line_present === 1 ? "220 V presente" :
      t.line_present === false || t.line_present === 0 ? "Sin 220 V" : "—";

    $("roomTemp").textContent = formatNumber(t.room_temp_c, 1);
    $("yorkCurrent").textContent = formatNumber(t.york_current_a, 2);
    $("yorkState").textContent = currentStateName(t.york_current_state);

    $("wifiConnected").textContent = boolText(t.wifi_connected, "Conectado", "Desconectado");
    $("wifiSsid").textContent = t.wifi_ssid || "—";
    $("wifiRssi").textContent = numberOrNull(t.wifi_rssi) === null ? "—" : `${t.wifi_rssi} dBm`;
    $("autoRestart").textContent = boolText(t.auto_restart_enabled, "Habilitado", "Deshabilitado");
    $("configAp").textContent = boolText(
      t.config_ap_active ?? t.ap_active,
      "Activo",
      "Inactivo"
    );

    $("queueEvents").textContent = numberOrNull(t.queue_events) === null ? "—" : String(t.queue_events);
    $("queueBytes").textContent = formatBytes(t.queue_bytes);
    $("currentFault").textContent = t.current_fault || "Sin fallas";
  }

  function eventLabel(name) {
    return eventNames[name] || name || "—";
  }

  function eventDetails(event) {
    const omit = new Set([
      "id", "type", "event", "device_id", "created_at_local", "created_at",
      "received_at", "server_received_at", "line_present"
    ]);
    const parts = [];

    Object.entries(event || {}).forEach(([key, value]) => {
      if (omit.has(key) || value === null || typeof value === "object") return;
      parts.push(`${key}: ${value}`);
    });

    return parts.slice(0, 5).join(" · ") || "—";
  }

  function renderEvents(events) {
    const body = $("eventsBody");
    $("eventCount").textContent = `${events.length} evento${events.length === 1 ? "" : "s"}`;

    if (!events.length) {
      body.innerHTML = '<tr><td colspan="4" class="table-empty">No hay eventos guardados.</td></tr>';
      return;
    }

    const sorted = [...events].sort((a, b) => {
      const da = parseDate(a.received_at || a.created_at || a.created_at_local)?.getTime() || 0;
      const db = parseDate(b.received_at || b.created_at || b.created_at_local)?.getTime() || 0;
      return db - da;
    });

    body.innerHTML = sorted.map(event => {
      const stamp = event.received_at || event.created_at || event.created_at_local;
      const line = event.line_present === true || event.line_present === 1 ? "Presente" :
                   event.line_present === false || event.line_present === 0 ? "Ausente" : "—";

      return `<tr>
        <td>${escapeHtml(formatDateTime(stamp))}</td>
        <td><span class="event-name">${escapeHtml(eventLabel(event.event))}</span></td>
        <td>${escapeHtml(line)}</td>
        <td>${escapeHtml(eventDetails(event))}</td>
      </tr>`;
    }).join("");
  }

  function historyTimestamp(row) {
    return row.received_at || row.created_at || row.created_at_local || row.timestamp || null;
  }

  function renderChart(canvas, emptyNode, rows, key, rangeNode, unit, decimals) {
    const points = rows
      .map(r => ({
        x: parseDate(historyTimestamp(r)),
        y: numberOrNull(r[key])
      }))
      .filter(p => p.x && p.y !== null)
      .sort((a, b) => a.x - b.x);

    if (points.length < 2) {
      canvas.classList.add("hidden");
      emptyNode.classList.remove("hidden");
      rangeNode.textContent = points.length ? `${points[0].y.toFixed(decimals)} ${unit}` : "—";
      return;
    }

    canvas.classList.remove("hidden");
    emptyNode.classList.add("hidden");

    const ys = points.map(p => p.y);
    const rawMin = Math.min(...ys);
    const rawMax = Math.max(...ys);
    const padding = Math.max((rawMax - rawMin) * 0.12, key === "room_temp_c" ? 0.5 : 0.08);
    let minY = rawMin - padding;
    let maxY = rawMax + padding;
    if (key === "york_current_a") minY = Math.max(0, minY);
    if (maxY <= minY) maxY = minY + 1;

    rangeNode.textContent = `${rawMin.toFixed(decimals)}–${rawMax.toFixed(decimals)} ${unit}`;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { l: 45, r: 12, t: 12, b: 27 };
    const plotW = w - pad.l - pad.r;
    const plotH = h - pad.t - pad.b;

    const minX = points[0].x.getTime();
    const maxX = points[points.length - 1].x.getTime();
    const spanX = Math.max(1, maxX - minX);

    const xOf = p => pad.l + ((p.x.getTime() - minX) / spanX) * plotW;
    const yOf = p => pad.t + (1 - ((p.y - minY) / (maxY - minY))) * plotH;

    ctx.clearRect(0, 0, w, h);

    // Grilla
    ctx.lineWidth = 1;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textBaseline = "middle";

    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (plotH * i / 4);
      const val = maxY - ((maxY - minY) * i / 4);

      ctx.strokeStyle = "rgba(143,160,178,.16)";
      ctx.beginPath();
      ctx.moveTo(pad.l, y);
      ctx.lineTo(w - pad.r, y);
      ctx.stroke();

      ctx.fillStyle = "#8fa0b2";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(decimals), pad.l - 7, y);
    }

    // Etiquetas de tiempo
    const timeFmt = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" });
    [0, .5, 1].forEach(f => {
      const time = new Date(minX + spanX * f);
      const x = pad.l + plotW * f;
      ctx.fillStyle = "#8fa0b2";
      ctx.textAlign = f === 0 ? "left" : f === 1 ? "right" : "center";
      ctx.textBaseline = "top";
      ctx.fillText(timeFmt.format(time), x, h - pad.b + 8);
    });

    // Área
    const gradient = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
    gradient.addColorStop(0, "rgba(79,183,255,.22)");
    gradient.addColorStop(1, "rgba(79,183,255,0)");

    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xOf(p), y = yOf(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(xOf(points[points.length - 1]), h - pad.b);
    ctx.lineTo(xOf(points[0]), h - pad.b);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    // Línea
    ctx.beginPath();
    points.forEach((p, i) => {
      const x = xOf(p), y = yOf(p);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#4fb7ff";
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function renderCharts(history) {
    renderChart(
      $("tempChart"),
      $("tempEmpty"),
      history,
      "room_temp_c",
      $("tempRange"),
      "°C",
      1
    );
    renderChart(
      $("currentChart"),
      $("currentEmpty"),
      history,
      "york_current_a",
      $("currentRange"),
      "A",
      2
    );
  }

  function render(data) {
    lastDashboard = data;
    updateOverview(data);
    renderEvents(data.events);
    renderCharts(data.history);

    const stamp = data.server_time ? `Servidor: ${formatDateTime(data.server_time)}` : "Datos actualizados";
    $("footerStatus").textContent = stamp;
  }

  async function refresh() {
    $("refreshBtn").disabled = true;
    $("refreshBtn").textContent = "Actualizando…";

    try {
      clearError();
      const data = await fetchDashboard();
      render(data);
    } catch (error) {
      console.error(error);
      setConnection("bad", "Error de conexión");
      showError(error.name === "AbortError"
        ? "El backend tardó demasiado en responder."
        : error.message);
    } finally {
      $("refreshBtn").disabled = false;
      $("refreshBtn").textContent = "Actualizar";
    }
  }

  function restartTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(refresh, Math.max(5000, Number(DEFAULTS.REFRESH_MS) || 15000));
  }

  function openSettings() {
    const settings = getSettings();
    $("apiUrlInput").value = settings.apiUrl;
    $("deviceIdInput").value = settings.deviceId;
    $("dashboardTokenInput").value = settings.token;
    $("settingsDialog").showModal();
  }

  function initSettings() {
    $("settingsBtn").addEventListener("click", openSettings);

    $("settingsForm").addEventListener("submit", (e) => {
      const submitter = e.submitter;
      if (submitter && submitter.id === "closeSettingsBtn") return;

      e.preventDefault();

      saveSettings({
        apiUrl: cleanBaseUrl($("apiUrlInput").value),
        deviceId: $("deviceIdInput").value.trim() || DEFAULTS.DEVICE_ID,
        token: $("dashboardTokenInput").value.trim()
      });

      $("settingsDialog").close();
      refresh();
    });

    $("clearSettingsBtn").addEventListener("click", () => {
      localStorage.removeItem(LS_KEY);
      $("apiUrlInput").value = cleanBaseUrl(DEFAULTS.API_BASE_URL);
      $("deviceIdInput").value = DEFAULTS.DEVICE_ID;
      $("dashboardTokenInput").value = "";
    });
  }

  function init() {
    const settings = getSettings();
    $("deviceSubtitle").textContent = settings.deviceId;
    $("refreshBtn").addEventListener("click", refresh);
    initSettings();
    restartTimer();

    if (hasPlaceholderUrl(settings.apiUrl)) {
      showError("Falta configurar la URL pública del backend en Render.");
      setConnection("warn", "Configuración pendiente");
      setTimeout(openSettings, 250);
    } else {
      refresh();
    }

    window.addEventListener("resize", () => {
      if (lastDashboard) renderCharts(lastDashboard.history);
    });
  }

  document.addEventListener("DOMContentLoaded", init);
})();
