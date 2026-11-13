/**
 * =============================================================================
 * FINCA - AgroMacarena 35ha (La Macarena, Meta, Colombia)
 * Servidor Local Offline-First (PC Casa) + Base de Datos SQLite + Gateway LoRa
 * =============================================================================
 * Ejecución directa sin dependencias externas pesadas (usa node:http + node:sqlite
 * nativos de Node.js v22/v24, y soporta Express si está instalado).
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn, execSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'finca_macarena.db');
const SQL_SEED_PATH = path.join(__dirname, 'database.sql');
const DEFAULT_GSHEETS_URL = 'https://script.google.com/macros/s/AKfycbzgXQiTtcpJBLBk_Q4aqaR6xA8bHlsPvW808asZI_VEycQwIm5IQHcXPn8I8Xshyu98Kw/exec';

// Generador determinístico de Certificado Digital Inmutable (NFT Hash SHA-256 local del semoviente)
function generarTokenDigitalAnimal(animal) {
    const base = [
        'FINCA-AGROMACARENA-35HA-META-COL',
        String(animal.id || 0),
        String(animal.codigo_nombre || '').trim(),
        String(animal.raza || 'F1 Gyrolando').trim(),
        String(animal.sexo || 'Hembra').trim(),
        String(animal.categoria_bovino || 'Vaca').trim(),
        String(animal.madre_codigo || 'FUNDACION').trim(),
        String(animal.cria_codigo || '').trim(),
        String(animal.nfc_uid || `NFC-COLLAR-${String(animal.id || 0).padStart(2, '0')}`).trim()
    ].join('|');
    return '0x' + crypto.createHash('sha256').update(base, 'utf8').digest('hex').toUpperCase();
}

// =============================================================================
// 1. INICIALIZACIÓN DE BASE DE DATOS SQLITE (finca_macarena.db)
// =============================================================================
const db = new DatabaseSync(DB_PATH);

function initDatabase() {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA foreign_keys = ON;');

    // Verificar si ya existen las tablas y datos iniciales
    const tableCheck = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='inventario_animales'").get();
    if (!tableCheck) {
        console.log('[SQLite] Creando tablas e insertando datos reales de FINCA AgroMacarena 35ha...');
        const seedSql = fs.readFileSync(SQL_SEED_PATH, 'utf8');
        db.exec(seedSql);
        console.log('[SQLite] Base de datos finca_macarena.db inicializada con éxito.');
    } else {
        const countVacas = db.prepare('SELECT COUNT(*) as total FROM inventario_animales').get();
        if (!countVacas || countVacas.total === 0) {
            const seedSql = fs.readFileSync(SQL_SEED_PATH, 'utf8');
            db.exec(seedSql);
        }
        console.log(`[SQLite] Base de datos conectada (${countVacas.total} registros en inventario_animales).`);
    }

    // Tabla para guardar los polígonos GeoJSON de potreros y linderos trazados sobre el mapa satelital
    db.exec(`
        CREATE TABLE IF NOT EXISTS geojson_potreros (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            tipo TEXT DEFAULT 'Potrero',
            coordenadas_json TEXT NOT NULL,
            area_ha REAL DEFAULT 0.68,
            color TEXT DEFAULT '#22c55e',
            fecha_actualizacion TEXT
        );
    `);

    // Migración automática: agregar columnas edad_anios y partos a inventario_animales si no existen
    const cols = db.prepare("PRAGMA table_info(inventario_animales)").all().map(c => c.name);
    if (!cols.includes('edad_anios')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN edad_anios INTEGER DEFAULT 4;");
        // Asignar edades iniciales realistas a las vacas existentes
        db.exec("UPDATE inventario_animales SET edad_anios = 7 WHERE id = 1;");
        db.exec("UPDATE inventario_animales SET edad_anios = 5 WHERE id IN (2, 3, 4, 5, 6);");
        db.exec("UPDATE inventario_animales SET edad_anios = 4 WHERE id > 6 AND id <= 20;");
    }
    if (!cols.includes('partos')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN partos INTEGER DEFAULT 2;");
        // Vaca #1 con 5 partos (ciclo productivo cumplido) y las demás entre 1 y 3 partos
        db.exec("UPDATE inventario_animales SET partos = 5 WHERE id = 1;");
        db.exec("UPDATE inventario_animales SET partos = 3 WHERE id IN (2, 3, 4, 5, 6);");
        db.exec("UPDATE inventario_animales SET partos = 2 WHERE id > 6 AND id < 20;");
        db.exec("UPDATE inventario_animales SET partos = 0 WHERE estado_reproductivo = 'Reproductor_Activo';");
    }
    if (!cols.includes('sexo')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN sexo TEXT DEFAULT 'Hembra';");
        db.exec("UPDATE inventario_animales SET sexo = 'Macho' WHERE estado_reproductivo = 'Reproductor_Activo';");
    }
    if (!cols.includes('categoria_bovino')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN categoria_bovino TEXT DEFAULT 'Vaca';");
        db.exec("UPDATE inventario_animales SET categoria_bovino = 'Toro' WHERE estado_reproductivo = 'Reproductor_Activo';");
    }
    if (!cols.includes('madre_codigo')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN madre_codigo TEXT DEFAULT '';");
    }
    if (!cols.includes('cria_codigo')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN cria_codigo TEXT DEFAULT '';");
        db.exec("UPDATE inventario_animales SET cria_codigo = 'Cría #' || id WHERE id >= 1 AND id <= 19 AND cria_codigo = '';");
    }
    if (!cols.includes('nfc_uid')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN nfc_uid TEXT DEFAULT NULL;");
    }
    if (!cols.includes('token_digital_hash')) {
        db.exec("ALTER TABLE inventario_animales ADD COLUMN token_digital_hash TEXT DEFAULT NULL;");
    }

    // Asignar NFC UID y Token Único Digital (NFT Hash SHA-256) a todos los animales que aún no lo tengan
    const todosAnimales = db.prepare('SELECT * FROM inventario_animales').all();
    const stmtUpdateNft = db.prepare('UPDATE inventario_animales SET nfc_uid = ?, token_digital_hash = ? WHERE id = ?');
    for (const a of todosAnimales) {
        const uid = a.nfc_uid || `NFC-COLLAR-${String(a.id).padStart(2, '0')}`;
        const hash = a.token_digital_hash || generarTokenDigitalAnimal({ ...a, nfc_uid: uid });
        if (a.nfc_uid !== uid || a.token_digital_hash !== hash) {
            stmtUpdateNft.run(uid, hash, a.id);
        }
    }

    // Sembrar historial de Track 24h en telemetria_collares con coordenadas reales de la Finca (2.154667, -73.712817) si solo hay 3 o menos lecturas
    const countTel = db.prepare('SELECT COUNT(*) as c FROM telemetria_collares').get();
    if (countTel && countTel.c <= 4) {
        const baseLat = 2.154667;
        const baseLng = -73.712817;
        // Actualizar las 3 filas semilla si tenían la coordenada antigua 2.1837
        db.prepare('UPDATE telemetria_collares SET latitud = ?, longitud = ? WHERE collar_id = ? AND ABS(latitud - 2.1837) < 0.01')
            .run(baseLat + 0.0003, baseLng + 0.0014, 'COLLAR-01');
        db.prepare('UPDATE telemetria_collares SET latitud = ?, longitud = ? WHERE collar_id = ? AND ABS(latitud - 2.1835) < 0.01')
            .run(baseLat + 0.0002, baseLng + 0.0016, 'COLLAR-02');
        db.prepare('UPDATE telemetria_collares SET latitud = ?, longitud = ? WHERE collar_id = ? AND ABS(latitud - 2.1839) < 0.01')
            .run(baseLat + 0.0004, baseLng + 0.0019, 'COLLAR-03');

        const insertTrack = db.prepare(`
            INSERT INTO telemetria_collares
            (collar_id, id_animal, fecha_hora, latitud, longitud, indice_actividad_pasos, minutos_rumia_24h, temperatura_cuello_c, bateria_pct, alerta_estado, rssi_dbm)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const ahora = Date.now();
        const puntosPorCollar = [
            { collar_id: 'COLLAR-01', id_animal: 1, estado: 'NORMAL', temp: 38.4, pasos: 138, rumia: 495, bat: 92, rssi: -71, dLat: 0.0003, dLng: 0.0014 },
            { collar_id: 'COLLAR-02', id_animal: 4, estado: 'CELO_DETECTADO', temp: 38.9, pasos: 315, rumia: 390, bat: 85, rssi: -76, dLat: 0.0002, dLng: 0.0016 },
            { collar_id: 'COLLAR-03', id_animal: 11, estado: 'NORMAL', temp: 38.5, pasos: 144, rumia: 480, bat: 88, rssi: -79, dLat: 0.0004, dLng: 0.0019 }
        ];
        const offsetsHoras = [
            { hAgo: 20, fLat: 0.0000, fLng: 0.0000 },
            { hAgo: 16, fLat: -0.0002, fLng: 0.0004 },
            { hAgo: 12, fLat: 0.0004, fLng: 0.0008 },
            { hAgo: 8,  fLat: 0.0007, fLng: 0.0011 },
            { hAgo: 4,  fLat: 0.0005, fLng: 0.0013 },
            { hAgo: 0,  fLat: null,   fLng: null }
        ];
        for (const col of puntosPorCollar) {
            for (const pt of offsetsHoras) {
                const ts = new Date(ahora - pt.hAgo * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
                const lat = Number((baseLat + (pt.fLat !== null ? pt.fLat : col.dLat)).toFixed(6));
                const lng = Number((baseLng + (pt.fLng !== null ? pt.fLng : col.dLng)).toFixed(6));
                insertTrack.run(col.collar_id, col.id_animal, ts, lat, lng, col.pasos, col.rumia, col.temp, col.bat, col.estado, col.rssi);
            }
        }
    }

    // Tabla de Historial de Bajas (Vendidos y Fallecidos)
    db.exec(`
        CREATE TABLE IF NOT EXISTS historial_bajas_animales (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            animal_id INTEGER,
            codigo_nombre TEXT NOT NULL,
            raza TEXT DEFAULT '',
            sexo TEXT DEFAULT 'Hembra',
            categoria_bovino TEXT DEFAULT 'Vaca',
            edad_anios INTEGER DEFAULT 0,
            partos INTEGER DEFAULT 0,
            motivo TEXT NOT NULL,
            valor_venta_cop REAL DEFAULT 0,
            fecha_baja TEXT NOT NULL,
            notas TEXT DEFAULT ''
        );
    `);

    // Tabla de Ficha Clínica / Eventos Sanitarios por Animal (Vacunas, Purgas, Tratamientos)
    db.exec(`
        CREATE TABLE IF NOT EXISTS eventos_sanitarios_animal (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            id_animal INTEGER NOT NULL,
            fecha TEXT NOT NULL,
            tipo_evento TEXT NOT NULL,
            producto_dosis TEXT NOT NULL,
            proxima_fecha TEXT DEFAULT NULL,
            notas TEXT DEFAULT ''
        );
    `);

    // Datos iniciales de ejemplo en eventos_sanitarios_animal si está vacía
    const countSanidad = db.prepare('SELECT COUNT(*) as c FROM eventos_sanitarios_animal').get();
    if (!countSanidad || countSanidad.c === 0) {
        db.exec(`
            INSERT INTO eventos_sanitarios_animal (id_animal, fecha, tipo_evento, producto_dosis, proxima_fecha, notas) VALUES
            (1, '2026-10-01', 'Vacuna Aftosa + Carbón', '2 ml subcutáneo (Ciclo oficial)', '2027-04-01', 'Sin reacción adversa'),
            (1, '2026-10-15', 'Purga + Vitaminas Complejo B', 'Ivermectina 1% + Belamyl 10 ml', '2027-01-15', 'Postparto'),
            (2, '2026-10-01', 'Vacuna Aftosa + Carbón', '2 ml subcutáneo (Ciclo oficial)', '2027-04-01', 'Lote completo');
        `);
    }

    // Tabla de Placemarks Reales en el Mapa Satelital (AlpineQuest)
    db.exec(`
        CREATE TABLE IF NOT EXISTS placemarks_mapa (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT NOT NULL,
            categoria TEXT DEFAULT 'Punto',
            latitud REAL NOT NULL,
            longitud REAL NOT NULL,
            altitud_m INTEGER DEFAULT 258,
            color TEXT DEFAULT '#ef4444',
            notas TEXT DEFAULT '',
            fecha_creacion TEXT NOT NULL
        );
    `);

    // Quitar la palabra "Suegro" de los registros existentes en SQLite
    db.exec(`
        UPDATE inventario_animales
        SET codigo_nombre = REPLACE(codigo_nombre, 'Toro Suegro', 'Toro'),
            notas = REPLACE(REPLACE(notas, ' del Suegro', ''), ' del suegro', '')
        WHERE codigo_nombre LIKE '%Suegro%' OR notas LIKE '%Suegro%' OR notas LIKE '%suegro%';
    `);

    // Tabla de configuración nativa para sincronización bidireccional con Google Sheets
    db.exec(`
        CREATE TABLE IF NOT EXISTS config_google_sheets (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            webhook_url TEXT NOT NULL,
            auto_sync_activo INTEGER DEFAULT 1,
            ultima_sincronizacion TEXT
        );
    `);
    const gsheetsSeed = db.prepare('SELECT id FROM config_google_sheets WHERE id = 1').get();
    if (!gsheetsSeed) {
        db.prepare('INSERT INTO config_google_sheets (id, webhook_url, auto_sync_activo, ultima_sincronizacion) VALUES (1, ?, 1, NULL)')
            .run(DEFAULT_GSHEETS_URL);
    }

    // Respaldo automático diario de finca_macarena.db en carpeta backups/
    crearRespaldoAutomaticoSQLite();
}

function crearRespaldoAutomaticoSQLite() {
    try {
        const backupDir = path.join(__dirname, 'backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        const hoy = new Date().toISOString().slice(0, 10);
        const destFile = path.join(backupDir, `finca_macarena_${hoy}.db`);
        if (fs.existsSync(DB_PATH)) {
            fs.copyFileSync(DB_PATH, destFile);
        }
        return destFile;
    } catch (err) {
        console.warn('[Backup SQLite]:', err.message);
        return null;
    }
}

initDatabase();

// =============================================================================
// 2. CLIENTES SSE (SERVER-SENT EVENTS) PARA TIEMPO REAL PC <-> CELULAR APK
// =============================================================================
const sseClients = new Set();

function broadcastEvent(type, payload) {
    const data = `data: ${JSON.stringify({ type, payload, timestamp: new Date().toISOString() })}\n\n`;
    for (const client of sseClients) {
        try {
            client.write(data);
        } catch (err) {
            sseClients.delete(client);
        }
    }
    if ((type === 'STATE_UPDATED' || type === 'LORA_TELEMETRY') && (!payload || payload.source !== 'gsheets')) {
        triggerBackgroundGSheetsPush();
    }
}

// =============================================================================
// 2B. SINCRONIZACIÓN BIDIRECCIONAL NATIVA CON GOOGLE SHEETS (APPS SCRIPT)
// =============================================================================
function getGSheetsConfig() {
    try {
        const row = db.prepare('SELECT * FROM config_google_sheets WHERE id = 1').get();
        if (row) return row;
    } catch {}
    return {
        id: 1,
        webhook_url: DEFAULT_GSHEETS_URL,
        auto_sync_activo: 1,
        ultima_sincronizacion: null
    };
}

let gsheetsPushTimer = null;
function triggerBackgroundGSheetsPush() {
    const cfg = getGSheetsConfig();
    if (!cfg || Number(cfg.auto_sync_activo) !== 1 || !cfg.webhook_url) return;
    if (gsheetsPushTimer) clearTimeout(gsheetsPushTimer);
    gsheetsPushTimer = setTimeout(() => {
        pushToGoogleSheets().catch(() => {});
    }, 1200);
}

async function pushToGoogleSheets(customUrl) {
    const cfg = getGSheetsConfig();
    const webhookUrl = (customUrl || cfg.webhook_url || DEFAULT_GSHEETS_URL).trim();
    if (!webhookUrl) return { ok: false, error: 'URL de Google Sheets vacía' };

    const res = await fetch(webhookUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'push', state: getFullState() })
    });

    const rawText = await res.text();
    let json = {};
    try {
        json = JSON.parse(rawText);
    } catch {
        json = { ok: res.ok, raw: rawText.slice(0, 200) };
    }

    let remoteProcessed = 0;
    if (json && Array.isArray(json.comandos_remotos) && json.comandos_remotos.length > 0) {
        remoteProcessed = applySyncQueue(json.comandos_remotos);
        if (remoteProcessed > 0) {
            broadcastEvent('STATE_UPDATED', { section: 'gsheets_remote_cmd', source: 'gsheets', processed: remoteProcessed });
        }
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE config_google_sheets SET ultima_sincronizacion = ? WHERE id = 1').run(nowIso);
    return {
        ok: true,
        ultima_sincronizacion: nowIso,
        remote_processed: remoteProcessed,
        gsheets_response: json
    };
}

async function pullFromGoogleSheets(customUrl) {
    const cfg = getGSheetsConfig();
    const webhookUrl = (customUrl || cfg.webhook_url || DEFAULT_GSHEETS_URL).trim();
    if (!webhookUrl) return { ok: false, error: 'URL de Google Sheets vacía' };

    const pullUrl = webhookUrl + (webhookUrl.includes('?') ? '&' : '?') + 'action=pull';
    const res = await fetch(pullUrl, { redirect: 'follow' });
    const rawText = await res.text();
    let json = {};
    try {
        json = JSON.parse(rawText);
    } catch {
        json = { ok: res.ok, raw: rawText.slice(0, 200) };
    }

    let remoteProcessed = 0;
    if (json && Array.isArray(json.comandos_remotos) && json.comandos_remotos.length > 0) {
        remoteProcessed = applySyncQueue(json.comandos_remotos);
        if (remoteProcessed > 0) {
            broadcastEvent('STATE_UPDATED', { section: 'gsheets_pull', source: 'gsheets', processed: remoteProcessed });
        }
    }

    const nowIso = new Date().toISOString();
    db.prepare('UPDATE config_google_sheets SET ultima_sincronizacion = ? WHERE id = 1').run(nowIso);
    return {
        ok: true,
        ultima_sincronizacion: nowIso,
        remote_processed: remoteProcessed,
        gsheets_response: json,
        state: getFullState()
    };
}

// =============================================================================
// 3. UTILIDADES RED LOCAL (LAN IP) Y CÁLCULOS DE REGLAS DE NEGOCIO
// =============================================================================
function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push({ interface: name, ip: iface.address });
            }
        }
    }
    return ips.length > 0 ? ips : [{ interface: 'Localhost', ip: '127.0.0.1' }];
}

function addDaysISO(dateStr, days) {
    if (!dateStr) return null;
    const d = new Date(dateStr + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

// Clasificador automático de alertas biométricas de collares LoRa
function evaluateCollarAlert(data) {
    if (data.alerta_estado && data.alerta_estado !== 'AUTO') {
        return data.alerta_estado;
    }
    // Reglas de geocerca (Quebradas o Carretera fuera de los polígonos seguros)
    if (data.fuera_cerca === true) return 'FUERA_DE_CERCA';
    // Fiebre de garrapata / ranilla / tristeza bovina (> 39.2°C o rumia < 350 min)
    if (Number(data.temperatura_cuello_c) > 39.2 || Number(data.minutos_rumia_24h) < 350) {
        return 'FIEBRE_BAJA_RUMIA';
    }
    // Celo detectado (Actividad > 250 pasos/h)
    if (Number(data.indice_actividad_pasos) > 250) {
        return 'CELO_DETECTADO';
    }
    return 'NORMAL';
}

// Hash SHA-256 corto de index.html y server.js para Auto-Actualización Instantánea (OTA)
function getAppVersionHash() {
    try {
        const hash = crypto.createHash('sha256');
        const indexPath = path.join(__dirname, 'index.html');
        const serverPath = __filename;
        if (fs.existsSync(indexPath)) hash.update(fs.readFileSync(indexPath));
        if (fs.existsSync(serverPath)) hash.update(fs.readFileSync(serverPath));
        return hash.digest('hex').slice(0, 12);
    } catch {
        return 'dev-local';
    }
}

// Obtener todo el estado consolidado para sincronización Offline-First (PC + APK)
function getFullState() {
    const produccion_diaria = db.prepare('SELECT * FROM produccion_diaria ORDER BY fecha DESC, id DESC').all();
    const contabilidad_sobres = db.prepare('SELECT * FROM contabilidad_sobres ORDER BY fecha DESC, id DESC').all();
    const fases_obras = db.prepare('SELECT * FROM fases_obras ORDER BY fase ASC, id ASC').all();
    const inventario_animales = db.prepare('SELECT * FROM inventario_animales ORDER BY id ASC').all();
    const economia_circular_potreros = db.prepare('SELECT * FROM economia_circular_potreros ORDER BY id ASC').all();
    const telemetria_collares = db.prepare(`
        SELECT t.*, a.codigo_nombre, a.raza, a.estado_reproductivo
        FROM telemetria_collares t
        LEFT JOIN inventario_animales a ON t.id_animal = a.id
        ORDER BY t.fecha_hora DESC, t.id DESC
        LIMIT 100
    `).all();
    const taller_diy_checklist = db.prepare('SELECT * FROM taller_diy_checklist ORDER BY id ASC').all();
    const geojson_potreros = db.prepare('SELECT * FROM geojson_potreros ORDER BY id ASC').all();
    const historial_bajas_animales = db.prepare('SELECT * FROM historial_bajas_animales ORDER BY id DESC').all();
    const eventos_sanitarios_animal = db.prepare('SELECT * FROM eventos_sanitarios_animal ORDER BY fecha DESC, id DESC').all();
    const placemarks_mapa = db.prepare('SELECT * FROM placemarks_mapa ORDER BY id ASC').all();

    // Calcular saldos de los 3 Sobres Quincenales (24% Operativo, 20% Familia, 56% Obras)
    const sobres = {
        OPERATIVO_24: { ingresos: 0, gastos: 0, saldo: 0, porcentaje: 24, base_quincenal: 820000 },
        FAMILIA_20: { ingresos: 0, gastos: 0, saldo: 0, porcentaje: 20, base_quincenal: 680000 },
        OBRAS_56: { ingresos: 0, gastos: 0, saldo: 0, porcentaje: 56, base_quincenal: 1920000 }
    };

    for (const mov of contabilidad_sobres) {
        const s = sobres[mov.sobre_destino];
        if (!s) continue;
        if (mov.tipo_movimiento === 'INGRESO') {
            s.ingresos += Number(mov.monto_cop);
        } else {
            s.gastos += Number(mov.monto_cop);
        }
    }
    for (const key of Object.keys(sobres)) {
        sobres[key].saldo = sobres[key].ingresos - sobres[key].gastos;
    }

    return {
        version_hash: getAppVersionHash(),
        server_time: new Date().toISOString(),
        lan_ips: getLocalIPs(),
        port: PORT,
        serial_status: getSerialStatus(),
        gsheets_config: getGSheetsConfig(),
        sobres_resumen: sobres,
        produccion_diaria,
        contabilidad_sobres,
        fases_obras,
        inventario_animales,
        economia_circular_potreros,
        telemetria_collares,
        taller_diy_checklist,
        geojson_potreros,
        historial_bajas_animales,
        eventos_sanitarios_animal,
        placemarks_mapa
    };
}

// =============================================================================
// 4. LECTOR NATIVO PUERTO SERIAL USB (COM) PARA EL RECEPTOR ESP32 LORA TECHO ZINC
//    Sin paquetes de npm externos (usa node:child_process + node:fs)
// =============================================================================
let serialState = {
    port: process.env.SERIAL_PORT || '',
    baudRate: Number(process.env.SERIAL_BAUD || 115200),
    connected: false,
    lastLine: '',
    lastPacketTime: null,
    packetsReceived: 0,
    error: null
};
let activeSerialProcess = null;
let activeSerialStream = null;

function listAvailableSerialPorts() {
    const ports = [];
    try {
        if (process.platform === 'win32') {
            const out = execSync('powershell -NoProfile -Command "[System.IO.Ports.SerialPort]::GetPortNames()"', { timeout: 2500, encoding: 'utf8' });
            out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).forEach(p => ports.push(p));
        } else {
            const devFiles = fs.readdirSync('/dev');
            devFiles.filter(f => /^tty(USB|ACM|S)\d+$/.test(f)).forEach(f => ports.push('/dev/' + f));
        }
    } catch {}
    if (ports.length === 0) {
        return ['COM3', 'COM4', 'COM5', '/dev/ttyUSB0'];
    }
    return ports;
}

function getSerialStatus() {
    return {
        ...serialState,
        availablePorts: listAvailableSerialPorts()
    };
}

function stopSerialReader() {
    if (activeSerialProcess) {
        try { activeSerialProcess.kill(); } catch {}
        activeSerialProcess = null;
    }
    if (activeSerialStream) {
        try { activeSerialStream.destroy(); } catch {}
        activeSerialStream = null;
    }
    serialState.connected = false;
}

function handleSerialLine(line) {
    const trimmed = String(line || '').trim();
    if (!trimmed) return;
    serialState.lastLine = trimmed.slice(0, 220);

    // Extraer objeto JSON de la línea si viene precedido por prefijos como "[LORA RX] {...}"
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const jsonCandidate = trimmed.slice(firstBrace, lastBrace + 1);
        try {
            const parsed = JSON.parse(jsonCandidate);
            if (parsed && (parsed.collar_id || parsed.id_animal || parsed.latitud !== undefined)) {
                serialState.packetsReceived += 1;
                serialState.lastPacketTime = new Date().toISOString();
                processLoRaPacket(parsed);
            }
        } catch {}
    }
}

function startSerialReader(portName, baudRate = 115200) {
    stopSerialReader();
    const cleanPort = String(portName || '').trim();
    if (!cleanPort) return getSerialStatus();

    serialState.port = cleanPort;
    serialState.baudRate = Number(baudRate) || 115200;
    serialState.error = null;

    if (process.platform === 'win32') {
        // Lector nativo PowerShell .NET SerialPort línea por línea sin dependencias npm
        const psScript = `
            $ErrorActionPreference = 'Stop'
            $port = New-Object System.IO.Ports.SerialPort '${cleanPort.replace(/'/g, '')}', ${serialState.baudRate}, 'None', 8, 'One'
            $port.ReadTimeout = 1000
            $port.DtrEnable = $true
            $port.RtsEnable = $true
            $port.Open()
            Write-Output "__SERIAL_OPENED__"
            try {
                while ($port.IsOpen) {
                    try {
                        $line = $port.ReadLine()
                        if ($line) { Write-Output $line }
                    } catch [System.TimeoutException] {
                        Start-Sleep -Milliseconds 50
                    }
                }
            } finally {
                if ($port.IsOpen) { $port.Close() }
            }
        `;
        try {
            activeSerialProcess = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', psScript], {
                stdio: ['ignore', 'pipe', 'pipe']
            });
            let buffer = '';
            activeSerialProcess.stdout.on('data', chunk => {
                buffer += chunk.toString('utf8');
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const l of lines) {
                    if (l.includes('__SERIAL_OPENED__')) {
                        serialState.connected = true;
                        serialState.error = null;
                        broadcastEvent('SERIAL_STATUS', getSerialStatus());
                    } else {
                        handleSerialLine(l);
                    }
                }
            });
            activeSerialProcess.stderr.on('data', chunk => {
                const msg = chunk.toString('utf8').trim();
                if (msg) {
                    serialState.error = `Puerto ${cleanPort} no disponible o desconectado`;
                    serialState.connected = false;
                }
            });
            activeSerialProcess.on('close', () => {
                serialState.connected = false;
                activeSerialProcess = null;
            });
        } catch (err) {
            serialState.connected = false;
            serialState.error = err.message;
        }
    } else {
        // Linux / macOS: configurar baudrate con stty y abrir stream con node:fs
        try {
            try {
                execSync(`stty -F ${cleanPort} ${serialState.baudRate} raw -echo`, { timeout: 2000 });
            } catch {}
            activeSerialStream = fs.createReadStream(cleanPort, { encoding: 'utf8' });
            serialState.connected = true;
            let buffer = '';
            activeSerialStream.on('data', chunk => {
                buffer += chunk;
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() || '';
                for (const l of lines) handleSerialLine(l);
            });
            activeSerialStream.on('error', err => {
                serialState.connected = false;
                serialState.error = err.message;
            });
            activeSerialStream.on('close', () => {
                serialState.connected = false;
                activeSerialStream = null;
            });
        } catch (err) {
            serialState.connected = false;
            serialState.error = err.message;
        }
    }

    return getSerialStatus();
}

if (process.env.SERIAL_PORT) {
    startSerialReader(process.env.SERIAL_PORT, process.env.SERIAL_BAUD || 115200);
}

function processLoRaPacket(rawJson) {
    const id_animal = Number(rawJson.id_animal || 1);
    const collar_id = rawJson.collar_id || `COLLAR-0${id_animal}`;
    const fecha_hora = rawJson.fecha_hora || new Date().toISOString().replace('T', ' ').slice(0, 19);
    const latitud = Number(rawJson.latitud !== undefined ? rawJson.latitud : 2.154967);
    const longitud = Number(rawJson.longitud !== undefined ? rawJson.longitud : -73.711417);
    const indice_actividad_pasos = Number(rawJson.indice_actividad_pasos || 145);
    const minutos_rumia_24h = Number(rawJson.minutos_rumia_24h || 480);
    const temperatura_cuello_c = Number(rawJson.temperatura_cuello_c || 38.4);
    const bateria_pct = Number(rawJson.bateria_pct || 90);
    const rssi_dbm = Number(rawJson.rssi_dbm || -74);
    const alerta_estado = evaluateCollarAlert(rawJson);

    const stmt = db.prepare(`
        INSERT INTO telemetria_collares
        (collar_id, id_animal, fecha_hora, latitud, longitud, indice_actividad_pasos, minutos_rumia_24h, temperatura_cuello_c, bateria_pct, alerta_estado, rssi_dbm)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const info = stmt.run(
        collar_id, id_animal, fecha_hora, latitud, longitud,
        indice_actividad_pasos, minutos_rumia_24h, temperatura_cuello_c,
        bateria_pct, alerta_estado, rssi_dbm
    );

    const animal = db.prepare('SELECT codigo_nombre, raza FROM inventario_animales WHERE id = ?').get(id_animal);
    const record = {
        id: Number(info.lastInsertRowid),
        collar_id,
        id_animal,
        codigo_nombre: animal ? animal.codigo_nombre : `Vaca #${id_animal}`,
        fecha_hora,
        latitud,
        longitud,
        indice_actividad_pasos,
        minutos_rumia_24h,
        temperatura_cuello_c,
        bateria_pct,
        alerta_estado,
        rssi_dbm
    };

    broadcastEvent('LORA_TELEMETRY', record);
    return record;
}

function applySyncQueue(queue) {
    let processed = 0;
    for (const item of (Array.isArray(queue) ? queue : [])) {
        const d = item.data || item.payload || {};
        if (item.action === 'produccion') {
            const total = Number(d.cantidad) * Number(d.precio_unitario || 2000);
            db.prepare(`
                INSERT INTO produccion_diaria (fecha, quincena_id, especie, producto, cantidad, precio_unitario, total_cop, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(d.fecha || new Date().toISOString().slice(0, 10), d.quincena_id || 1, d.especie || 'Bovinos', d.producto || 'Leche_Litros', d.cantidad, d.precio_unitario || 2000, total, d.notas || 'Sincronizado');
            processed++;
        } else if (item.action === 'sobre_movimiento') {
            db.prepare(`
                INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(d.quincena_num || 1, d.fecha || new Date().toISOString().slice(0, 10), d.tipo_movimiento || 'GASTO', d.sobre_destino || 'OPERATIVO_24', d.concepto || 'Gasto sincronizado', d.monto_cop || 0, d.obra_id || null);
            processed++;
        } else if (item.action === 'rotar_potrero') {
            if (d.potrero_id) {
                db.prepare("UPDATE economia_circular_potreros SET estado_lote = 'Recuperacion', dias_ocupacion = 0 WHERE estado_lote = 'Ocupado_Hato'").run();
                db.prepare("UPDATE economia_circular_potreros SET estado_lote = 'Ocupado_Hato', dias_ocupacion = 1, dias_descanso = 0 WHERE potrero_actual_id = ?").run(Number(d.potrero_id));
                processed++;
            }
        } else if (item.action === 'animal_agregar') {
            const codigo_nombre = (d.codigo_nombre || 'Vaca Sincronizada').trim();
            const raza = (d.raza || 'F1 Gyrolando').trim();
            const sexo = d.sexo || 'Hembra';
            const categoria_bovino = d.categoria_bovino || 'Vaca';
            const estado_reproductivo = d.estado_reproductivo || (categoria_bovino === 'Toro' ? 'Reproductor_Activo' : 'Parida');
            const es_elite_iatf = Number(d.es_elite_iatf ? 1 : 0);
            const fecha_servicio = d.fecha_servicio || null;
            const fecha_proximo_parto = fecha_servicio ? addDaysISO(fecha_servicio, 285) : null;
            const fecha_secado = fecha_servicio ? addDaysISO(fecha_servicio, 225) : null;
            const litros_promedio_dia = Number(d.litros_promedio_dia || 0);
            const edad_anios = Number(d.edad_anios || 0);
            const partos = Number(d.partos || 0);
            const notas = d.notas || `${sexo} - ${categoria_bovino} sincronizado`;
            const info = db.prepare(`
                INSERT INTO inventario_animales (
                    especie, codigo_nombre, raza, ubicacion_anillo,
                    estado_reproductivo, es_elite_iatf, fecha_servicio,
                    fecha_proximo_parto, fecha_secado, litros_promedio_dia,
                    edad_anios, partos, sexo, categoria_bovino, collar_id, notas
                ) VALUES ('Bovinos', ?, ?, 'Potreros Rotacionales', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(codigo_nombre, raza, estado_reproductivo, es_elite_iatf, fecha_servicio, fecha_proximo_parto, fecha_secado, litros_promedio_dia, edad_anios, partos, sexo, categoria_bovino, d.collar_id || null, notas);
            const newId = Number(info.lastInsertRowid);
            const nfc_uid = d.nfc_uid || `NFC-COLLAR-${String(newId).padStart(2, '0')}`;
            const token_digital_hash = generarTokenDigitalAnimal({ id: newId, codigo_nombre, raza, sexo, categoria_bovino, nfc_uid });
            db.prepare('UPDATE inventario_animales SET nfc_uid = ?, token_digital_hash = ? WHERE id = ?').run(nfc_uid, token_digital_hash, newId);
            processed++;
        } else if (item.action === 'animal_actualizar_repro') {
            const id = Number(d.id);
            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (animal) {
                const es_elite = d.es_elite_iatf !== undefined ? Number(d.es_elite_iatf) : animal.es_elite_iatf;
                const est_repro = d.estado_reproductivo || animal.estado_reproductivo;
                const f_serv = d.fecha_servicio !== undefined ? d.fecha_servicio : animal.fecha_servicio;
                const f_parto = f_serv ? addDaysISO(f_serv, 285) : (est_repro === 'Parida' ? null : animal.fecha_proximo_parto);
                const f_sec = f_serv ? addDaysISO(f_serv, 225) : (est_repro === 'Parida' ? null : animal.fecha_secado);
                db.prepare('UPDATE inventario_animales SET es_elite_iatf = ?, estado_reproductivo = ?, fecha_servicio = ?, fecha_proximo_parto = ?, fecha_secado = ? WHERE id = ?')
                    .run(es_elite, est_repro, f_serv, f_parto, f_sec, id);
                processed++;
            }
        } else if (item.action === 'animal_edad_partos') {
            const id = Number(d.id);
            db.prepare('UPDATE inventario_animales SET edad_anios = ?, partos = ? WHERE id = ?')
                .run(Number(d.edad_anios || 0), Number(d.partos || 0), id);
            processed++;
        } else if (item.action === 'animal_baja') {
            const id = Number(d.id);
            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (animal) {
                db.prepare(`
                    INSERT INTO historial_bajas_animales (
                        animal_id, codigo_nombre, raza, sexo, categoria_bovino,
                        edad_anios, partos, motivo, valor_venta_cop, fecha_baja, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    animal.id, animal.codigo_nombre, animal.raza || '', animal.sexo || 'Hembra',
                    animal.categoria_bovino || 'Vaca', Number(animal.edad_anios || 0), Number(animal.partos || 0),
                    d.motivo || 'Vendido', Number(d.valor_venta_cop || 0),
                    d.fecha_baja || new Date().toISOString().slice(0, 10), animal.notas || ''
                );
                db.prepare('DELETE FROM inventario_animales WHERE id = ?').run(id);
                processed++;
            }
        } else if (item.action === 'animal_vincular_nfc') {
            const id = Number(d.id_animal || d.id);
            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (animal) {
                const nfc_uid = (d.nfc_uid || animal.nfc_uid || `NFC-COLLAR-${String(id).padStart(2, '0')}`).trim();
                const madre_codigo = d.madre_codigo !== undefined ? d.madre_codigo : animal.madre_codigo;
                const cria_codigo = d.cria_codigo !== undefined ? d.cria_codigo : animal.cria_codigo;
                const notas = d.notas !== undefined ? d.notas : animal.notas;
                const token_digital_hash = generarTokenDigitalAnimal({ ...animal, madre_codigo, cria_codigo, nfc_uid });
                db.prepare('UPDATE inventario_animales SET nfc_uid = ?, token_digital_hash = ?, madre_codigo = ?, cria_codigo = ?, notas = ? WHERE id = ?')
                    .run(nfc_uid, token_digital_hash, madre_codigo, cria_codigo, notas, id);
                processed++;
            }
        } else if (item.action === 'evento_sanitario_agregar') {
            db.prepare(`
                INSERT INTO eventos_sanitarios_animal (id_animal, fecha, tipo_evento, producto_dosis, proxima_fecha, notas)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(Number(d.id_animal), d.fecha || new Date().toISOString().slice(0, 10), d.tipo_evento || 'Vacuna', d.producto_dosis || '', d.proxima_fecha || null, d.notas || '');
            processed++;
        } else if (item.action === 'evento_sanitario_eliminar') {
            db.prepare('DELETE FROM eventos_sanitarios_animal WHERE id = ?').run(Number(d.id));
            processed++;
        } else if (item.action === 'placemark_agregar') {
            db.prepare(`
                INSERT INTO placemarks_mapa (nombre, categoria, latitud, longitud, altitud_m, color, notas, fecha_creacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(d.nombre || 'Punto', d.categoria || 'Referencia', Number(d.latitud), Number(d.longitud), Number(d.altitud_m || 258), d.color || '#22c55e', d.notas || '', new Date().toISOString().slice(0, 19).replace('T', ' '));
            processed++;
        } else if (item.action === 'geojson_potrero_guardar') {
            const rawCoords = d.coordenadas_json !== undefined ? d.coordenadas_json : d.coordenadas;
            const coordsStr = typeof rawCoords === 'string' ? rawCoords : JSON.stringify(rawCoords || []);
            db.prepare(`
                INSERT INTO geojson_potreros (nombre, tipo, coordenadas_json, area_ha, color, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(d.nombre || 'Potrero', d.tipo || 'Potrero', coordsStr, Number(d.area_ha || 0.7), d.color || '#22c55e', new Date().toISOString().slice(0, 19).replace('T', ' '));
            processed++;
        } else if (item.action === 'bandeja_bsf_agregar') {
            const fecha = d.fecha || new Date().toISOString().slice(0, 10);
            const kg_estiercol = Number(d.kg_estiercol_ingresado || 50);
            const kg_larva = +(kg_estiercol * 0.24).toFixed(1);
            const ahorro_cop = Math.round(kg_larva * 4000);
            const fecha_cosecha_estimada = addDaysISO(fecha, 12);
            db.prepare(`
                INSERT INTO economia_circular_potreros
                (fecha, modulo, kg_estiercol_ingresado, kg_larva_cosechada, ahorro_concentrado_cop, dias_ocupacion, estado_lote, fecha_cosecha_estimada, notas)
                VALUES (?, 'Mosca_Soldado', ?, ?, ?, 0, 'Inoculado', ?, ?)
            `).run(fecha, kg_estiercol, kg_larva, ahorro_cop, fecha_cosecha_estimada, d.notas || `Bandeja BSF (${kg_estiercol}kg)`);
            processed++;
        } else if (item.action === 'obra_actualizar') {
            const id = Number(d.id);
            const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(id);
            if (obra) {
                if (d.estado) {
                    db.prepare('UPDATE fases_obras SET estado = ? WHERE id = ?').run(d.estado, id);
                }
                if (d.abono_sobre_obras && Number(d.abono_sobre_obras) > 0) {
                    const monto = Number(d.abono_sobre_obras);
                    const nuevoAcum = Number(obra.gasto_acumulado) + monto;
                    const autoEst = nuevoAcum >= Number(obra.presupuesto_estimado) ? 'Terminado' : 'En Obra';
                    db.prepare('UPDATE fases_obras SET gasto_acumulado = ?, estado = ? WHERE id = ?').run(nuevoAcum, autoEst, id);
                    db.prepare(`
                        INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id)
                        VALUES (1, ?, 'GASTO', 'OBRAS_56', ?, ?, ?)
                    `).run(new Date().toISOString().slice(0, 10), `Inversión Obra: ${obra.nombre_obra}`, monto, id);
                }
                processed++;
            }
        }
    }
    return processed;
}

// =============================================================================
// 5. SERVIDOR HTTP REST + ARCHIVOS ESTÁTICOS + PWA / CAPACITOR
// =============================================================================
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 5 * 1024 * 1024) reject(new Error('Payload demasiado grande'));
        });
        req.on('end', () => {
            if (!body) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (e) {
                reject(new Error('JSON inválido'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json; charset=utf-8'
};

const server = http.createServer(async (req, res) => {
    // CORS Preflight para la APK de Android y clientes en la LAN WiFi de la finca
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = urlObj.pathname;

    try {
        // ---------------------------------------------------------------------
        // VERSIÓN OTA (Auto-Actualización Instantánea)
        // ---------------------------------------------------------------------
        if (pathname === '/api/version' && req.method === 'GET') {
            return sendJson(res, 200, {
                version_hash: getAppVersionHash(),
                server_time: new Date().toISOString()
            });
        }

        // ---------------------------------------------------------------------
        // STREAM SSE TIEMPO REAL (Notificaciones de collares LoRa y cambios LAN)
        // ---------------------------------------------------------------------
        if (pathname === '/api/events' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*'
            });
            res.write(`data: ${JSON.stringify({ type: 'CONNECTED', server_time: new Date().toISOString(), version_hash: getAppVersionHash() })}\n\n`);
            sseClients.add(res);
            req.on('close', () => sseClients.delete(res));
            return;
        }

        // ---------------------------------------------------------------------
        // ESTADO COMPLETO (Sincronización inicial PC y APK)
        // ---------------------------------------------------------------------
        if (pathname === '/api/state' && req.method === 'GET') {
            return sendJson(res, 200, getFullState());
        }

        // ---------------------------------------------------------------------
        // PESTAÑA 1: PRODUCCIÓN DIARIA (Ordeño y Huevos)
        // ---------------------------------------------------------------------
        if (pathname === '/api/produccion' && req.method === 'POST') {
            const body = await parseBody(req);
            const fecha = body.fecha || new Date().toISOString().slice(0, 10);
            const quincena_id = Number(body.quincena_id || 1);
            const especie = body.especie || 'Bovinos';
            const producto = body.producto || 'Leche_Litros';
            const cantidad = Number(body.cantidad || 0);
            const precio_unitario = Number(body.precio_unitario || (producto === 'Leche_Litros' ? 2000 : 600));
            const total_cop = cantidad * precio_unitario;
            const notas = body.notas || '';

            const stmt = db.prepare(`
                INSERT INTO produccion_diaria (fecha, quincena_id, especie, producto, cantidad, precio_unitario, total_cop, notas)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const info = stmt.run(fecha, quincena_id, especie, producto, cantidad, precio_unitario, total_cop, notas);

            // Si el usuario activa liquidar automáticamente en los 3 sobres o al cerrar quincena:
            if (body.repartir_en_sobres) {
                const monto24 = Math.round(total_cop * 0.24);
                const monto20 = Math.round(total_cop * 0.20);
                const monto56 = total_cop - monto24 - monto20;
                const insertSobre = db.prepare(`
                    INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop)
                    VALUES (?, ?, 'INGRESO', ?, ?, ?)
                `);
                insertSobre.run(quincena_id, fecha, 'OPERATIVO_24', `Ingreso 24% ${especie} (${cantidad} ${producto})`, monto24);
                insertSobre.run(quincena_id, fecha, 'FAMILIA_20', `Ingreso 20% ${especie} (${cantidad} ${producto})`, monto20);
                insertSobre.run(quincena_id, fecha, 'OBRAS_56', `Ingreso 56% ${especie} (${cantidad} ${producto})`, monto56);
            }

            broadcastEvent('STATE_UPDATED', { section: 'produccion' });
            return sendJson(res, 201, { ok: true, id: Number(info.lastInsertRowid), state: getFullState() });
        }

        // Editar un registro de produccion_diaria (por si el usuario se equivoca digitando un número)
        if (pathname === '/api/produccion/editar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const row = db.prepare('SELECT * FROM produccion_diaria WHERE id = ?').get(id);
            if (!row) return sendJson(res, 404, { error: 'Registro no encontrado' });

            const fecha = body.fecha || row.fecha;
            const cantidad = body.cantidad !== undefined ? Number(body.cantidad) : Number(row.cantidad);
            const precio_unitario = body.precio_unitario !== undefined ? Number(body.precio_unitario) : Number(row.precio_unitario);
            const total_cop = body.total_cop !== undefined ? Number(body.total_cop) : Math.round(cantidad * precio_unitario);
            const notas = body.notas !== undefined ? body.notas : row.notas;

            db.prepare(`
                UPDATE produccion_diaria
                SET fecha = ?, cantidad = ?, precio_unitario = ?, total_cop = ?, notas = ?
                WHERE id = ?
            `).run(fecha, cantidad, precio_unitario, total_cop, notas, id);

            broadcastEvent('STATE_UPDATED', { section: 'produccion' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Eliminar un registro de produccion_diaria
        if (pathname === '/api/produccion/eliminar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            db.prepare('DELETE FROM produccion_diaria WHERE id = ?').run(id);
            broadcastEvent('STATE_UPDATED', { section: 'produccion' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // LIQUIDAR CHEQUE QUINCENAL DE LECHE EN LOS 3 SOBRES (24% / 20% / 56%)
        // ---------------------------------------------------------------------
        if (pathname === '/api/sobres/liquidar-quincena' && req.method === 'POST') {
            const body = await parseBody(req);
            const quincena_num = Number(body.quincena_num || 1);
            const fecha = body.fecha || new Date().toISOString().slice(0, 10);
            const total_cop = Number(body.monto_total_cop || 3420000);
            const litros = Number(body.litros_totales || Math.round(total_cop / 2000));

            const monto24 = Math.round(total_cop * 0.24);
            const monto20 = Math.round(total_cop * 0.20);
            const monto56 = total_cop - monto24 - monto20;

            const stmt = db.prepare(`
                INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop)
                VALUES (?, ?, 'INGRESO', ?, ?, ?)
            `);
            stmt.run(quincena_num, fecha, 'OPERATIVO_24', `Liquidación Quincena #${quincena_num} (${litros}L) - 24% Operativo y Ganado`, monto24);
            stmt.run(quincena_num, fecha, 'FAMILIA_20', `Liquidación Quincena #${quincena_num} (${litros}L) - 20% Sueldo Libre Familiar`, monto20);
            stmt.run(quincena_num, fecha, 'OBRAS_56', `Liquidación Quincena #${quincena_num} (${litros}L) - 56% Fondo Construcción por Fases`, monto56);

            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Editar un movimiento contable de contabilidad_sobres
        if (pathname === '/api/sobres/editar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const mov = db.prepare('SELECT * FROM contabilidad_sobres WHERE id = ?').get(id);
            if (!mov) return sendJson(res, 404, { error: 'Movimiento no encontrado' });

            const fecha = body.fecha || mov.fecha;
            const sobre_destino = body.sobre_destino || mov.sobre_destino;
            const concepto = body.concepto !== undefined ? body.concepto : mov.concepto;
            const monto_cop = body.monto_cop !== undefined ? Number(body.monto_cop) : Number(mov.monto_cop);

            // Si tenía obra_id y cambió el monto, ajustar el gasto_acumulado de la obra
            if (mov.tipo_movimiento === 'GASTO' && mov.obra_id && monto_cop !== Number(mov.monto_cop)) {
                const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(mov.obra_id);
                if (obra) {
                    const diff = monto_cop - Number(mov.monto_cop);
                    const nuevoGasto = Math.max(0, Number(obra.gasto_acumulado) + diff);
                    db.prepare('UPDATE fases_obras SET gasto_acumulado = ? WHERE id = ?').run(nuevoGasto, mov.obra_id);
                }
            }

            db.prepare(`
                UPDATE contabilidad_sobres
                SET fecha = ?, sobre_destino = ?, concepto = ?, monto_cop = ?
                WHERE id = ?
            `).run(fecha, sobre_destino, concepto, monto_cop, id);

            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Eliminar un movimiento contable de contabilidad_sobres
        if (pathname === '/api/sobres/eliminar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const mov = db.prepare('SELECT * FROM contabilidad_sobres WHERE id = ?').get(id);
            if (mov) {
                if (mov.tipo_movimiento === 'GASTO' && mov.obra_id) {
                    const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(mov.obra_id);
                    if (obra) {
                        const nuevoGasto = Math.max(0, Number(obra.gasto_acumulado) - Number(mov.monto_cop));
                        db.prepare('UPDATE fases_obras SET gasto_acumulado = ? WHERE id = ?').run(nuevoGasto, mov.obra_id);
                    }
                }
                db.prepare('DELETE FROM contabilidad_sobres WHERE id = ?').run(id);
            }
            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // REGISTRAR MOVIMIENTO (GASTO O INGRESO) EN UNO DE LOS 3 SOBRES
        // ---------------------------------------------------------------------
        if (pathname === '/api/sobres/movimiento' && req.method === 'POST') {
            const body = await parseBody(req);
            const quincena_num = Number(body.quincena_num || 1);
            const fecha = body.fecha || new Date().toISOString().slice(0, 10);
            const tipo_movimiento = body.tipo_movimiento || 'GASTO';
            const sobre_destino = body.sobre_destino || 'OPERATIVO_24';
            const concepto = body.concepto || 'Movimiento registrado';
            const monto_cop = Number(body.monto_cop || 0);
            const obra_id = body.obra_id ? Number(body.obra_id) : null;

            const stmt = db.prepare(`
                INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id);

            // Si es un gasto del Sobre 3 (OBRAS_56) asociado a una obra del cronograma, sumar al gasto acumulado:
            if (tipo_movimiento === 'GASTO' && obra_id) {
                const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(obra_id);
                if (obra) {
                    const nuevoGasto = Number(obra.gasto_acumulado) + monto_cop;
                    const nuevoEstado = nuevoGasto >= Number(obra.presupuesto_estimado) ? 'Terminado' : 'En Obra';
                    db.prepare('UPDATE fases_obras SET gasto_acumulado = ?, estado = ? WHERE id = ?')
                        .run(nuevoGasto, nuevoEstado, obra_id);
                }
            }

            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Editar un movimiento contable de contabilidad_sobres
        if (pathname === '/api/sobres/editar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const mov = db.prepare('SELECT * FROM contabilidad_sobres WHERE id = ?').get(id);
            if (!mov) return sendJson(res, 404, { error: 'Movimiento no encontrado' });

            const fecha = body.fecha || mov.fecha;
            const sobre_destino = body.sobre_destino || mov.sobre_destino;
            const concepto = body.concepto !== undefined ? body.concepto : mov.concepto;
            const monto_cop = body.monto_cop !== undefined ? Number(body.monto_cop) : Number(mov.monto_cop);

            // Si tenía obra_id y cambió el monto, ajustar el gasto_acumulado de la obra
            if (mov.tipo_movimiento === 'GASTO' && mov.obra_id && monto_cop !== Number(mov.monto_cop)) {
                const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(mov.obra_id);
                if (obra) {
                    const diff = monto_cop - Number(mov.monto_cop);
                    const nuevoGasto = Math.max(0, Number(obra.gasto_acumulado) + diff);
                    db.prepare('UPDATE fases_obras SET gasto_acumulado = ? WHERE id = ?').run(nuevoGasto, mov.obra_id);
                }
            }

            db.prepare(`
                UPDATE contabilidad_sobres
                SET fecha = ?, sobre_destino = ?, concepto = ?, monto_cop = ?
                WHERE id = ?
            `).run(fecha, sobre_destino, concepto, monto_cop, id);

            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Eliminar un movimiento contable de contabilidad_sobres
        if (pathname === '/api/sobres/eliminar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const mov = db.prepare('SELECT * FROM contabilidad_sobres WHERE id = ?').get(id);
            if (mov) {
                if (mov.tipo_movimiento === 'GASTO' && mov.obra_id) {
                    const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(mov.obra_id);
                    if (obra) {
                        const nuevoGasto = Math.max(0, Number(obra.gasto_acumulado) - Number(mov.monto_cop));
                        db.prepare('UPDATE fases_obras SET gasto_acumulado = ? WHERE id = ?').run(nuevoGasto, mov.obra_id);
                    }
                }
                db.prepare('DELETE FROM contabilidad_sobres WHERE id = ?').run(id);
            }
            broadcastEvent('STATE_UPDATED', { section: 'sobres' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // PESTAÑA 2: ACTUALIZAR FASE DE OBRA / AVANCE DE CONSTRUCCIÓN
        // ---------------------------------------------------------------------
        if (pathname === '/api/obras/actualizar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const obra = db.prepare('SELECT * FROM fases_obras WHERE id = ?').get(id);
            if (!obra) return sendJson(res, 404, { error: 'Obra no encontrada' });

            const estado = body.estado || obra.estado;
            const gasto_acumulado = body.gasto_acumulado !== undefined ? Number(body.gasto_acumulado) : Number(obra.gasto_acumulado);

            db.prepare('UPDATE fases_obras SET estado = ?, gasto_acumulado = ? WHERE id = ?')
                .run(estado, gasto_acumulado, id);

            // Si se solicita descontar abono directamente del Sobre 3 (56% Obras)
            if (body.abono_sobre_obras && Number(body.abono_sobre_obras) > 0) {
                const montoAbono = Number(body.abono_sobre_obras);
                const nuevoAcumulado = Number(obra.gasto_acumulado) + montoAbono;
                const autoEstado = nuevoAcumulado >= Number(obra.presupuesto_estimado) ? 'Terminado' : 'En Obra';
                db.prepare('UPDATE fases_obras SET gasto_acumulado = ?, estado = ? WHERE id = ?')
                    .run(nuevoAcumulado, autoEstado, id);

                db.prepare(`
                    INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id)
                    VALUES (1, ?, 'GASTO', 'OBRAS_56', ?, ?, ?)
                `).run(new Date().toISOString().slice(0, 10), `Inversión Obra: ${obra.nombre_obra}`, montoAbono, id);
            }

            broadcastEvent('STATE_UPDATED', { section: 'obras' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // PESTAÑA 3: ACTUALIZAR VACA / PROTOCOLO IATF F1 GYROLANDO O MONTA TORO
        // ---------------------------------------------------------------------
        if (pathname === '/api/animales/actualizar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (!animal) return sendJson(res, 404, { error: 'Animal no encontrado' });

            const es_elite_iatf = body.es_elite_iatf !== undefined ? Number(body.es_elite_iatf) : animal.es_elite_iatf;
            const estado_reproductivo = body.estado_reproductivo || animal.estado_reproductivo;
            const fecha_servicio = body.fecha_servicio !== undefined ? body.fecha_servicio : animal.fecha_servicio;
            const litros_promedio_dia = body.litros_promedio_dia !== undefined ? Number(body.litros_promedio_dia) : animal.litros_promedio_dia;
            const edad_anios = body.edad_anios !== undefined ? Number(body.edad_anios) : (animal.edad_anios ?? 4);
            const partos = body.partos !== undefined ? Number(body.partos) : (animal.partos ?? 2);
            const collar_id = body.collar_id !== undefined ? body.collar_id : animal.collar_id;
            const notas = body.notas !== undefined ? body.notas : animal.notas;

            // Cálculo automático de parto (+285 días gestación bovina) y fecha de secado (-60 días antes del parto = +225 días)
            let fecha_proximo_parto = animal.fecha_proximo_parto;
            let fecha_secado = animal.fecha_secado;
            if (fecha_servicio) {
                fecha_proximo_parto = addDaysISO(fecha_servicio, 285);
                fecha_secado = addDaysISO(fecha_servicio, 225);
            } else if (estado_reproductivo === 'Parida') {
                fecha_proximo_parto = null;
                fecha_secado = null;
            }

            db.prepare(`
                UPDATE inventario_animales
                SET es_elite_iatf = ?, estado_reproductivo = ?, fecha_servicio = ?,
                    fecha_proximo_parto = ?, fecha_secado = ?, litros_promedio_dia = ?,
                    edad_anios = ?, partos = ?, collar_id = ?, notas = ?
                WHERE id = ?
            `).run(es_elite_iatf, estado_reproductivo, fecha_servicio, fecha_proximo_parto, fecha_secado, litros_promedio_dia, edad_anios, partos, collar_id, notas, id);

            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Agregar una nueva vaca o ternero al inventario_animales
        if (pathname === '/api/animales/agregar' && req.method === 'POST') {
            const body = await parseBody(req);
            const codigo_nombre = (body.codigo_nombre || 'Vaca Nueva').trim();
            const raza = (body.raza || 'F1 Gyrolando').trim();
            const litros_promedio_dia = (body.litros_promedio_dia !== undefined && body.litros_promedio_dia !== '' && body.litros_promedio_dia !== null)
                ? Number(body.litros_promedio_dia)
                : 0;
            const edad_anios = (body.edad_anios !== undefined && body.edad_anios !== '' && body.edad_anios !== null)
                ? Number(body.edad_anios)
                : 0;
            const partos = (body.partos !== undefined && body.partos !== '' && body.partos !== null)
                ? Number(body.partos)
                : 0;
            const sexo = body.sexo || 'Hembra';
            const categoria_bovino = body.categoria_bovino || 'Vaca';
            const es_elite_iatf = Number(body.es_elite_iatf ? 1 : 0);
            const estado_reproductivo = body.estado_reproductivo || (categoria_bovino === 'Toro' ? 'Reproductor_Activo' : 'Parida');
            const fecha_servicio = body.fecha_servicio || null;
            const collar_id = body.collar_id ? String(body.collar_id).trim() : null;
            const notas = body.notas || `${sexo} - ${categoria_bovino} registrado en el hato`;

            let fecha_proximo_parto = null;
            let fecha_secado = null;
            if (fecha_servicio) {
                fecha_proximo_parto = addDaysISO(fecha_servicio, 285);
                fecha_secado = addDaysISO(fecha_servicio, 225);
            }

            const info = db.prepare(`
                INSERT INTO inventario_animales (
                    especie, codigo_nombre, raza, ubicacion_anillo,
                    estado_reproductivo, es_elite_iatf, fecha_servicio,
                    fecha_proximo_parto, fecha_secado, litros_promedio_dia,
                    edad_anios, partos, sexo, categoria_bovino, collar_id, notas
                ) VALUES ('Bovinos', ?, ?, 'Potreros Rotacionales', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                codigo_nombre,
                raza,
                estado_reproductivo,
                es_elite_iatf,
                fecha_servicio,
                fecha_proximo_parto,
                fecha_secado,
                litros_promedio_dia,
                edad_anios,
                partos,
                sexo,
                categoria_bovino,
                collar_id,
                notas
            );

            const newId = Number(info.lastInsertRowid);
            const nfc_uid = body.nfc_uid || `NFC-COLLAR-${String(newId).padStart(2, '0')}`;
            const token_digital_hash = generarTokenDigitalAnimal({
                id: newId,
                codigo_nombre,
                raza,
                sexo,
                categoria_bovino,
                madre_codigo: body.madre_codigo || '',
                cria_codigo: body.cria_codigo || '',
                nfc_uid
            });
            db.prepare('UPDATE inventario_animales SET nfc_uid = ?, token_digital_hash = ? WHERE id = ?')
                .run(nfc_uid, token_digital_hash, newId);

            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 201, { ok: true, id: newId, nfc_uid, token_digital_hash, state: getFullState() });
        }

        // Quitar una vaca del inventario_animales y archivarla en historial_bajas_animales (Motivo: Vendido o Falleció)
        if (pathname === '/api/animales/quitar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const motivo = body.motivo || 'Vendido';
            const valor_venta_cop = Number(body.valor_venta_cop || 0);
            const fecha_baja = body.fecha_baja || new Date().toISOString().slice(0, 10);

            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (animal) {
                db.prepare(`
                    INSERT INTO historial_bajas_animales (
                        animal_id, codigo_nombre, raza, sexo, categoria_bovino,
                        edad_anios, partos, motivo, valor_venta_cop, fecha_baja, notas
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `).run(
                    animal.id,
                    animal.codigo_nombre,
                    animal.raza || '',
                    animal.sexo || 'Hembra',
                    animal.categoria_bovino || 'Vaca',
                    Number(animal.edad_anios || 0),
                    Number(animal.partos || 0),
                    motivo,
                    valor_venta_cop,
                    fecha_baja,
                    animal.notas || ''
                );
                db.prepare('DELETE FROM inventario_animales WHERE id = ?').run(id);
            }

            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Restaurar un animal desde historial_bajas_animales al inventario activo
        if (pathname === '/api/animales/restaurar-baja' && req.method === 'POST') {
            const body = await parseBody(req);
            const bajaId = Number(body.id);
            const baja = db.prepare('SELECT * FROM historial_bajas_animales WHERE id = ?').get(bajaId);
            if (baja) {
                db.prepare(`
                    INSERT INTO inventario_animales (
                        especie, codigo_nombre, raza, ubicacion_anillo,
                        estado_reproductivo, es_elite_iatf, litros_promedio_dia,
                        edad_anios, partos, sexo, categoria_bovino, notas
                    ) VALUES ('Bovinos', ?, ?, 'Potreros Rotacionales', ?, 0, ?, ?, ?, ?, ?, ?)
                `).run(
                    baja.codigo_nombre,
                    baja.raza || 'F1 Gyrolando',
                    baja.categoria_bovino === 'Toro' ? 'Reproductor_Activo' : 'Parida',
                    baja.categoria_bovino === 'Vaca' ? 6.0 : 0,
                    Number(baja.edad_anios || 0),
                    Number(baja.partos || 0),
                    baja.sexo || 'Hembra',
                    baja.categoria_bovino || 'Vaca',
                    baja.notas || 'Restaurado al hato'
                );
                db.prepare('DELETE FROM historial_bajas_animales WHERE id = ?').run(bajaId);
            }
            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Actualizar genealogía (Madre y Cría) de un animal en su Ficha Clínica y regenerar su NFT Hash
        if (pathname === '/api/animales/genealogia' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id);
            const madre_codigo = (body.madre_codigo || '').trim();
            const cria_codigo = (body.cria_codigo || '').trim();
            const notas = body.notas !== undefined ? String(body.notas) : undefined;

            if (notas !== undefined) {
                db.prepare('UPDATE inventario_animales SET madre_codigo = ?, cria_codigo = ?, notas = ? WHERE id = ?')
                    .run(madre_codigo, cria_codigo, notas, id);
            } else {
                db.prepare('UPDATE inventario_animales SET madre_codigo = ?, cria_codigo = ? WHERE id = ?')
                    .run(madre_codigo, cria_codigo, id);
            }
            const updatedAnimal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (updatedAnimal) {
                const newHash = generarTokenDigitalAnimal(updatedAnimal);
                db.prepare('UPDATE inventario_animales SET token_digital_hash = ? WHERE id = ?').run(newHash, id);
            }
            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Vincular o actualizar el Chip NFC (nfc_uid) y Token Único Digital (NFT Hash) de un animal
        if (pathname === '/api/animales/nfc/vincular' && req.method === 'POST') {
            const body = await parseBody(req);
            const id = Number(body.id_animal || body.id);
            const animal = db.prepare('SELECT * FROM inventario_animales WHERE id = ?').get(id);
            if (!animal) return sendJson(res, 404, { error: 'Animal no encontrado' });

            const nfc_uid = (body.nfc_uid || animal.nfc_uid || `NFC-COLLAR-${String(id).padStart(2, '0')}`).trim();
            const token_digital_hash = generarTokenDigitalAnimal({
                ...animal,
                nfc_uid
            });
            db.prepare('UPDATE inventario_animales SET nfc_uid = ?, token_digital_hash = ? WHERE id = ?')
                .run(nfc_uid, token_digital_hash, id);

            broadcastEvent('STATE_UPDATED', { section: 'animales' });
            return sendJson(res, 200, { ok: true, id, nfc_uid, token_digital_hash, state: getFullState() });
        }

        // Agregar evento sanitario (vacuna, purga, vitamina, tratamiento) a un animal
        if (pathname === '/api/animales/sanidad/agregar' && req.method === 'POST') {
            const body = await parseBody(req);
            const id_animal = Number(body.id_animal);
            const fecha = body.fecha || new Date().toISOString().slice(0, 10);
            const tipo_evento = (body.tipo_evento || 'Vacuna').trim();
            const producto_dosis = (body.producto_dosis || '').trim();
            const proxima_fecha = body.proxima_fecha || null;
            const notas = (body.notas || '').trim();

            db.prepare(`
                INSERT INTO eventos_sanitarios_animal (id_animal, fecha, tipo_evento, producto_dosis, proxima_fecha, notas)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(id_animal, fecha, tipo_evento, producto_dosis, proxima_fecha, notas);

            broadcastEvent('STATE_UPDATED', { section: 'sanidad' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Eliminar evento sanitario
        if (pathname === '/api/animales/sanidad/eliminar' && req.method === 'POST') {
            const body = await parseBody(req);
            db.prepare('DELETE FROM eventos_sanitarios_animal WHERE id = ?').run(Number(body.id));
            broadcastEvent('STATE_UPDATED', { section: 'sanidad' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Guardar un Placemark en el mapa satelital (AlpineQuest)
        if (pathname === '/api/mapa/placemarks/guardar' && req.method === 'POST') {
            const body = await parseBody(req);
            const nombre = (body.nombre || 'Punto Marcado').trim();
            const categoria = body.categoria || 'Referencia';
            const latitud = Number(body.latitud);
            const longitud = Number(body.longitud);
            const altitud_m = Number(body.altitud_m || 258);
            const color = body.color || '#ef4444';
            const notas = body.notas || '';
            const fecha_creacion = new Date().toISOString().slice(0, 19).replace('T', ' ');

            db.prepare(`
                INSERT INTO placemarks_mapa (nombre, categoria, latitud, longitud, altitud_m, color, notas, fecha_creacion)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(nombre, categoria, latitud, longitud, altitud_m, color, notas, fecha_creacion);

            broadcastEvent('STATE_UPDATED', { section: 'placemarks' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Eliminar un Placemark del mapa
        if (pathname === '/api/mapa/placemarks/eliminar' && req.method === 'POST') {
            const body = await parseBody(req);
            if (body.id === 'ALL') {
                db.prepare('DELETE FROM placemarks_mapa').run();
            } else {
                db.prepare('DELETE FROM placemarks_mapa WHERE id = ?').run(Number(body.id));
            }
            broadcastEvent('STATE_UPDATED', { section: 'placemarks' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Generar respaldo inmediato en carpeta backups/
        if (pathname === '/api/backup/ahora' && req.method === 'POST') {
            const ruta = crearRespaldoAutomaticoSQLite();
            return sendJson(res, 200, { ok: true, backup_path: ruta });
        }

        // ---------------------------------------------------------------------
        // PESTAÑA 4: ECONOMÍA CIRCULAR - MOSCA SOLDADO NEGRA (BSF) Y BIODIGESTOR
        // ---------------------------------------------------------------------
        if (pathname === '/api/circular/bandeja-bsf' && req.method === 'POST') {
            const body = await parseBody(req);
            const fecha = body.fecha || new Date().toISOString().slice(0, 10);
            const kg_estiercol = Number(body.kg_estiercol_ingresado || 50);
            // Conversión bioconversión BSF: ~24% rendimiento en larva fresca (42% proteína)
            const kg_larva = body.kg_larva_cosechada !== undefined ? Number(body.kg_larva_cosechada) : +(kg_estiercol * 0.24).toFixed(1);
            // 1 kg de larva BSF reemplaza concentrado comercial de 42% proteína (~$4.000 COP/kg en La Macarena)
            const ahorro_cop = Math.round(kg_larva * 4000);
            const fecha_cosecha_estimada = addDaysISO(fecha, 12);
            const notas = body.notas || `Bandeja BSF sembrada (${kg_estiercol}kg estiércol -> ${kg_larva}kg larva estimada a los 12 días)`;

            db.prepare(`
                INSERT INTO economia_circular_potreros
                (fecha, modulo, kg_estiercol_ingresado, kg_larva_cosechada, ahorro_concentrado_cop, dias_ocupacion, estado_lote, fecha_cosecha_estimada, notas)
                VALUES (?, 'Mosca_Soldado', ?, ?, ?, 0, 'Inoculado', ?, ?)
            `).run(fecha, kg_estiercol, kg_larva, ahorro_cop, fecha_cosecha_estimada, notas);

            broadcastEvent('STATE_UPDATED', { section: 'circular' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Rotar el hato de 19 vacas a un nuevo potrero (1 al 35)
        if (pathname === '/api/circular/rotar-potrero' && req.method === 'POST') {
            const body = await parseBody(req);
            const nuevoPotreroId = Number(body.potrero_id);
            if (!nuevoPotreroId || nuevoPotreroId < 1 || nuevoPotreroId > 35) {
                return sendJson(res, 400, { error: 'ID de potrero inválido (debe ser entre 1 y 35)' });
            }

            const hoy = new Date().toISOString().slice(0, 10);

            // 1. Todos los potreros que no son el nuevo aumentan su descanso; el que estaba ocupado pasa a Recuperacion (0 días descanso)
            const potreros = db.prepare("SELECT * FROM economia_circular_potreros WHERE potrero_actual_id IS NOT NULL").all();
            const updatePot = db.prepare(`
                UPDATE economia_circular_potreros
                SET fecha = ?, dias_ocupacion = ?, dias_descanso = ?, estado_lote = ?, notas = ?
                WHERE id = ?
            `);

            for (const p of potreros) {
                if (p.potrero_actual_id === nuevoPotreroId) {
                    updatePot.run(hoy, 1, 0, 'Ocupado_Hato', `HATO ACTUAL AQUÍ (19 Vacas + Toro Suegro) - Ingresó ${hoy}`, p.id);
                } else if (p.estado_lote === 'Ocupado_Hato') {
                    updatePot.run(hoy, 0, 1, 'Recuperacion', `Salió el hato el ${hoy} (En recuperación)`, p.id);
                } else {
                    const nuevoDescanso = Number(p.dias_descanso || 0) + 1;
                    const nuevoEstado = nuevoDescanso >= 30 ? 'Listo_Optimo' : (nuevoDescanso <= 14 ? 'Recuperacion' : 'Descanso');
                    updatePot.run(hoy, 0, nuevoDescanso, nuevoEstado, p.notas, p.id);
                }
            }

            broadcastEvent('STATE_UPDATED', { section: 'potreros' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // PESTAÑA 5: TELEMETRÍA IOT COLLARES LORA (RECEPTOR ESP32 + SIMULADOR + TRACK 24H + SERIAL COM)
        // ---------------------------------------------------------------------
        if (pathname === '/api/telemetria/lora' && req.method === 'POST') {
            const body = await parseBody(req);
            const record = processLoRaPacket(body);
            return sendJson(res, 201, { ok: true, record, state: getFullState() });
        }

        // Consultar Track 24h real de un collar desde SQLite ordenado por fecha_hora ASC
        if (pathname === '/api/telemetria/track24h' && req.method === 'GET') {
            const collar_id = (urlObj.searchParams.get('collar_id') || 'COLLAR-01').trim();
            let points = db.prepare(`
                SELECT t.*, a.codigo_nombre
                FROM telemetria_collares t
                LEFT JOIN inventario_animales a ON t.id_animal = a.id
                WHERE t.collar_id = ?
                  AND datetime(t.fecha_hora) >= datetime('now', '-24 hours')
                ORDER BY t.fecha_hora ASC, t.id ASC
            `).all(collar_id);

            // Si los datos en base de datos tienen fecha anterior a las últimas 24h del reloj del sistema, devolver las últimas 12 lecturas reales ordenadas cronológicamente
            if (!points || points.length < 2) {
                points = db.prepare(`
                    SELECT * FROM (
                        SELECT t.*, a.codigo_nombre
                        FROM telemetria_collares t
                        LEFT JOIN inventario_animales a ON t.id_animal = a.id
                        WHERE t.collar_id = ?
                        ORDER BY t.fecha_hora DESC, t.id DESC
                        LIMIT 12
                    ) ORDER BY fecha_hora ASC, id ASC
                `).all(collar_id);
            }

            return sendJson(res, 200, { ok: true, collar_id, count: points.length, points });
        }

        // Reposicionar collares demo y su track 24h alrededor de un nuevo centro de finca en SQLite
        if (pathname === '/api/telemetria/reposicionar-demo' && req.method === 'POST') {
            const body = await parseBody(req);
            const baseLat = Number(body.lat || 2.154667);
            const baseLng = Number(body.lng || -73.712817);
            const ahora = Date.now();
            const insertTrack = db.prepare(`
                INSERT INTO telemetria_collares
                (collar_id, id_animal, fecha_hora, latitud, longitud, indice_actividad_pasos, minutos_rumia_24h, temperatura_cuello_c, bateria_pct, alerta_estado, rssi_dbm)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            const puntosPorCollar = [
                { collar_id: 'COLLAR-01', id_animal: 1, estado: 'NORMAL', temp: 38.4, pasos: 140, rumia: 492, bat: 92, rssi: -71, dLat: 0.0003, dLng: 0.0014 },
                { collar_id: 'COLLAR-02', id_animal: 4, estado: 'CELO_DETECTADO', temp: 38.9, pasos: 320, rumia: 388, bat: 85, rssi: -75, dLat: 0.0002, dLng: 0.0016 },
                { collar_id: 'COLLAR-03', id_animal: 11, estado: 'NORMAL', temp: 38.5, pasos: 146, rumia: 482, bat: 89, rssi: -78, dLat: 0.0004, dLng: 0.0019 }
            ];
            const offsetsHoras = [
                { hAgo: 15, fLat: 0.0000, fLng: 0.0000 },
                { hAgo: 12, fLat: -0.0002, fLng: 0.0004 },
                { hAgo: 9,  fLat: 0.0004, fLng: 0.0008 },
                { hAgo: 6,  fLat: 0.0007, fLng: 0.0011 },
                { hAgo: 3,  fLat: 0.0005, fLng: 0.0013 },
                { hAgo: 0,  fLat: null,   fLng: null }
            ];
            for (const col of puntosPorCollar) {
                for (const pt of offsetsHoras) {
                    const ts = new Date(ahora - pt.hAgo * 3600 * 1000).toISOString().replace('T', ' ').slice(0, 19);
                    const lat = Number((baseLat + (pt.fLat !== null ? pt.fLat : col.dLat)).toFixed(6));
                    const lng = Number((baseLng + (pt.fLng !== null ? pt.fLng : col.dLng)).toFixed(6));
                    insertTrack.run(col.collar_id, col.id_animal, ts, lat, lng, col.pasos, col.rumia, col.temp, col.bat, col.estado, col.rssi);
                }
            }
            broadcastEvent('STATE_UPDATED', { section: 'telemetria' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Consultar o conectar el Puerto Serial USB (COM) del Receptor ESP32 LoRa
        if (pathname === '/api/serial/status' && req.method === 'GET') {
            return sendJson(res, 200, getSerialStatus());
        }

        if (pathname === '/api/serial/conectar' && req.method === 'POST') {
            const body = await parseBody(req);
            if (body.disconnect) {
                stopSerialReader();
                return sendJson(res, 200, { ok: true, serial_status: getSerialStatus() });
            }
            const status = startSerialReader(body.port || 'COM3', body.baudRate || 115200);
            return sendJson(res, 200, { ok: true, serial_status: status });
        }

        // Actualizar checklist del Taller DIY de los 19 Collares
        if (pathname === '/api/taller/actualizar' && req.method === 'POST') {
            const body = await parseBody(req);
            if (body.id) {
                db.prepare('UPDATE taller_diy_checklist SET completado = ?, collares_armados = ? WHERE id = ?')
                    .run(body.completado ? 1 : 0, Number(body.collares_armados || 3), Number(body.id));
            }
            if (body.collares_armados_global !== undefined) {
                db.prepare('UPDATE taller_diy_checklist SET collares_armados = ?')
                    .run(Number(body.collares_armados_global));
            }
            broadcastEvent('STATE_UPDATED', { section: 'taller' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // Guardar polígono GeoJSON personalizado de Potrero / Lindero en SQLite
        if ((pathname === '/api/geojson/guardar' || pathname === '/api/mapa/potreros/guardar') && req.method === 'POST') {
            const body = await parseBody(req);
            const nombre = body.nombre || 'Potrero Trazado';
            const tipo = body.tipo || 'Potrero';
            const rawCoords = body.coordenadas_json !== undefined ? body.coordenadas_json : body.coordenadas;
            const coordenadas_json = typeof rawCoords === 'string'
                ? rawCoords
                : JSON.stringify(rawCoords || []);
            const area_ha = Number(body.area_ha || 0.7);
            const color = body.color || '#22c55e';
            const fecha_actualizacion = new Date().toISOString().slice(0, 19).replace('T', ' ');

            db.prepare(`
                INSERT INTO geojson_potreros (nombre, tipo, coordenadas_json, area_ha, color, fecha_actualizacion)
                VALUES (?, ?, ?, ?, ?, ?)
            `).run(nombre, tipo, coordenadas_json, area_ha, color, fecha_actualizacion);

            broadcastEvent('STATE_UPDATED', { section: 'geojson' });
            return sendJson(res, 201, { ok: true, state: getFullState() });
        }

        // Eliminar polígono GeoJSON personalizado (o limpiar todos si id === 'ALL')
        if ((pathname === '/api/geojson/eliminar' || pathname === '/api/mapa/potreros/eliminar') && req.method === 'POST') {
            const body = await parseBody(req);
            if (body.id === 'ALL') {
                db.prepare('DELETE FROM geojson_potreros').run();
            } else if (body.id) {
                db.prepare('DELETE FROM geojson_potreros WHERE id = ?').run(Number(body.id));
            }
            broadcastEvent('STATE_UPDATED', { section: 'geojson' });
            return sendJson(res, 200, { ok: true, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // SINCRONIZACIÓN AUTOMÁTICA COLA OFFLINE COMPLETA (CELULAR APK -> PC SQLITE)
        // ---------------------------------------------------------------------
        if (pathname === '/api/sync' && req.method === 'POST') {
            const body = await parseBody(req);
            const queue = Array.isArray(body.queue) ? body.queue : [];
            const processed = applySyncQueue(queue);

            if (processed > 0) {
                broadcastEvent('STATE_UPDATED', { section: 'sync', processed });
            }
            return sendJson(res, 200, { ok: true, processed, state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // SINCRONIZACIÓN BIDIRECCIONAL NATIVA CON GOOGLE SHEETS (APPS SCRIPT)
        // ---------------------------------------------------------------------
        if (pathname === '/api/gsheets/push' && req.method === 'POST') {
            const body = await parseBody(req);
            try {
                const result = await pushToGoogleSheets(body.webhook_url);
                return sendJson(res, 200, { ...result, state: getFullState() });
            } catch (err) {
                return sendJson(res, 502, { ok: false, error: err.message });
            }
        }

        if (pathname === '/api/gsheets/pull' && req.method === 'POST') {
            const body = await parseBody(req);
            try {
                const result = await pullFromGoogleSheets(body.webhook_url);
                return sendJson(res, 200, result);
            } catch (err) {
                return sendJson(res, 502, { ok: false, error: err.message });
            }
        }

        if (pathname === '/api/gsheets/config' && req.method === 'POST') {
            const body = await parseBody(req);
            const current = getGSheetsConfig();
            const webhook_url = body.webhook_url !== undefined ? String(body.webhook_url).trim() : current.webhook_url;
            const auto_sync_activo = body.auto_sync_activo !== undefined ? (body.auto_sync_activo ? 1 : 0) : current.auto_sync_activo;
            db.prepare('UPDATE config_google_sheets SET webhook_url = ?, auto_sync_activo = ? WHERE id = 1')
                .run(webhook_url || DEFAULT_GSHEETS_URL, auto_sync_activo);
            return sendJson(res, 200, { ok: true, gsheets_config: getGSheetsConfig(), state: getFullState() });
        }

        // ---------------------------------------------------------------------
        // ÍCONOS OFICIALES PWA Y DESCARGA DE APP PORTÁTIL OFFLINE (.HTML)
        // ---------------------------------------------------------------------
        if (pathname === '/icon-192.svg' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'image/svg+xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
            });
            return res.end(getOfficialFincaIconSvg(192));
        }

        if (pathname === '/icon-512.svg' && req.method === 'GET') {
            res.writeHead(200, {
                'Content-Type': 'image/svg+xml; charset=utf-8',
                'Cache-Control': 'public, max-age=86400',
                'Access-Control-Allow-Origin': '*'
            });
            return res.end(getOfficialFincaIconSvg(512));
        }

        if (pathname === '/politica-privacidad' && req.method === 'GET') {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            return res.end(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Políticas Legales, Privacidad y Permisos - FINCA</title><style>body{font-family:system-ui,-apple-system,sans-serif;background:#F7F3E8;color:#1A1A1A;margin:0;padding:24px;line-height:1.6;font-size:14px}main{max-width:740px;margin:0 auto;background:#FFFDF8;border:1px solid #1A1A1A;border-radius:8px;padding:24px}h1{font-size:18px;margin-top:0;border-bottom:1px solid #1A1A1A;padding-bottom:8px}h2{font-size:14px;margin:18px 0 6px;text-transform:uppercase}p,li{margin:0 0 8px}ul{padding-left:20px;margin:0 0 12px}</style></head><body><main><h1>Políticas Legales, Privacidad, Cookies y Permisos — FINCA</h1><p><b>Titular y Autor del Software:</b> TG Legacy S.A.S. | <b>Última actualización:</b> 2026-11-13</p><h2>1. Copyright y Propiedad Intelectual</h2><p>&copy; 2026 FINCA. Todos los derechos reservados. Titular y Autor del Software: TG Legacy S.A.S. Prohibida su reproducción, distribución, ingeniería inversa o modificación sin autorización expresa por escrito.</p><h2>2. Política de Tratamiento de Datos (Ley 1581 de 2012 - Colombia)</h2><p>En cumplimiento de la Ley 1581 de 2012 y el Decreto 1377 de 2013 de la República de Colombia, los datos de producción lechera, contabilidad, inventario bovino, trazabilidad genética, sanidad y telemetría se almacenan localmente en el dispositivo y en el servidor SQLite privado de la finca, sincronizándose únicamente con la nube privada autorizada por el propietario. No se venden ni ceden datos a terceros.</p><h2>3. Política de Cookies y Almacenamiento Local</h2><p>Esta aplicación web y PWA no utiliza cookies publicitarias ni rastreadores de terceros. Emplea exclusivamente almacenamiento técnico esencial en el navegador (localStorage, Cache Storage y Service Worker) para funcionar sin conexión (Offline-First), conservar la cola de sincronización y guardar la aceptación de estos términos.</p><h2>4. Términos de Uso y Licencia de Software (EULA)</h2><p>TG Legacy S.A.S. concede una licencia de uso limitada, no exclusiva e intransferible para la operación interna de la finca. El acceso a módulos administrativos requiere las credenciales del propietario.</p><h2>5. Limitación de Responsabilidad</h2><p>Los cálculos productivos, financieros, alertas LoRa, geocercas GPS y registros sanitarios son herramientas de apoyo operativo y no reemplazan el criterio médico veterinario, contable ni la supervisión física en campo.</p><h2>6. Derechos del Titular y Jurisdicción</h2><p>El titular de la información puede ejercer sus derechos de consulta, actualización, rectificación y supresión ante TG Legacy S.A.S. Este acuerdo se rige por las leyes de la República de Colombia.</p><h2>7. Permisos de Hardware del Dispositivo</h2><ul><li><b>Ubicación GPS:</b> Posicionamiento en visor cartográfico, potreros y geocercas LoRa.</li><li><b>Cámara y Lector NFC:</b> Escaneo de códigos QR de sincronización y lectura/escritura de chapetas o collares NFC.</li><li><b>Almacenamiento Local Persistente:</b> Conservación de base de datos offline y mapas satelitales en caché.</li><li><b>Notificaciones y Audio:</b> Alertas sonoras y visuales ante eventos de telemetría LoRa.</li><li><b>Red Local Wi-Fi e Internet:</b> Sincronización con servidor SQLite local y respaldo autorizado.</li></ul></main></body></html>`);
        }

        if (pathname === '/api/descargar-app-portatil' && req.method === 'GET') {
            const indexHtmlPath = path.join(__dirname, 'index.html');
            let html = fs.readFileSync(indexHtmlPath, 'utf8');
            const cfg = getGSheetsConfig();
            const gsUrl = (cfg && cfg.webhook_url) ? cfg.webhook_url : DEFAULT_GSHEETS_URL;
            const iconDataUri = 'data:image/svg+xml;utf8,' + encodeURIComponent(getOfficialFincaIconSvg(192));
            const injectBoot = `<link rel="icon" type="image/svg+xml" href="${iconDataUri}" />\n<script>window.FINCA_PORTABLE_MODE=true;try{localStorage.setItem('agromacarena_gsheets_url_v1',${JSON.stringify(gsUrl)});}catch{}</script>`;
            html = html.replace('<head>', '<head>\n    ' + injectBoot);
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Content-Disposition': 'attachment; filename="FINCA_App_Movil.html"'
            });
            return res.end(html);
        }

        // GENERADOR DE PAQUETE WEB ESTÁTICO PARA HOSTING GRATUITO (GITHUB PAGES / NETLIFY / VERCEL)
        if (pathname === '/api/exportar-web-nube' && req.method === 'GET') {
            const out = generarPaqueteDistNube();
            return sendJson(res, 200, out);
        }

        // EXPORTACIÓN / RESPALDO EN JSON Y CSV (UN CLIC)
        // ---------------------------------------------------------------------
        if (pathname === '/api/export/json' && req.method === 'GET') {
            const fullState = getFullState();
            res.writeHead(200, {
                'Content-Type': 'application/json; charset=utf-8',
                'Content-Disposition': `attachment; filename="respaldo_finca_macarena_${new Date().toISOString().slice(0, 10)}.json"`
            });
            return res.end(JSON.stringify(fullState, null, 2));
        }

        if (pathname === '/api/export/csv' && req.method === 'GET') {
            const state = getFullState();
            const lines = [];
            lines.push('=== REPORTE QUINCENAL FINCA AGROMACARENA 35HA (LA MACARENA, META) ===');
            lines.push(`Fecha Generacion,${new Date().toISOString()}`);
            lines.push('');
            lines.push('--- 1. SALDOS DE LOS 3 SOBRES QUINCENALES ---');
            lines.push('Sobre,Porcentaje,Ingresos COP,Gastos COP,Saldo Disponible COP');
            lines.push(`Sobre 1 Operativo y Ganado,24%,${state.sobres_resumen.OPERATIVO_24.ingresos},${state.sobres_resumen.OPERATIVO_24.gastos},${state.sobres_resumen.OPERATIVO_24.saldo}`);
            lines.push(`Sobre 2 Sueldo Libre Familiar,20%,${state.sobres_resumen.FAMILIA_20.ingresos},${state.sobres_resumen.FAMILIA_20.gastos},${state.sobres_resumen.FAMILIA_20.saldo}`);
            lines.push(`Sobre 3 Fondo Construccion Obras,56%,${state.sobres_resumen.OBRAS_56.ingresos},${state.sobres_resumen.OBRAS_56.gastos},${state.sobres_resumen.OBRAS_56.saldo}`);
            lines.push('');
            lines.push('--- 2. PRODUCCION DIARIA DE LECHE Y HUEVOS ---');
            lines.push('ID,Fecha,Quincena,Especie,Producto,Cantidad,Precio Unitario,Total COP,Notas');
            for (const p of state.produccion_diaria) {
                lines.push(`${p.id},${p.fecha},${p.quincena_id},${p.especie},${p.producto},${p.cantidad},${p.precio_unitario},${p.total_cop},"${(p.notas || '').replace(/"/g, '""')}"`);
            }
            lines.push('');
            lines.push('--- 3. MOVIMIENTOS CONTABLES DE SOBRES ---');
            lines.push('ID,Quincena,Fecha,Tipo,Sobre,Concepto,Monto COP');
            for (const m of state.contabilidad_sobres) {
                lines.push(`${m.id},${m.quincena_num},${m.fecha},${m.tipo_movimiento},${m.sobre_destino},"${(m.concepto || '').replace(/"/g, '""')}",${m.monto_cop}`);
            }
            lines.push('');
            lines.push('--- 4. CRONOGRAMA DE OBRAS POR FASES ---');
            lines.push('ID,Fase,Quincena Meta,Obra,Presupuesto COP,Gasto Acumulado COP,Estado');
            for (const o of state.fases_obras) {
                lines.push(`${o.id},Fase ${o.fase},${o.quincena_meta},"${o.nombre_obra.replace(/"/g, '""')}",${o.presupuesto_estimado},${o.gasto_acumulado},${o.estado}`);
            }

            res.writeHead(200, {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': `attachment; filename="reporte_quincenal_agromacarena_${new Date().toISOString().slice(0, 10)}.csv"`
            });
            return res.end('\uFEFF' + lines.join('\r\n'));
        }

        // ---------------------------------------------------------------------
        // SERVIR ARCHIVOS ESTÁTICOS (index.html, manifest.json, sw.js, etc.)
        // ---------------------------------------------------------------------
        let filePath = pathname === '/' ? path.join(__dirname, 'index.html') : path.join(__dirname, pathname);
        // Evitar Path Traversal
        if (!filePath.startsWith(__dirname)) {
            res.writeHead(403);
            return res.end('Acceso denegado');
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Access-Control-Allow-Origin': '*'
            });
            fs.createReadStream(filePath).pipe(res);
            return;
        }

        // Fallback SPA a index.html
        const indexHtml = path.join(__dirname, 'index.html');
        if (fs.existsSync(indexHtml)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            fs.createReadStream(indexHtml).pipe(res);
            return;
        }

        sendJson(res, 404, { error: 'Ruta no encontrada' });
    } catch (err) {
        console.error('[Error Servidor]:', err);
        sendJson(res, 500, { error: err.message });
    }
});

function getOfficialFincaIconSvg(size = 512) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <rect x="0" y="0" width="512" height="512" rx="110" fill="#F7F3E8"/>
  <rect x="24" y="24" width="464" height="464" rx="92" fill="none" stroke="#1A1A1A" stroke-width="16"/>
  <path d="M176 114 Q256 64 336 114" fill="none" stroke="#1A1A1A" stroke-width="16" stroke-linecap="round"/>
  <path d="M208 142 Q256 110 304 142" fill="none" stroke="#1A1A1A" stroke-width="16" stroke-linecap="round"/>
  <path d="M164 188 C134 166 130 132 152 126 C158 150 176 168 198 176 L314 176 C336 168 354 150 360 126 C382 132 378 166 348 188 L378 214 L346 232 L334 294 C328 320 296 336 256 336 C216 336 184 320 178 294 L166 232 L134 214 Z" fill="#1A1A1A"/>
  <circle cx="218" cy="236" r="10" fill="#F7F3E8"/>
  <circle cx="294" cy="236" r="10" fill="#F7F3E8"/>
  <ellipse cx="256" cy="292" rx="44" ry="24" fill="#F7F3E8"/>
  <circle cx="238" cy="292" r="7" fill="#1A1A1A"/>
  <circle cx="274" cy="292" r="7" fill="#1A1A1A"/>
  <path d="M92 368 Q182 340 256 364 T420 356" fill="none" stroke="#1A1A1A" stroke-width="14" stroke-linecap="round"/>
  <text x="256" y="448" text-anchor="middle" font-family="system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif" font-weight="900" font-size="72" letter-spacing="8" fill="#1A1A1A">FINCA</text>
</svg>`;
}

function generarPaqueteDistNube() {
    const distDir = path.join(__dirname, 'dist_nube');
    if (!fs.existsSync(distDir)) fs.mkdirSync(distDir, { recursive: true });

    const cfg = getGSheetsConfig();
    const gsUrl = (cfg && cfg.webhook_url) ? cfg.webhook_url : DEFAULT_GSHEETS_URL;

    let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    const bootScript = `<script>window.FINCA_CLOUD_STATIC_MODE=true;try{localStorage.setItem('agromacarena_gsheets_url_v1',${JSON.stringify(gsUrl)});}catch{}</script>`;
    html = html
        .replace('<head>', '<head>\n    ' + bootScript)
        .replace(/href="\/manifest\.json"/g, 'href="./manifest.json"')
        .replace(/href="\/icon-192\.svg"/g, 'href="./icon-192.svg"')
        .replace(/href="\/icon-512\.svg"/g, 'href="./icon-512.svg"')
        .replace(/register\('\/sw\.js'\)/g, "register('./sw.js')");

    const manifestObj = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
    manifestObj.id = './';
    manifestObj.start_url = './index.html';
    manifestObj.scope = './';
    manifestObj.icons = [
        { src: './icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
        { src: './icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }
    ];

    fs.writeFileSync(path.join(distDir, 'index.html'), html, 'utf8');
    fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifestObj, null, 2), 'utf8');
    fs.copyFileSync(path.join(__dirname, 'sw.js'), path.join(distDir, 'sw.js'));
    fs.writeFileSync(path.join(distDir, 'icon-192.svg'), getOfficialFincaIconSvg(192), 'utf8');
    fs.writeFileSync(path.join(distDir, 'icon-512.svg'), getOfficialFincaIconSvg(512), 'utf8');

    return {
        ok: true,
        dir: distDir,
        files: ['index.html', 'manifest.json', 'sw.js', 'icon-192.svg', 'icon-512.svg']
    };
}

server.listen(PORT, '0.0.0.0', () => {
    try {
        const distInfo = generarPaqueteDistNube();
        console.log(`[Dist Nube] Paquete estático generado en: ${distInfo.dir}`);
    } catch (e) {
        console.warn('[Dist Nube] Error generando paquete estático:', e.message);
    }
    const ips = getLocalIPs();
    console.log('======================================================================');
    console.log(' FINCA - AgroMacarena 35ha (La Macarena, Meta, Colombia)');
    console.log(' Servidor Local Offline-First + SQLite + Receptor Telemetría LoRa');
    console.log('======================================================================');
    console.log(` -> En este Computador (PC Casa): http://localhost:${PORT}`);
    for (const item of ips) {
        console.log(` -> En Celular / APK por WiFi Local (${item.interface}): http://${item.ip}:${PORT}`);
    }
    console.log(` -> Base de datos SQLite activa: ${DB_PATH}`);
    console.log('======================================================================');

    // Primer push automático hacia Google Sheets al arrancar (silencioso si no hay internet)
    setTimeout(() => {
        const cfg = getGSheetsConfig();
        if (cfg && Number(cfg.auto_sync_activo) === 1 && cfg.webhook_url) {
            pushToGoogleSheets(cfg.webhook_url)
                .then((r) => {
                    if (r && r.ok) console.log('[Google Sheets] Sincronización inicial completada:', r.ultima_sincronizacion);
                })
                .catch((e) => {
                    console.warn('[Google Sheets] Sin conexión al arrancar (modo local SQLite):', e.message);
                });
        }
    }, 1500);
});
