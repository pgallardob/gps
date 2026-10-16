(function (root) {
    "use strict";

    class SharingPanel {
        constructor({ apiUrl, onLocations = () => {}, onFocus = () => {} }) {
            this.client = new root.PuntoSharing.Client(apiUrl);
            this.onLocations = onLocations;
            this.onFocus = onFocus;
            this.entries = [];
            this.generation = 0;
            this.polling = false;
            this.creating = false;
            this.timer = null;
            this.byId = id => document.getElementById(id);
            this.form = this.byId("sharing-form");
            this.status = this.byId("sharing-status");
            this.owner = this.byId("sharing-owner-key");
            this.phone = this.byId("sharing-phone");
            this.list = this.byId("sharing-list");
            this.createButton = this.byId("sharing-create-btn");
            const supported = this.client.enabled && root.top === root.self && root.isSecureContext;
            for (const control of this.form.elements) control.disabled = !supported;
            this.status.textContent = supported
                ? "Conexión configurada. Introduce la clave privada del propietario para crear una invitación."
                : "Falta configurar el servicio HTTPS de invitaciones. GitHub Pages aloja la PWA, pero no ejecuta este servicio.";
            this.form.addEventListener("submit", event => { event.preventDefault(); if (supported) this.create(); });
            document.addEventListener("visibilitychange", () => {
                if (document.hidden) {
                    this.generation += 1;
                    this.pause();
                    for (const entry of this.entries) entry.point = null;
                    this.renderLocations();
                } else if (this.entries.length) this.resume();
            });
            root.addEventListener("pagehide", () => this.disconnect());
        }

        async create() {
            if (this.creating) return;
            if (this.entries.length >= 5) { this.status.textContent = "Hay un máximo de cinco invitaciones visibles. Revoca o quita una para continuar."; return; }
            let phone;
            try { phone = root.PuntoSharing.phoneNumber(this.phone.value); }
            catch { this.status.textContent = "Introduce un número internacional, por ejemplo +5491123456789."; return; }
            const token = this.generation;
            this.creating = true;
            this.createButton.disabled = true;
            this.status.textContent = "Creando una invitación privada. No se está buscando ni enviando una ubicación.";
            try {
                const data = await this.client.create(this.owner.value.trim(), Number(this.byId("sharing-minutes").value));
                if (token !== this.generation || document.hidden) {
                    this.client.revoke(data.id, data.viewerToken, true).catch(() => {});
                    return;
                }
                const entry = { id: data.id, token: data.viewerToken, state: "pending", point: null,
                    label: `Teléfono …${phone.slice(-4)}`, url: root.PuntoSharing.invitationLink(document.baseURI, data.id, data.inviteToken) };
                this.entries.push(entry);
                this.addRow(entry);
                this.phone.value = "";
                this.status.textContent = "Invitación creada. Copia o comparte el enlace con ese contacto; solo aparecerá cuando acepte y active su GPS.";
                this.resume();
            } catch (error) {
                this.status.textContent = error.message === "unauthorized" ? "La clave del propietario no es válida. No se creó ninguna invitación."
                    : error.message === "rate_limit" ? "Espera unos segundos o revoca invitaciones antes de crear otra."
                        : "No se pudo crear la invitación. Comprueba la conexión y la configuración del servicio.";
            } finally { this.creating = false; this.createButton.disabled = !this.client.enabled; }
        }

        addRow(entry) {
            const row = document.createElement("li");
            row.className = "sharing-entry";
            const title = document.createElement("strong");
            title.textContent = entry.label;
            const state = document.createElement("p");
            state.className = "route-hint";
            const link = document.createElement("input");
            link.type = "text";
            link.readOnly = true;
            link.className = "text-input private-link";
            link.value = entry.url;
            link.setAttribute("aria-label", `Enlace privado para ${entry.label}`);
            link.autocomplete = "off";
            const actions = document.createElement("div");
            actions.className = "sharing-actions";
            const button = (text, callback) => {
                const value = document.createElement("button");
                value.type = "button";
                value.className = "text-button";
                value.textContent = text;
                value.addEventListener("click", callback);
                actions.append(value);
                return value;
            };
            const copy = button("Copiar enlace", async () => {
                try { await navigator.clipboard.writeText(entry.url); this.status.textContent = "Enlace copiado. Envíalo únicamente al contacto que quieres invitar."; }
                catch { link.select(); this.status.textContent = "Copia manualmente el enlace seleccionado."; }
            });
            const share = button("Compartir invitación", async () => {
                if (!navigator.share) { copy.click(); return; }
                try { await navigator.share({ title: "Invitación de Punto", text: "Comparte tu ubicación solo si reconoces a quien te envía este enlace.", url: entry.url }); }
                catch { this.status.textContent = "No se envió la invitación desde este diálogo. Puedes copiar el enlace manualmente."; }
            });
            const focus = button("Ver en el mapa", () => { if (entry.point && !entry.stopRequested) this.onFocus(entry); });
            const revoke = button("Revocar", () => this.remove(entry));
            row.append(title, state, link, actions);
            entry.ui = { row, state, link, copy, share, focus, revoke };
            this.list.append(row);
            this.renderEntry(entry);
        }

        renderEntry(entry) {
            const open = ["pending", "active"].includes(entry.state);
            entry.ui.state.textContent = entry.stopRequested ? "No se confirmó la revocación. Reintenta; la sesión también vence por inactividad."
                : entry.error ? "Sin conexión. La posición se oculta hasta recibir datos recientes."
                    : entry.state === "pending" ? "Pendiente de aceptación. Aún no hay ubicación."
                        : entry.state === "active" ? entry.point ? `Compartiendo · precisión estimada ±${Math.round(entry.point.accuracy)} m` : "Esperando una posición reciente."
                            : "La invitación finalizó. Ya no se muestra ninguna posición.";
            entry.ui.focus.disabled = !entry.point || entry.stopRequested;
            entry.ui.copy.disabled = entry.ui.share.disabled = !open || entry.stopRequested;
            entry.ui.revoke.textContent = !open ? "Quitar" : entry.stopRequested ? "Reintentar revocación" : "Revocar";
            if (!open) { entry.url = ""; entry.ui.link.value = ""; }
        }

        renderLocations() {
            this.onLocations(this.entries.filter(entry => entry.point && !entry.stopRequested).map(entry => ({
                id: entry.id, label: entry.label, point: { ...entry.point }
            })));
        }

        pause() { clearInterval(this.timer); this.timer = null; }

        resume() {
            if (document.hidden) return;
            if (this.timer === null) this.timer = setInterval(() => this.poll(), 5000);
            this.poll();
        }

        async poll() {
            if (this.polling || document.hidden) return;
            const token = this.generation;
            this.polling = true;
            try {
                await Promise.allSettled(this.entries.filter(entry => !entry.stopRequested && ["pending", "active"].includes(entry.state)).map(async entry => {
                    try {
                        const data = await this.client.view(entry.id, entry.token);
                        if (token !== this.generation || !this.entries.includes(entry) || entry.stopRequested) return;
                        entry.state = data.state;
                        entry.point = data.point;
                        entry.error = false;
                    } catch (error) {
                        if (token !== this.generation || !this.entries.includes(entry) || entry.stopRequested) return;
                        entry.point = null;
                        entry.error = true;
                        if (["not_found", "closed", "unauthorized"].includes(error.message)) entry.state = "stopped";
                    }
                    this.renderEntry(entry);
                }));
                if (token === this.generation) this.renderLocations();
            } finally { this.polling = false; }
        }

        async remove(entry) {
            entry.point = null;
            entry.stopRequested = true;
            this.renderLocations();
            if (["pending", "active"].includes(entry.state)) {
                try { await this.client.revoke(entry.id, entry.token); }
                catch { this.renderEntry(entry); return; }
            }
            this.entries = this.entries.filter(value => value !== entry);
            entry.ui.row.remove();
            entry.url = entry.token = "";
            if (!this.entries.length) this.pause();
        }

        disconnect() {
            this.generation += 1;
            this.pause();
            const entries = this.entries;
            this.entries = [];
            this.owner.value = this.phone.value = "";
            this.list.replaceChildren();
            this.renderLocations();
            for (const entry of entries) {
                if (["pending", "active"].includes(entry.state)) this.client.revoke(entry.id, entry.token, true).catch(() => {});
                entry.url = entry.token = "";
            }
            if (entries.length) this.status.textContent = "Invitaciones retiradas de esta página. Se intentó revocarlas; sin conexión, el servicio las cierra por inactividad o vencimiento.";
        }
    }

    root.SharingPanel = SharingPanel;
})(window);
