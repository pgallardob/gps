(function () {
    "use strict";

    const config = window.GPS_CONFIG;
    const ids = `locate-btn start-btn stop-btn recenter-btn fit-route-btn copy-btn export-btn clear-btn
        status status-box tracking-badge lat lon address address-btn last-update distance accuracy speed point-count
        follow-toggle map-mode map-notice retry-map-btn external-map-link action-feedback connection-label connection-badge
        demo-btn demo-step-btn demo-banner position-source export-format import-btn import-file goal-km goal-progress goal-label
        elapsed-time average-speed waypoint-name waypoint-count waypoint-list waypoint-empty save-waypoint-btn pick-waypoint-btn
        pause-map-toggle pause-hidden-toggle forget-btn open-qgis-btn qgis-check-btn qgis-status qgis-install-link`.split(/\s+/);
    const elements = Object.fromEntries(ids.map(id => [id, document.getElementById(id)]));
    const routeOptions = { minDistance: config.minPointDistance, maxAccuracy: config.maxPointAccuracy, maxPoints: config.maxRoutePoints };
    const route = new GPSCore.Route(routeOptions);
    const addresses = new AddressLookup({ endpoint: config.reverseGeocodingUrl, minInterval: config.addressMinInterval });
    const clock = new GPSSession.SessionClock();
    const qgis = new QgisClient();
    const numberFormat = new Intl.NumberFormat("es", { maximumFractionDigits: 1 });
    let currentPoint = null;
    let addressPoint = null;
    let map = null;
    let latestTileState = "loading";
    let routeDirty = false;
    let feedbackTimer;
    let clockTimer = null;
    let demoTimer = null;
    let demoMode = false;
    let demoRunning = false;
    let demoIndex = 0;
    let demoEpoch = 0;
    let mapPaused = false;
    let pickingWaypoint = false;
    let waypoints = [];
    let nextWaypointId = 1;
    let goalAnnounced = false;
    let sessionDistance = 0;
    let sessionVersion = 0;
    let addressVersion = 0;
    let importBusy = false;
    let qgisAvailable = false;
    let qgisBusy = false;
    let sharingPanel = null;

    function setStatus(message, tone = "neutral") {
        if (elements.status.textContent !== message) elements.status.textContent = message;
        elements["status-box"].dataset.tone = tone;
    }

    function feedback(message) {
        clearTimeout(feedbackTimer);
        elements["action-feedback"].textContent = message;
        elements["action-feedback"].hidden = false;
        feedbackTimer = setTimeout(() => { elements["action-feedback"].hidden = true; }, 6500);
    }

    function isRecording() { return demoRunning || tracker.state === "tracking"; }

    function syncButtons() {
        const busy = isRecording() || tracker.state === "locating";
        const hasData = route.pointCount > 0 || waypoints.length > 0;
        elements["start-btn"].disabled = busy || importBusy || (demoMode && demoIndex >= 48);
        elements["locate-btn"].disabled = busy || demoMode || importBusy;
        elements["stop-btn"].disabled = !busy;
        elements["recenter-btn"].disabled = !currentPoint || !map;
        elements["copy-btn"].disabled = !currentPoint;
        elements["export-btn"].disabled = !hasData || importBusy;
        elements["clear-btn"].disabled = !route.pointCount || importBusy;
        elements["fit-route-btn"].disabled = !route.pointCount || !map;
        elements["address-btn"].disabled = !currentPoint || !addresses.enabled || addresses.busy || demoMode || mapPaused;
        elements["demo-btn"].disabled = importBusy;
        elements["demo-step-btn"].hidden = !demoMode;
        elements["demo-step-btn"].disabled = demoRunning || demoIndex >= 48;
        elements["import-btn"].disabled = importBusy;
        elements["import-file"].disabled = importBusy;
        elements["save-waypoint-btn"].disabled = !currentPoint || waypoints.length >= RouteFiles.MAX_WAYPOINTS || importBusy;
        elements["pick-waypoint-btn"].disabled = !map || waypoints.length >= RouteFiles.MAX_WAYPOINTS || importBusy;
        elements["external-map-link"].hidden = !currentPoint || demoMode || mapPaused;
        elements["open-qgis-btn"].disabled = !hasData || importBusy || qgisBusy || !qgisAvailable;
        elements["qgis-check-btn"].disabled = qgisBusy;
    }

    function updateClock() {
        elements["elapsed-time"].textContent = GPSSession.formatDuration(clock.elapsed);
        elements["average-speed"].textContent = !demoMode && clock.elapsed >= 1000 && sessionDistance > 0
            ? `${numberFormat.format(sessionDistance / (clock.elapsed / 3600000) / 1000)} km/h` : "—";
    }

    function startClock() {
        clock.start();
        if (clockTimer === null) clockTimer = setInterval(updateClock, 1000);
    }

    function pauseClock() {
        clock.pause();
        clearInterval(clockTimer);
        clockTimer = null;
        updateClock();
    }

    function updateMetrics() {
        const kilometers = route.distance >= 1000;
        metricWithUnit(elements.distance, numberFormat.format(kilometers ? route.distance / 1000 : Math.round(route.distance)), kilometers ? "km" : "m");
        elements["point-count"].textContent = route.pointCount;
        const goal = Number(elements["goal-km"].value);
        const percent = Number.isFinite(goal) && goal >= .05 && goal <= 1000 ? Math.min(100, route.distance / (goal * 1000) * 100) : 0;
        elements["goal-progress"].value = percent;
        elements["goal-label"].textContent = `${Math.floor(percent)} % de tu meta${demoMode ? " · simulación" : ""}`;
        if (percent >= 100 && !goalAnnounced) {
            goalAnnounced = true;
            feedback(demoMode ? "¡Meta alcanzada en la demostración! Son datos simulados." : "¡El recorrido alcanzó tu meta de distancia!");
        }
        updateClock();
    }

    function metricWithUnit(element, value, unitText) {
        const unit = document.createElement("small");
        unit.textContent = unitText;
        element.replaceChildren(document.createTextNode(`${value} `), unit);
    }

    function onPosition(position, forceRecord = false) {
        let point;
        try { point = GPSCore.toPoint(position); }
        catch { return false; }
        if (currentPoint && point.timestamp < currentPoint.timestamp) return;
        point.source = demoMode ? "demo" : "gps";
        const firstPosition = !currentPoint;
        currentPoint = point;
        elements.lat.textContent = point.lat.toFixed(6);
        elements.lon.textContent = point.lon.toFixed(6);
        metricWithUnit(elements.accuracy, `±${Math.round(point.accuracy)}`, "m");
        metricWithUnit(elements.speed, point.speed === null ? "—" : numberFormat.format(point.speed), "km/h");
        const date = new Date(point.timestamp);
        elements["last-update"].textContent = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        elements["last-update"].dateTime = date.toISOString();
        elements["position-source"].textContent = demoMode ? "DEMOSTRACIÓN · ubicación simulada" : "Ubicación informada por tu dispositivo";
        elements["external-map-link"].href = `https://www.openstreetmap.org/?mlat=${point.lat}&mlon=${point.lon}#map=17/${point.lat}/${point.lon}`;
        const center = firstPosition || tracker.state === "locating" || elements["follow-toggle"].checked;
        if (map) map.updatePosition(point, center);
        if (center) elements["map-mode"].textContent = demoMode ? "Demostración · coordenadas simuladas" : "Tu ubicación actual";
        if (addresses.enabled && !demoMode && !mapPaused && (!addressPoint || GPSCore.distanceMeters(addressPoint, point) > 30)) {
            addressPoint = null;
            elements.address.textContent = "Pulsa Consultar dirección para buscar esta posición.";
        }
        if (isRecording() || forceRecord) {
            const before = route.distance;
            const result = route.add(point);
            if (result === "limit") {
                stopAll();
                setStatus("Límite de puntos alcanzado. Exporta y borra el recorrido para continuar.", "warning");
            } else if (result === "inaccurate") setStatus("Señal imprecisa. Este punto se muestra, pero no se guarda en el recorrido.", "warning");
            else setStatus(demoMode ? "DEMOSTRACIÓN: recorrido simulado, sin usar el GPS." : "Rastreo activo. El recorrido se registra solo en esta sesión.", demoMode ? "warning" : "success");
            if (result === "added") {
                routeDirty = true;
                sessionDistance += route.distance - before;
                if (map) map.drawRoute(route.segments);
            }
            updateMetrics();
        }
        syncButtons();
    }

    function onState(state, reason) {
        const labels = { idle: "En espera", locating: "Buscando GPS", tracking: "Rastreando", ready: "Ubicación lista", paused: "Detenido", error: "Revisar GPS" };
        elements["tracking-badge"].textContent = labels[state];
        elements["tracking-badge"].dataset.active = state === "tracking";
        if (state === "tracking") {
            route.startSegment();
            startClock();
            setStatus("Rastreo iniciado. Buscando señal GPS…", "success");
        } else {
            pauseClock();
            if (state === "locating") setStatus("Buscando tu ubicación. Permite el acceso al GPS si aparece un aviso.");
            else if (state === "ready") {
                if (currentPoint && currentPoint.accuracy > config.maxPointAccuracy) setStatus("Ubicación obtenida con precisión baja. Revisa el área de precisión.", "warning");
                else setStatus("Ubicación actualizada. Inicia el rastreo para registrar un recorrido.", "success");
            } else if (state === "paused") setStatus("Rastreo detenido. Tu posición y tu recorrido siguen visibles.");
            else if (state === "error") {
                const messages = {
                    insecure: "El GPS necesita HTTPS o localhost. Abre la aplicación con start.bat.",
                    unsupported: "Este navegador no ofrece geolocalización. Puedes usar el mapa o la demo.",
                    permission: "Permiso de ubicación denegado. Actívalo en la configuración del sitio y vuelve a intentarlo.",
                    unavailable: "Ubicación no disponible. Revisa el GPS o los servicios de ubicación del equipo.",
                    timeout: "El GPS tardó demasiado. Acércate a una ventana o vuelve a intentarlo.",
                    invalid: "El navegador devolvió una posición inválida. Intenta obtenerla de nuevo.",
                    unknown: "No se pudo iniciar el GPS. Revisa los permisos y vuelve a intentarlo."
                };
                setStatus(messages[reason] || messages.unknown, "error");
            }
        }
        syncButtons();
    }

    const tracker = new LocationTracker({ geolocation: navigator.geolocation, secure: window.isSecureContext, options: config.geoOptions, onPosition, onState });

    function pauseDemo() {
        clearInterval(demoTimer);
        demoTimer = null;
        demoRunning = false;
        route.startSegment();
        pauseClock();
        if (demoMode) {
            elements["tracking-badge"].textContent = demoIndex >= 48 ? "Demo completa" : "Demo en pausa";
            elements["tracking-badge"].dataset.active = "false";
            setStatus("Demostración en pausa. Puedes reanudarla o avanzar un punto manualmente.", "warning");
        }
        syncButtons();
    }

    function stopAll() {
        if (tracker.state === "tracking" || tracker.state === "locating") tracker.stop();
        if (demoMode) pauseDemo();
    }

    function advanceDemo() {
        if (!demoMode) return;
        const position = GPSSession.demoPosition(demoIndex, demoEpoch + demoIndex * 1000);
        if (!position) return;
        demoIndex += 1;
        onPosition(position, true);
        if (demoIndex >= 48) { pauseDemo(); setStatus("Demostración completada. Puedes exportarla o salir para usar el GPS real.", "warning"); }
        syncButtons();
    }

    function startDemo() {
        if (demoRunning || demoIndex >= 48) return;
        demoRunning = true;
        route.startSegment();
        startClock();
        elements["tracking-badge"].textContent = "Demo activa";
        elements["tracking-badge"].dataset.active = "true";
        if (demoIndex === 0) advanceDemo();
        if (demoRunning) demoTimer = setInterval(() => { if (demoRunning && demoMode) advanceDemo(); }, 1000);
        syncButtons();
    }

    function renderMapState(state) {
        latestTileState = state;
        const messages = { loading: "Cargando el mapa…", error: "No se cargaron algunas partes del mapa. Revisa tu conexión y pulsa Reintentar mapa.", unavailable: "No se pudo iniciar el mapa. Comprueba los archivos locales de Leaflet." };
        elements["map-notice"].hidden = !mapPaused && navigator.onLine && state === "ready";
        elements["map-notice"].textContent = mapPaused ? "Mapa externo pausado. Solo se muestran tus trazos y puntos locales."
            : !navigator.onLine ? "Sin conexión. Las partes del mapa no disponibles necesitan internet." : (messages[state] || "");
        elements["retry-map-btn"].hidden = mapPaused || state !== "error";
    }

    try {
        map = new GPSMap(config, {
            onTileState: renderMapState,
            onUserMove: () => { elements["follow-toggle"].checked = false; elements["map-mode"].textContent = "Vista libre · seguimiento de cámara desactivado"; },
            onPick: point => { if (pickingWaypoint) addWaypoint(point); }
        });
    } catch (error) { console.error("Map initialization failed:", error); renderMapState("unavailable"); }

    function setMapPaused(paused) {
        mapPaused = paused;
        elements["pause-map-toggle"].checked = paused;
        if (map) map.setTilesEnabled(!paused);
        addressVersion += 1;
        addresses.clear();
        addressPoint = null;
        elements.address.textContent = paused ? "Las consultas externas están pausadas." : initialAddress();
        renderMapState(latestTileState);
        syncButtons();
    }

    function updateConnection() {
        elements["connection-label"].textContent = navigator.onLine ? "En línea" : "Sin conexión";
        elements["connection-badge"].dataset.offline = !navigator.onLine;
        renderMapState(latestTileState);
    }

    function initialAddress() {
        return addresses.enabled ? "Obtén tu ubicación y pulsa Consultar dirección para buscarla." : "Sin proveedor autorizado configurado. El mapa y el GPS no necesitan esta consulta.";
    }

    function setPicking(enabled) {
        pickingWaypoint = enabled;
        elements["pick-waypoint-btn"].setAttribute("aria-pressed", String(enabled));
        elements["pick-waypoint-btn"].textContent = enabled ? "Cancelar selección" : "Elegir en el mapa";
        document.querySelector(".map-stage").classList.toggle("picking-point", enabled);
    }

    function renderWaypoints() {
        elements["waypoint-list"].replaceChildren();
        elements["waypoint-count"].textContent = `${waypoints.length}/100`;
        elements["waypoint-empty"].hidden = waypoints.length > 0;
        for (const point of waypoints) {
            const item = document.createElement("li");
            const center = document.createElement("button");
            center.type = "button";
            center.className = "text-button waypoint-label";
            center.textContent = point.name;
            center.addEventListener("click", () => {
                if (map) map.center(point);
                elements["follow-toggle"].checked = false;
                elements["map-mode"].textContent = "Punto favorito seleccionado";
            });
            const remove = document.createElement("button");
            remove.type = "button";
            remove.className = "remove-waypoint";
            remove.textContent = "×";
            remove.setAttribute("aria-label", `Eliminar ${point.name}`);
            remove.addEventListener("click", () => {
                waypoints = waypoints.filter(value => value.id !== point.id);
                routeDirty = route.pointCount > 0 || waypoints.length > 0;
                renderWaypoints();
                syncButtons();
            });
            item.append(center, remove);
            elements["waypoint-list"].append(item);
        }
        if (map) map.drawWaypoints(waypoints);
    }

    function addWaypoint(point) {
        if (!point || !Number.isFinite(point.lat) || Math.abs(point.lat) > 90 || !Number.isFinite(point.lon) || Math.abs(point.lon) > 180 || waypoints.length >= RouteFiles.MAX_WAYPOINTS) return;
        let name;
        try { name = RouteFiles.cleanName(elements["waypoint-name"].value || `Punto ${nextWaypointId}`); }
        catch { feedback("El nombre del punto no puede superar los 80 caracteres."); return; }
        waypoints.push({ id: nextWaypointId++, lat: point.lat, lon: point.lon, name, source: demoMode ? "demo" : (point.source || "manual") });
        elements["waypoint-name"].value = "";
        routeDirty = true;
        setPicking(false);
        renderWaypoints();
        syncButtons();
        feedback("Punto guardado en esta sesión. Se incluirá al exportar.");
    }

    function resetSession() {
        stopAll();
        sessionVersion += 1;
        addressVersion += 1;
        addresses.clear();
        route.clear();
        clock.reset();
        sessionDistance = 0;
        waypoints = [];
        nextWaypointId = 1;
        currentPoint = addressPoint = null;
        demoIndex = 0;
        demoEpoch = Date.now();
        routeDirty = goalAnnounced = false;
        clearTimeout(feedbackTimer);
        elements["action-feedback"].hidden = true;
        elements["action-feedback"].textContent = "";
        elements.lat.textContent = elements.lon.textContent = "—";
        elements["last-update"].textContent = "sin ubicación";
        elements["last-update"].removeAttribute("datetime");
        elements["position-source"].textContent = "Sin lectura GPS";
        elements["map-mode"].textContent = "Vista general · explora el mundo";
        elements["external-map-link"].removeAttribute("href");
        elements.address.textContent = mapPaused ? "Las consultas externas están pausadas." : initialAddress();
        metricWithUnit(elements.accuracy, "—", "m");
        metricWithUnit(elements.speed, "—", "km/h");
        elements["waypoint-name"].value = "";
        setPicking(false);
        if (map) map.reset();
        renderWaypoints();
        updateMetrics();
        syncButtons();
    }

    function renderMode() {
        elements["demo-banner"].hidden = !demoMode;
        elements["demo-btn"].textContent = demoMode ? "Salir de demo y usar GPS real" : "Probar demo sin GPS";
        document.body.dataset.mode = demoMode ? "demo" : "gps";
        elements["tracking-badge"].textContent = demoMode ? "Demo en pausa" : "En espera";
        updateMetrics();
        syncButtons();
    }

    elements["locate-btn"].addEventListener("click", () => { if (!demoMode) tracker.locate(); });
    elements["start-btn"].addEventListener("click", () => { if (demoMode) startDemo(); else tracker.start(); });
    elements["stop-btn"].addEventListener("click", stopAll);
    elements["demo-btn"].addEventListener("click", () => {
        if ((route.pointCount || waypoints.length) && !window.confirm("Cambiar de modo borra el recorrido y los favoritos. Exporta primero si quieres conservarlos. ¿Continuar?")) return;
        resetSession();
        demoMode = !demoMode;
        renderMode();
        if (demoMode) startDemo();
        else setStatus("Demo cerrada. El GPS real solo se solicita al pulsar un botón.");
    });
    elements["demo-step-btn"].addEventListener("click", () => { if (demoMode && !demoRunning) advanceDemo(); });
    elements["recenter-btn"].addEventListener("click", () => { if (currentPoint && map) { map.center(currentPoint); elements["map-mode"].textContent = demoMode ? "Ubicación simulada" : "Tu ubicación actual"; } });
    elements["follow-toggle"].addEventListener("change", () => { if (elements["follow-toggle"].checked && currentPoint && map) map.center(currentPoint); });
    elements["fit-route-btn"].addEventListener("click", () => {
        if (map) map.fitRoute(route.segments);
        elements["follow-toggle"].checked = false;
        elements["map-mode"].textContent = "Vista del recorrido completo";
    });
    elements["retry-map-btn"].addEventListener("click", () => { if (map) map.retry(); });
    elements["pause-map-toggle"].addEventListener("change", () => setMapPaused(elements["pause-map-toggle"].checked));
    elements["save-waypoint-btn"].addEventListener("click", () => addWaypoint(currentPoint));
    elements["pick-waypoint-btn"].addEventListener("click", () => { setPicking(!pickingWaypoint); if (pickingWaypoint) feedback("Haz clic en el mapa para guardar el punto con el nombre indicado."); });
    elements["goal-km"].addEventListener("change", () => {
        if (!elements["goal-km"].checkValidity() || !Number.isFinite(Number(elements["goal-km"].value))) {
            elements["goal-km"].value = "1";
            feedback("La meta debe estar entre 0,05 y 1.000 km, en pasos de 0,05 km.");
        }
        goalAnnounced = false;
        updateMetrics();
    });

    elements["copy-btn"].addEventListener("click", async () => {
        if (!currentPoint) return;
        const version = sessionVersion;
        try {
            await navigator.clipboard.writeText(`${currentPoint.lat.toFixed(6)}, ${currentPoint.lon.toFixed(6)}`);
            if (version === sessionVersion) feedback(demoMode ? "Coordenadas SIMULADAS copiadas." : "Coordenadas copiadas al portapapeles.");
        } catch { if (version === sessionVersion) feedback("No se pudo acceder al portapapeles. Puedes copiar las coordenadas del panel."); }
    });

    elements["export-btn"].addEventListener("click", () => {
        if (!route.pointCount && !waypoints.length) return;
        const gpx = elements["export-format"].value === "gpx";
        try {
            const data = gpx ? RouteFiles.toGPX(route, waypoints) : JSON.stringify(RouteFiles.toGeoJSON(route, waypoints), null, 2);
            const blob = new Blob([data], { type: gpx ? "application/gpx+xml" : "application/geo+json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            const simulated = demoMode || route.segments.some(segment => segment.some(point => point.source === "demo")) || waypoints.some(point => point.source === "demo");
            link.download = `punto-${simulated ? "DEMO-" : ""}${new Date().toISOString().replace(/[:.]/g, "-")}.${gpx ? "gpx" : "geojson"}`;
            document.body.append(link);
            link.click();
            link.remove();
            routeDirty = false;
            setTimeout(() => URL.revokeObjectURL(url), 1000);
            feedback("Descarga iniciada. El archivo contiene coordenadas; compártelo con cuidado.");
        } catch { feedback("No se pudo preparar la descarga. Los datos siguen en la sesión."); }
    });

    async function checkQgis() {
        if (qgisBusy) return;
        qgisBusy = true;
        qgisAvailable = false;
        elements["qgis-status"].textContent = "Comprobando QGIS en este equipo…";
        elements["qgis-install-link"].hidden = true;
        syncButtons();
        try {
            const status = await qgis.check();
            qgisAvailable = status.available;
            elements["qgis-status"].textContent = status.available
                ? "QGIS detectado. Abre el recorrido y los favoritos en el formato seleccionado."
                : status.reason === "desktop_only" ? "QGIS solo se abre desde la versión local de escritorio. En el teléfono puedes exportar los archivos."
                    : status.reason === "disabled" ? "La apertura de QGIS está desactivada en el servidor."
                    : "QGIS no detectado. Instálalo y vuelve a comprobar, o configura su ruta al iniciar Punto.";
            elements["qgis-install-link"].hidden = status.available || ["disabled", "desktop_only"].includes(status.reason);
        } catch {
            elements["qgis-status"].textContent = "Para abrir QGIS necesitas el servidor local actualizado: inicia Punto con start.bat. También puedes exportar y abrir el archivo manualmente.";
        } finally { qgisBusy = false; syncButtons(); }
    }

    elements["qgis-check-btn"].addEventListener("click", checkQgis);
    elements["open-qgis-btn"].addEventListener("click", async () => {
        if (!qgisAvailable || qgisBusy || (!route.pointCount && !waypoints.length)) return;
        if (!window.confirm("¿Abrir una copia temporal del recorrido y los favoritos en QGIS? Solo se entrega al lanzador de este equipo. Borrar la sesión no borra esa copia mientras esté abierta. Exporta aparte si quieres un respaldo.")) return;
        const version = sessionVersion;
        qgisBusy = true;
        elements["qgis-status"].textContent = "Enviando la apertura a QGIS…";
        syncButtons();
        try {
            await qgis.open(RouteFiles.toGeoJSON(route, waypoints), elements["export-format"].value);
            elements["qgis-status"].textContent = "Solicitud enviada a QGIS. Es una copia del momento; no se actualiza mientras sigues rastreando.";
            if (version === sessionVersion) feedback("Apertura enviada a QGIS. Conserva una exportación si necesitas guardar el recorrido.");
        } catch (error) {
            const messages = {
                not_installed: "QGIS ya no está disponible. Vuelve a comprobar su instalación.",
                disabled: "La apertura de QGIS está desactivada en el servidor.",
                rate_limit: "Espera al menos cinco segundos antes de volver a abrir QGIS.",
                busy: "Ya hay tres aperturas de QGIS activas. Cierra una antes de continuar.",
                forbidden: "El servidor cambió o rechazó la solicitud. Pulsa Volver a comprobar e intenta de nuevo.",
                too_large: "El recorrido supera el límite de 4 MB para abrirlo en QGIS.",
                invalid_data: "No se pudo validar esta copia. Puedes conservarla con Exportar recorrido.",
                launch_failed: "QGIS no pudo iniciarse. Revisa su instalación o abre el archivo exportado manualmente."
            };
            elements["qgis-status"].textContent = messages[error.message] || "No se confirmó la apertura. QGIS podría haberse iniciado; compruébalo antes de volver a intentarlo.";
        } finally { qgisBusy = false; syncButtons(); }
    });

    elements["clear-btn"].addEventListener("click", () => {
        if (!route.pointCount || !window.confirm("¿Borrar el recorrido? Los favoritos se conservan. Exporta primero si quieres conservar los trazos.")) return;
        route.clear();
        routeDirty = waypoints.length > 0;
        clock.reset();
        sessionDistance = 0;
        goalAnnounced = false;
        if (isRecording()) startClock();
        if (map) map.drawRoute([]);
        updateMetrics();
        syncButtons();
        feedback("Recorrido borrado. Tu posición y tus favoritos siguen visibles.");
    });

    elements["import-btn"].addEventListener("click", () => elements["import-file"].click());
    elements["import-file"].addEventListener("change", async () => {
        const file = elements["import-file"].files[0];
        elements["import-file"].value = "";
        if (!file || importBusy) return;
        if (file.size > RouteFiles.MAX_BYTES) { feedback("Archivo demasiado grande. El límite es de 4 MB."); return; }
        const version = sessionVersion;
        importBusy = true;
        syncButtons();
        try {
            const data = RouteFiles.parseGeoJSON(await file.text());
            const candidate = new GPSCore.Route(routeOptions);
            candidate.replace(data.segments);
            if (version !== sessionVersion) return;
            if ((route.pointCount || waypoints.length) && !window.confirm("La importación reemplazará el recorrido y los favoritos actuales. ¿Continuar?")) return;
            setMapPaused(true);
            resetSession();
            demoMode = false;
            renderMode();
            route.replace(candidate.segments);
            waypoints = data.waypoints.map(point => ({ ...point, id: nextWaypointId++ }));
            renderWaypoints();
            if (map) { map.drawRoute(route.segments); if (route.pointCount) map.fitRoute(route.segments); else if (waypoints.length) map.center(waypoints[0]); }
            elements["follow-toggle"].checked = false;
            elements["map-mode"].textContent = "Archivo local · no es tu posición GPS actual";
            setStatus("Archivo importado y validado. El mapa externo se pausó para no compartir la zona automáticamente.");
            routeDirty = true;
            updateMetrics();
            feedback("Archivo importado sin subirlo a ningún servidor. Puedes reactivar el mapa externo cuando quieras.");
        } catch {
            if (version === sessionVersion) feedback("No se importó el archivo. Usa GeoJSON válido: líneas y puntos, hasta 10.000 posiciones y 100 favoritos. Tu sesión anterior se conserva.");
        } finally { importBusy = false; syncButtons(); }
    });

    elements["forget-btn"].addEventListener("click", () => {
        if (!window.confirm("¿Detener el GPS, intentar revocar las invitaciones y borrar ubicación, recorrido y favoritos de esta página? Las descargas, el portapapeles y las copias abiertas en QGIS no se borran.")) return;
        if (sharingPanel) sharingPanel.disconnect();
        resetSession();
        demoMode = false;
        renderMode();
        setStatus("Sesión borrada y rastreo detenido. No se revocaron los permisos del navegador.");
    });

    elements["address-btn"].addEventListener("click", async () => {
        if (!currentPoint || !addresses.enabled || addresses.busy || demoMode || mapPaused) return;
        const token = addressVersion;
        const point = { ...currentPoint };
        const promise = addresses.lookup(point);
        syncButtons();
        elements.address.textContent = "Consultando la dirección…";
        try {
            const address = await promise;
            if (token !== addressVersion) return;
            if (currentPoint && GPSCore.distanceMeters(point, currentPoint) <= 30) { addressPoint = point; elements.address.textContent = address; }
            else elements.address.textContent = "Tu posición cambió. Consulta la dirección de nuevo.";
        } catch (error) {
            if (token === addressVersion) elements.address.textContent = error.message === "rate-limit" ? "Espera unos segundos antes de volver a consultar." : "No se pudo obtener la dirección. El mapa y el GPS siguen funcionando.";
        } finally { syncButtons(); }
    });

    elements.address.textContent = initialAddress();
    if (!addresses.enabled) elements["address-btn"].title = "Configura un proveedor autorizado y su origen permitido en el servidor.";
    window.addEventListener("online", () => { updateConnection(); if (map && !mapPaused) map.retry(); });
    window.addEventListener("offline", updateConnection);
    document.addEventListener("visibilitychange", () => {
        if (document.hidden && (demoMode || elements["pause-hidden-toggle"].checked)) stopAll();
    });
    window.addEventListener("pagehide", () => { stopAll(); addressVersion += 1; addresses.clear(); });
    window.addEventListener("beforeunload", event => { if (routeDirty) { event.preventDefault(); event.returnValue = ""; } });
    updateConnection();
    renderWaypoints();
    syncButtons();
    checkQgis();
    sharingPanel = new SharingPanel({
        apiUrl: config.sharingApiUrl,
        onLocations: entries => { if (map) map.drawSharedLocations(entries); },
        onFocus: entry => {
            if (map && entry.point) map.center({ lat: entry.point.latitude, lon: entry.point.longitude });
            elements["follow-toggle"].checked = false;
            elements["map-mode"].textContent = "Ubicación compartida con permiso";
        }
    });
})();
