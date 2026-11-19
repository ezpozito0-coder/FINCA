const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.join(__dirname, '..');

function checkHtmlScripts(relPath) {
    const full = path.join(root, relPath);
    assert(fs.existsSync(full), `Falta archivo: ${relPath}`);
    const html = fs.readFileSync(full, 'utf8');
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)];
    let count = 0;
    for (const m of scripts) {
        if (!m[1].trim()) continue;
        new vm.Script(m[1], { filename: full });
        count++;
    }
    assert(count > 0, `No se encontraron scripts válidos en ${relPath}`);
    console.log(`[OK] ${relPath} (${count} scripts válidos)`);
}

function checkJsFile(relPath) {
    const full = path.join(root, relPath);
    assert(fs.existsSync(full), `Falta archivo JS: ${relPath}`);
    new vm.Script(fs.readFileSync(full, 'utf8'), { filename: full });
    console.log(`[OK] ${relPath} (sintaxis válida)`);
}

function checkWaypointIconsUnique() {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const mCats = html.match(/const WP_ICON_CATEGORIES = \[[\s\S]*?\n        \];/);
    const mFn = html.match(/function getSvgIconoWp\(cat, item, catColor\) \{[\s\S]*?\n        \}/);
    assert(mCats && mFn, 'No se encontró WP_ICON_CATEGORIES o getSvgIconoWp');
    const ctx = {};
    vm.runInNewContext(mCats[0].replace('const WP_ICON_CATEGORIES', 'var WP_ICON_CATEGORIES') + '\n' + mFn[0], ctx);
    const svgs = new Set();
    let total = 0;
    for (const c of ctx.WP_ICON_CATEGORIES) {
        for (const it of c.items) {
            total++;
            svgs.add(ctx.getSvgIconoWp(c.id, it, c.color));
        }
    }
    assert.strictEqual(svgs.size, total, `Iconos SVG duplicados: ${total - svgs.size}`);
    console.log(`[OK] Waypoints SVG únicos: ${svgs.size}/${total}`);
}

checkHtmlScripts('index.html');
checkHtmlScripts('dist_nube/index.html');
checkJsFile('js/finca-campo-pro.js');
checkJsFile('dist_nube/js/finca-campo-pro.js');
checkJsFile('sw.js');
checkJsFile('dist_nube/sw.js');
checkJsFile('server.js');
checkWaypointIconsUnique();
console.log('TODAS LAS VERIFICACIONES PASARON CORRECTAMENTE.');
