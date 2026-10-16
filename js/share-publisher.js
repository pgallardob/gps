(function (root) {
    "use strict";

    const sharing = typeof module === "object" && module.exports ? require("./sharing-client.js") : root.PuntoSharing;

    class Publisher {
        constructor({ client, geolocation, onState = () => {}, onPoint = () => {}, hidden = () => false,
            setTimer = (callback, delay) => root.setInterval(callback, delay), clearTimer = timer => root.clearInterval(timer), now = () => performance.now() }) {
            this.client = client;
            this.geolocation = geolocation;
            this.onState = onState;
            this.onPoint = onPoint;
            this.hidden = hidden;
            this.setTimer = setTimer;
            this.clearTimer = clearTimer;
            this.now = now;
            this.generation = 0;
            this.timer = null;
            this.invitation = null;
            this.publisher = null;
            this.running = false;
            this.busy = false;
            this.deadline = 0;
        }

        async load(invitation) {
            const token = ++this.generation;
            this.invitation = invitation;
            const preview = await this.client.preview(invitation.id, invitation.token);
            if (token !== this.generation) throw new Error("canceled");
            this.onState("ready", preview);
            return preview;
        }

        fix() {
            if (!this.geolocation) return Promise.reject(new Error("unsupported"));
            return new Promise((resolve, reject) => this.geolocation.getCurrentPosition(position => {
                const point = position && position.coords;
                if (!sharing.validPosition(point)) reject(new Error("invalid_position"));
                else resolve({ latitude: point.latitude, longitude: point.longitude, accuracy: point.accuracy });
            }, error => reject(new Error(error.code === 1 ? "permission" : "gps_error")), { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }));
        }

        async start(consent) {
            if (consent !== true) { this.onState("consent_required"); return; }
            if (!this.invitation || this.running || this.busy || this.hidden()) return;
            const token = ++this.generation;
            const invitation = this.invitation;
            let acceptAttempted = false;
            this.busy = true;
            this.onState("locating");
            try {
                const point = await this.fix();
                if (token !== this.generation || this.hidden()) return;
                acceptAttempted = true;
                const acceptance = await this.client.accept(invitation.id, invitation.token);
                if (token !== this.generation || this.hidden()) {
                    await this.client.revoke(invitation.id, acceptance.publisherToken, true).catch(() => {});
                    return;
                }
                this.publisher = acceptance.publisherToken;
                this.deadline = this.now() + acceptance.remainingSeconds * 1000;
                this.running = true;
                await this.client.publish(invitation.id, this.publisher, point);
                if (token !== this.generation) return;
                this.onState("active", acceptance);
                this.onPoint(point);
                this.timer = this.setTimer(() => this.tick(), 10000);
            } catch (error) {
                if (token !== this.generation) return;
                if (acceptAttempted) await this.stop(error.message);
                else { this.busy = false; this.onState(error.message); }
            } finally { if (token === this.generation) this.busy = false; }
        }

        async tick() {
            if (!this.running || this.busy) return;
            if (this.hidden() || this.now() >= this.deadline) { await this.stop(this.hidden() ? "hidden" : "expired"); return; }
            const token = this.generation;
            this.busy = true;
            try {
                const point = await this.fix();
                if (token !== this.generation || !this.running || this.hidden()) return;
                await this.client.publish(this.invitation.id, this.publisher, point);
                if (token === this.generation) this.onPoint(point);
            } catch (error) { if (token === this.generation) await this.stop(error.message); }
            finally { if (token === this.generation) this.busy = false; }
        }

        async stop(reason = "stopped") {
            const token = ++this.generation;
            const timer = this.timer;
            this.timer = null;
            this.running = this.busy = false;
            try { this.clearTimer(timer); } catch { /* Never leave publishing enabled if timer cleanup fails. */ }
            const invitation = this.invitation;
            const capability = this.publisher || (invitation && invitation.token);
            this.publisher = null;
            this.onState(reason, { confirmed: false });
            if (invitation && capability) {
                try {
                    await this.client.revoke(invitation.id, capability, true);
                    if (token === this.generation) this.onState(reason, { confirmed: true });
                } catch { /* Server freshness and expiry limits apply if revocation cannot reach it. */ }
            }
        }
    }

    if (typeof module === "object" && module.exports) module.exports = Publisher;
    else root.LocationPublisher = Publisher;

    if (typeof document === "undefined") return;
    const byId = id => document.getElementById(id);
    const start = byId("share-start-btn");
    if (!start) return;
    const invitation = sharing.parseInvitation(root.location.hash);
    if (root.location.hash) root.history.replaceState(null, "", root.location.pathname + root.location.search);
    const client = new sharing.Client(root.GPS_CONFIG.sharingApiUrl);
    const status = byId("publisher-status");
    const stop = byId("share-stop-btn");
    const consent = byId("share-consent");
    let ready = false;
    const publisher = new Publisher({
        client, geolocation: navigator.geolocation, hidden: () => document.hidden,
        onState: (state, detail = {}) => {
            const messages = {
                ready: "Invitación válida. Todavía no se solicitó ni envió tu ubicación.",
                locating: "Buscando tu posición. Puedes cancelar; aún no se está transmitiendo.",
                active: "Estás compartiendo tu ubicación. Mantén esta pantalla abierta y visible.",
                stopped: "GPS detenido. No se enviarán más posiciones.", hidden: "Compartir se detuvo al ocultar esta pantalla.",
                expired: "El tiempo de compartir terminó.", permission: "No diste permiso de ubicación. No se envió ninguna posición; puedes revisar el permiso y volver a intentar.",
                consent_required: "Marca la casilla de consentimiento antes de continuar.", unsupported: "Este navegador no dispone de GPS.",
                viewer_offline: "La persona que te invitó no está conectada. Pídele que abra su mapa y envíe otra invitación.",
                invitation_used: "Esta invitación ya fue utilizada. Solicita un enlace nuevo.",
                closed: "La invitación terminó o fue revocada.", disconnected: "La conexión de compartir terminó. Solicita una invitación nueva."
            };
            status.textContent = messages[state] || "Se detuvo la transmisión por un error de GPS o conexión. No se enviarán más posiciones.";
            if (["stopped", "hidden", "expired"].includes(state)) status.textContent += detail.confirmed ? " El servicio confirmó la revocación." : " La revocación remota se intenta; si no hay conexión, vence por tiempo de inactividad.";
            if (state === "ready") ready = true;
            if (!["ready", "permission", "unsupported", "consent_required", "locating", "active"].includes(state)) ready = false;
            start.disabled = !ready || publisher.running || publisher.busy || !consent.checked;
            stop.disabled = !(publisher.running || publisher.busy || ready);
            document.body.dataset.sharing = state === "active" ? "active" : "idle";
            if (state !== "active") byId("publisher-last-update").textContent = "";
        },
        onPoint: point => { byId("publisher-last-update").textContent = `Posición enviada · precisión estimada ±${Math.round(point.accuracy)} m · ${new Date().toLocaleTimeString("es")}`; }
    });
    consent.addEventListener("change", () => { start.disabled = !ready || !consent.checked || publisher.running || publisher.busy; });
    start.addEventListener("click", () => publisher.start(consent.checked));
    stop.addEventListener("click", () => { ready = false; publisher.stop(); });
    document.addEventListener("visibilitychange", () => { if (document.hidden && (publisher.running || publisher.busy)) { ready = false; publisher.stop("hidden"); } });
    root.addEventListener("pagehide", () => publisher.stop("hidden"));
    if (root.top !== root.self || !root.isSecureContext) status.textContent = "Abre este enlace directamente en un navegador seguro HTTPS, no dentro de otra página.";
    else if (!client.enabled) status.textContent = "El servicio de compartir aún no está configurado. Pide un enlace al propietario cuando lo haya habilitado.";
    else if (!invitation) status.textContent = "No hay una invitación válida. Pide un enlace nuevo a tu contacto.";
    else {
        byId("relay-origin").textContent = client.base.origin;
        publisher.load(invitation).then(info => {
            byId("share-duration").textContent = `La autorización vence en un máximo de ${Math.ceil(info.remainingSeconds / 60)} minutos.`;
        }).catch(() => { status.textContent = "La invitación no está disponible, terminó o no se pudo contactar al servicio."; });
    }
})(globalThis);
