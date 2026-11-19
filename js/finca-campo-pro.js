/* ==========================================================================
 * FINCA AgroMacarena 35ha - Módulo de Campo Pro (GPX/KML, Cobertura Offline,
 * Geocercas LoRa, Grabadora de Ruta GPS y Respaldo JSON)
 * ========================================================================== */
(function () {
    'use strict';

    // --- 1. UTILIDADES DE DESCARGA Y ESCAPE XML ---
    function escXml(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function descargarArchivoTexto(nombre, contenido, mime) {
        const blob = new Blob([contenido], { type: mime || 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = nombre;
        document.body.appendChild(a);
        a.click();
        setTimeout(() => {
            try { URL.revokeObjectURL(url); } catch {}
            a.remove();
        }, 500);
    }

    function getPlacemarksActuales() {
        if (typeof ultimosPlacemarksMapa !== 'undefined' && Array.isArray(ultimosPlacemarksMapa)) {
            return ultimosPlacemarksMapa;
        }
        if (typeof appState !== 'undefined' && Array.isArray(appState.placemarks_mapa)) {
            return appState.placemarks_mapa;
        }
        return (window.fincaState && Array.isArray(window.fincaState.placemarks_mapa)) ? window.fincaState.placemarks_mapa : [];
    }

    function getPotrerosActuales() {
        if (typeof appState !== 'undefined' && Array.isArray(appState.geojson_potreros)) {
            return appState.geojson_potreros;
        }
        return (window.fincaState && Array.isArray(window.fincaState.geojson_potreros)) ? window.fincaState.geojson_potreros : [];
    }

    // --- 2. EXPORTAR / IMPORTAR GPX Y KML ---
    window.exportarPlacemarksGpx = function () {
        const pms = getPlacemarksActuales();
        const potreros = getPotrerosActuales();
        const fecha = new Date().toISOString().slice(0, 10);

        let wpts = '';
        pms.forEach((pm) => {
            const lat = Number(pm.lat);
            const lng = Number(pm.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
            wpts += `  <wpt lat="${lat.toFixed(6)}" lon="${lng.toFixed(6)}">\n` +
                    `    <name>${escXml(pm.nombre || 'Waypoint')}</name>\n` +
                    `    <desc>${escXml(pm.comentario || pm.descripcion || pm.tipo || '')}</desc>\n` +
                    `    <sym>${escXml(pm.icono || pm.tipo || 'Flag')}</sym>\n` +
                    `  </wpt>\n`;
        });

        let trks = '';
        potreros.forEach((p) => {
            let coords = [];
            try {
                const gj = typeof p.geojson === 'string' ? JSON.parse(p.geojson) : p.geojson;
                if (gj && gj.geometry && Array.isArray(gj.geometry.coordinates)) {
                    const ring = gj.geometry.type === 'Polygon' ? gj.geometry.coordinates[0] : gj.geometry.coordinates;
                    if (Array.isArray(ring)) coords = ring;
                }
            } catch {}
            if (!coords.length) return;
            const pts = coords
                .filter(c => Array.isArray(c) && c.length >= 2)
                .map(c => `      <trkpt lat="${Number(c[1]).toFixed(6)}" lon="${Number(c[0]).toFixed(6)}"></trkpt>`)
                .join('\n');
            if (pts) {
                trks += `  <trk>\n    <name>${escXml(p.nombre || 'Potrero')}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n`;
            }
        });

        if (Array.isArray(window.fincaRutaGpsPuntos) && window.fincaRutaGpsPuntos.length >= 2) {
            const pts = window.fincaRutaGpsPuntos
                .map(pt => `      <trkpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}"></trkpt>`)
                .join('\n');
            trks += `  <trk>\n    <name>Ruta GPS ${fecha}</name>\n    <trkseg>\n${pts}\n    </trkseg>\n  </trk>\n`;
        }

        const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FINCA AgroMacarena 35ha">\n${wpts}${trks}</gpx>\n`;
        descargarArchivoTexto(`FINCA_AgroMacarena_${fecha}.gpx`, gpx, 'application/gpx+xml;charset=utf-8');
        if (typeof mostrarToastFinca === 'function') mostrarToastFinca(`GPX exportado (${pms.length} marcas)`);
    };

    window.exportarPlacemarksKml = function () {
        const pms = getPlacemarksActuales();
        const fecha = new Date().toISOString().slice(0, 10);
        const marks = pms.map((pm) => {
            const lat = Number(pm.lat);
            const lng = Number(pm.lng);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return '';
            return `    <Placemark>\n` +
                   `      <name>${escXml(pm.nombre || 'Waypoint')}</name>\n` +
                   `      <description>${escXml(pm.comentario || pm.descripcion || pm.tipo || '')}</description>\n` +
                   `      <Point><coordinates>${lng.toFixed(6)},${lat.toFixed(6)},0</coordinates></Point>\n` +
                   `    </Placemark>\n`;
        }).join('');

        const kml = `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">\n  <Document>\n    <name>FINCA AgroMacarena ${fecha}</name>\n${marks}  </Document>\n</kml>\n`;
        descargarArchivoTexto(`FINCA_AgroMacarena_${fecha}.kml`, kml, 'application/vnd.google-earth.kml+xml;charset=utf-8');
        if (typeof mostrarToastFinca === 'function') mostrarToastFinca(`KML exportado (${pms.length} marcas)`);
    };

    window.importarArchivoGpxKml = async function (inputEl) {
        const file = inputEl && inputEl.files && inputEl.files[0];
        if (!file) return;
        try {
            const text = await file.text();
            const doc = new DOMParser().parseFromString(text, 'application/xml');
            const nuevos = [];

            // GPX <wpt>
            doc.querySelectorAll('wpt').forEach((w) => {
                const lat = parseFloat(w.getAttribute('lat'));
                const lon = parseFloat(w.getAttribute('lon'));
                if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
                const nombre = w.querySelector('name')?.textContent?.trim() || 'Importado GPX';
                const desc = w.querySelector('desc')?.textContent?.trim() || '';
                nuevos.push({ nombre, lat, lng: lon, tipo: 'Waypoint', color: '#22c55e', icono: 'Waypoint', comentario: desc });
            });

            // KML <Placemark><Point>
            doc.querySelectorAll('Placemark').forEach((pm) => {
                const coordTxt = pm.querySelector('Point > coordinates')?.textContent?.trim();
                if (!coordTxt) return;
                const parts = coordTxt.split(',').map(Number);
                if (parts.length < 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return;
                const nombre = pm.querySelector('name')?.textContent?.trim() || 'Importado KML';
                const desc = pm.querySelector('description')?.textContent?.trim() || '';
                nuevos.push({ nombre, lat: parts[1], lng: parts[0], tipo: 'Waypoint', color: '#0ea5e9', icono: 'Waypoint', comentario: desc });
            });

            if (!nuevos.length) {
                if (typeof mostrarToastFinca === 'function') mostrarToastFinca('No se encontraron puntos válidos en el archivo');
                return;
            }

            for (const item of nuevos) {
                if (typeof guardarPlacemarkDesdeObjeto === 'function') {
                    await guardarPlacemarkDesdeObjeto(item);
                } else {
                    const payload = {
                        id: 'PM-' + Date.now() + '-' + Math.floor(Math.random() * 1000),
                        nombre: item.nombre,
                        tipo: item.tipo,
                        color: item.color,
                        icono: item.icono,
                        lat: item.lat,
                        lng: item.lng,
                        comentario: item.comentario || '',
                        fecha: new Date().toISOString()
                    };
                    if (typeof ultimosPlacemarksMapa !== 'undefined' && Array.isArray(ultimosPlacemarksMapa)) {
                        ultimosPlacemarksMapa.push(payload);
                    }
                    if (typeof enqueueOfflineAction === 'function') {
                        enqueueOfflineAction('placemark_agregar', payload);
                    }
                }
            }

            if (typeof renderTab5TelemetriaLoRaYTaller === 'function') renderTab5TelemetriaLoRaYTaller();
            else if (typeof initOrUpdateGoogleMapFinca === 'function') initOrUpdateGoogleMapFinca();
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca(`Importados ${nuevos.length} puntos`);
        } catch (err) {
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Error leyendo archivo GPX/KML');
        } finally {
            inputEl.value = '';
        }
    };

    // --- 3. COBERTURA VISUAL DE MAPAS OFFLINE (INDEXEDDB) ---
    function tile2lon(x, z) { return (x / Math.pow(2, z)) * 360 - 180; }
    function tile2lat(y, z) {
        const n = Math.PI - (2 * Math.PI * y) / Math.pow(2, z);
        return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    }

    async function dibujarCoberturaOffline() {
        const map = window.fincaLeafletMap;
        if (!map || !window.aqCoberturaOfflineActiva) return;
        if (!window.fincaCoberturaLayer) {
            window.fincaCoberturaLayer = L.layerGroup().addTo(map);
        }
        window.fincaCoberturaLayer.clearLayers();
        if (typeof openMapTilesDb !== 'function') return;

        const db = await openMapTilesDb();
        if (!db) return;
        const layerKey = window.fincaCurrentBaseKey || 'google';
        const zTarget = Math.min(layerKey === 'topo' ? 17 : 19, Math.max(12, Math.round(map.getZoom() || 16)));
        const prefix = `${layerKey}_${zTarget}_`;

        await new Promise((resolve) => {
            try {
                const tx = db.transaction('tiles', 'readonly');
                const req = tx.objectStore('tiles').openCursor();
                let drawn = 0;
                req.onsuccess = (e) => {
                    const cursor = e.target.result;
                    if (cursor && drawn < 250) {
                        const key = String(cursor.key || '');
                        if (key.startsWith(prefix)) {
                            const parts = key.split('_');
                            const z = Number(parts[1]), x = Number(parts[2]), y = Number(parts[3]);
                            if (Number.isFinite(z) && Number.isFinite(x) && Number.isFinite(y)) {
                                const b = [[tile2lat(y + 1, z), tile2lon(x, z)], [tile2lat(y, z), tile2lon(x + 1, z)]];
                                L.rectangle(b, {
                                    color: '#10b981',
                                    weight: 1,
                                    fillColor: '#10b981',
                                    fillOpacity: 0.16,
                                    interactive: false
                                }).addTo(window.fincaCoberturaLayer);
                                drawn++;
                            }
                        }
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                req.onerror = () => resolve();
            } catch {
                resolve();
            }
        });
    }

    window.toggleCoberturaAlmacenamientoAq = function (visible) {
        window.aqCoberturaOfflineActiva = !!visible;
        const map = window.fincaLeafletMap;
        if (!map) return;
        if (!visible) {
            if (window.fincaCoberturaLayer) window.fincaCoberturaLayer.clearLayers();
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Cobertura offline oculta');
            return;
        }
        if (!window._fincaCoberturaHooked) {
            window._fincaCoberturaHooked = true;
            map.on('moveend zoomend', () => {
                if (window.aqCoberturaOfflineActiva) dibujarCoberturaOffline();
            });
        }
        dibujarCoberturaOffline();
        if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Cobertura offline visible en verde');
    };

    // --- 4. GEOCERCAS REALES DE POTREROS (ALERTAS LORA) ---
    function puntoEnPoligono(lat, lng, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i][1], yi = ring[i][0];
            const xj = ring[j][1], yj = ring[j][0];
            const intersect = ((yi > lng) !== (yj > lng)) && (lat < ((xj - xi) * (lng - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    window.verificarGeocercasCollares = function (collares) {
        if (!Array.isArray(collares) || !collares.length) return [];
        const potreros = getPotrerosActuales();
        const alertas = [];
        collares.forEach((c) => {
            const lat = Number(c.lat);
            const lng = Number(c.lng);
            if (Number.isFinite(c.bateria) && c.bateria <= 20) {
                alertas.push(`${c.vaca || c.collar_id}: batería baja (${c.bateria}%)`);
            }
            if (!Number.isFinite(lat) || !Number.isFinite(lng) || !potreros.length) return;
            const potreroObj = potreros.find(p => p.id === c.potrero_id || p.nombre === c.potrero);
            if (!potreroObj || !potreroObj.geojson) return;
            try {
                const gj = typeof potreroObj.geojson === 'string' ? JSON.parse(potreroObj.geojson) : potreroObj.geojson;
                const ring = gj?.geometry?.type === 'Polygon' ? gj.geometry.coordinates?.[0] : null;
                if (Array.isArray(ring) && ring.length >= 3 && !puntoEnPoligono(lat, lng, ring)) {
                    alertas.push(`${c.vaca || c.collar_id} fuera de ${potreroObj.nombre}`);
                }
            } catch {}
        });
        window.ultimasAlertasGeocercaLora = alertas;
        const banner = document.getElementById('aq-geocerca-alerta');
        if (banner) {
            if (alertas.length) {
                banner.textContent = `Alerta LoRa: ${alertas.slice(0, 2).join(' • ')}`;
                banner.style.display = 'flex';
            } else {
                banner.style.display = 'none';
            }
        }
        return alertas;
    };

    // --- 5. GRABADORA DE RUTA GPS REAL ---
    window.fincaRutaGpsPuntos = [];
    let rutaWatchId = null;

    function haversineM(a, b) {
        const R = 6371000;
        const dLat = ((b.lat - a.lat) * Math.PI) / 180;
        const dLon = ((b.lng - a.lng) * Math.PI) / 180;
        const s1 = Math.sin(dLat / 2), s2 = Math.sin(dLon / 2);
        const h = s1 * s1 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * s2 * s2;
        return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
    }

    window.toggleGrabacionRutaGps = function (activar) {
        if (!navigator.geolocation) {
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('GPS no disponible en este dispositivo');
            return;
        }
        if (activar) {
            window.fincaRutaGpsPuntos = [];
            if (rutaWatchId !== null) navigator.geolocation.clearWatch(rutaWatchId);
            rutaWatchId = navigator.geolocation.watchPosition((pos) => {
                const pt = { lat: pos.coords.latitude, lng: pos.coords.longitude, alt: pos.coords.altitude || 0, ts: Date.now() };
                const prev = window.fincaRutaGpsPuntos[window.fincaRutaGpsPuntos.length - 1];
                if (!prev || haversineM(prev, pt) >= 3) {
                    window.fincaRutaGpsPuntos.push(pt);
                    const map = window.fincaLeafletMap;
                    if (map) {
                        if (!window.fincaRutaGpsLayer) window.fincaRutaGpsLayer = L.polyline([], { color: '#ef4444', weight: 3.5 }).addTo(map);
                        window.fincaRutaGpsLayer.setLatLngs(window.fincaRutaGpsPuntos.map(p => [p.lat, p.lng]));
                    }
                }
            }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Grabando ruta GPS en el mapa');
        } else {
            if (rutaWatchId !== null) {
                navigator.geolocation.clearWatch(rutaWatchId);
                rutaWatchId = null;
            }
            const pts = window.fincaRutaGpsPuntos || [];
            if (pts.length >= 2) {
                let dist = 0;
                for (let i = 1; i < pts.length; i++) dist += haversineM(pts[i - 1], pts[i]);
                if (typeof mostrarToastFinca === 'function') mostrarToastFinca(`Ruta detenida: ${pts.length} pts (${Math.round(dist)} m). Puedes exportarla en GPX.`);
            }
        }
    };

    // --- 6. RESPALDO COMPLETO JSON ---
    window.exportarRespaldoJsonFinca = function () {
        const fecha = new Date().toISOString().slice(0, 10);
        const backup = {
            app: 'FINCA_AgroMacarena_35ha',
            fecha: new Date().toISOString(),
            placemarks: getPlacemarksActuales(),
            fincaState: window.fincaState || {},
            preferenciasAq: localStorage.getItem('finca_aq_opciones_v1') || '{}',
            preferenciasMapa: localStorage.getItem('finca_aq_prefs_v1') || '{}'
        };
        descargarArchivoTexto(`RESPALDO_FINCA_${fecha}.json`, JSON.stringify(backup, null, 2), 'application/json;charset=utf-8');
        if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Respaldo JSON descargado');
    };

    window.importarRespaldoJsonFinca = async function (inputEl) {
        const file = inputEl && inputEl.files && inputEl.files[0];
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text());
            if (!parsed || typeof parsed !== 'object') throw new Error('JSON inválido');
            if (parsed.preferenciasAq) localStorage.setItem('finca_aq_opciones_v1', parsed.preferenciasAq);
            if (parsed.preferenciasMapa) localStorage.setItem('finca_aq_prefs_v1', parsed.preferenciasMapa);
            if (Array.isArray(parsed.placemarks) && typeof ultimosPlacemarksMapa !== 'undefined') {
                ultimosPlacemarksMapa = parsed.placemarks;
            }
            if (parsed.fincaState && typeof parsed.fincaState === 'object') {
                window.fincaState = Object.assign(window.fincaState || {}, parsed.fincaState);
            }
            if (typeof cargarOpcionesAqLocal === 'function') cargarOpcionesAqLocal();
            if (typeof renderTab5TelemetriaLoRaYTaller === 'function') renderTab5TelemetriaLoRaYTaller();
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Respaldo JSON restaurado');
        } catch {
            if (typeof mostrarToastFinca === 'function') mostrarToastFinca('Error al leer respaldo JSON');
        } finally {
            inputEl.value = '';
        }
    };
})();
