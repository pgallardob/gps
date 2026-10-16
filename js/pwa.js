(function (root) {
    "use strict";

    function installed(navigator, matchMedia) {
        return navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
    }

    async function initialize() {
        const button = document.getElementById("pwa-install-btn");
        const status = document.getElementById("pwa-status");
        const help = document.getElementById("pwa-help");
        let prompt = null;
        if (!button || !status) return;
        const showInstalled = () => { button.hidden = true; status.textContent = "Punto está instalada en este dispositivo."; };
        if (installed(navigator, root.matchMedia.bind(root))) showInstalled();
        root.addEventListener("beforeinstallprompt", event => {
            event.preventDefault();
            prompt = event;
            button.hidden = false;
            button.textContent = "Instalar Punto";
        });
        root.addEventListener("appinstalled", showInstalled);
        button.addEventListener("click", async () => {
            if (!prompt) { if (help) help.open = !help.open; return; }
            const event = prompt;
            prompt = null;
            try { await event.prompt(); await event.userChoice; }
            catch { if (help) help.open = true; }
        });
        if (!root.isSecureContext) {
            status.textContent = "La instalación y el GPS necesitan HTTPS. Usa el enlace seguro publicado, no la IP HTTP de tu PC.";
            return;
        }
        if (!("serviceWorker" in navigator)) {
            status.textContent = "Este navegador no permite el modo sin conexión; consulta las instrucciones de instalación.";
            return;
        }
        try {
            const base = new URL("./", document.baseURI);
            const registration = await navigator.serviceWorker.register(new URL("sw.js", base), { scope: base.href, updateViaCache: "none" });
            const updateNotice = () => {
                if (registration.waiting) status.textContent = "Hay una actualización. Exporta tus datos y cierra todas las ventanas de Punto para aplicarla.";
            };
            registration.addEventListener("updatefound", () => {
                const worker = registration.installing;
                if (worker) worker.addEventListener("statechange", updateNotice);
            });
            updateNotice();
        } catch { status.textContent = "No se pudo preparar el modo sin conexión. La aplicación puede seguir usándose con internet."; }
    }

    const api = { installed };
    if (typeof module === "object" && module.exports) module.exports = api;
    else root.PuntoPWA = api;
    if (typeof document !== "undefined") initialize();
})(globalThis);
