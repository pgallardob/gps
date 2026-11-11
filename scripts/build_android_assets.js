"use strict";

const fs = require("node:fs");
const path = require("node:path");

function dashboard(html) {
    const remove = pattern => {
        if ((html.match(pattern) || []).length !== 1) throw new Error("The reviewed dashboard structure changed; review Android packaging.");
        html = html.replace(pattern, "");
    };
    remove(/\s*<section class="install-banner"[\s\S]*?<\/section>/g);
    remove(/\s*<section class="panel sharing-panel"[\s\S]*?<\/section>/g);
    for (const file of ["pwa", "sharing-client", "sharing"]) {
        remove(new RegExp(`\\s*<script src="js/${file}\\.js" defer><\\/script>`, "g"));
    }
    html = html.replace(/\s*<link rel="manifest"[^>]+>/, "")
        .replace("connect-src 'self'", "connect-src 'none'")
        .replace('<script src="js/app.js"', '<script src="native-adapter.js" defer></script>\n    <script src="js/app.js"')
        .replace('<link rel="stylesheet" href="css/styles.css">', '<link rel="stylesheet" href="css/styles.css">\n    <link rel="stylesheet" href="android.css">')
        .replace("<body>", '<body data-platform="android">')
        .replace('id="pause-hidden-toggle" type="checkbox" checked', 'id="pause-hidden-toggle" type="checkbox" disabled')
        .replace("Pausar rastreo al ocultar la pestaña", "GPS nativo: continúa con la pantalla apagada")
        .replace("Para usar el GPS, abre la aplicación con <strong>start.bat</strong> o en HTTPS y acepta el permiso del navegador.", "Para usar el GPS, pulsa Obtener mi ubicación o Iniciar rastreo y concede los permisos de Punto. La notificación permite detener el rastreo.")
        .replace("Activa el GPS solo cuando tú quieras.", "Activa el GPS solo cuando tú quieras. No necesitas una invitación.");
    if (html.includes('id="sharing-owner-key"') || !html.includes('id="waypoint-list"') || !html.includes('id="import-btn"')) {
        throw new Error("Android must retain the dashboard tools and omit the owner form.");
    }
    return html;
}

function build(root, output) {
    fs.mkdirSync(output, { recursive: true });
    const files = JSON.parse(fs.readFileSync(path.join(root, "public-files.json"), "utf8"));
    for (const file of files) {
        if (typeof file !== "string" || file.includes("..") || file.includes("\\") || path.isAbsolute(file)) throw new Error("Invalid public asset path");
        if (!/^(css\/|js\/|vendor\/leaflet\/|assets\/)/.test(file)) continue;
        const target = path.join(output, file);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.copyFileSync(path.join(root, file), target);
    }
    fs.writeFileSync(path.join(output, "index.html"), dashboard(fs.readFileSync(path.join(root, "index.html"), "utf8")));
    for (const file of ["native-adapter.js", "android.css"]) {
        fs.copyFileSync(path.join(root, "mobile/android/app/src/main/assets", file), path.join(output, file));
    }
}

module.exports = { dashboard, build };
if (require.main === module) {
    const output = process.argv[2];
    if (!output) throw new Error("Supply the generated asset directory.");
    build(path.resolve(__dirname, ".."), path.resolve(output));
}
