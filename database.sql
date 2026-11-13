-- =============================================================================
-- FINCA - AgroMacarena 35ha (La Macarena, Meta, Colombia)
-- Esquema Relacional SQLite + Datos Reales Precargados (Seed Data)
-- =============================================================================

PRAGMA foreign_keys = ON;

-- 1. PRODUCCIÓN DIARIA
CREATE TABLE IF NOT EXISTS produccion_diaria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    quincena_id INTEGER NOT NULL DEFAULT 1,
    especie TEXT NOT NULL CHECK(especie IN ('Bovinos', 'Gallinas', 'Codornices', 'Pollos', 'Cerdos', 'Peces', 'Patos', 'Piscos')),
    producto TEXT NOT NULL CHECK(producto IN ('Leche_Litros', 'Huevos_Unidades', 'Carne_Kg')),
    cantidad REAL NOT NULL,
    precio_unitario REAL NOT NULL DEFAULT 2000,
    total_cop REAL NOT NULL,
    notas TEXT DEFAULT '',
    sincronizado INTEGER DEFAULT 1
);

-- 2. CONTABILIDAD DE LOS 3 SOBRES QUINCENALES
CREATE TABLE IF NOT EXISTS contabilidad_sobres (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    quincena_num INTEGER NOT NULL DEFAULT 1,
    fecha TEXT NOT NULL,
    tipo_movimiento TEXT NOT NULL CHECK(tipo_movimiento IN ('INGRESO', 'GASTO')),
    sobre_destino TEXT NOT NULL CHECK(sobre_destino IN ('OPERATIVO_24', 'FAMILIA_20', 'OBRAS_56')),
    concepto TEXT NOT NULL,
    monto_cop REAL NOT NULL,
    obra_id INTEGER DEFAULT NULL,
    sincronizado INTEGER DEFAULT 1
);

-- 3. FASES DE OBRAS Y CRONOGRAMA DE CONSTRUCCIÓN
CREATE TABLE IF NOT EXISTS fases_obras (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fase INTEGER NOT NULL CHECK(fase IN (1, 2, 3)),
    quincena_meta TEXT NOT NULL,
    nombre_obra TEXT NOT NULL,
    presupuesto_estimado REAL NOT NULL,
    gasto_acumulado REAL NOT NULL DEFAULT 0,
    estado TEXT NOT NULL CHECK(estado IN ('Pendiente', 'En Obra', 'Terminado')),
    detalles_tecnicos TEXT DEFAULT ''
);

-- 4. INVENTARIO DE ANIMALES (19 Vacas Paridas + Toro Suegro + Lotes Menores 8 Especies)
CREATE TABLE IF NOT EXISTS inventario_animales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo_nombre TEXT NOT NULL UNIQUE,
    especie TEXT NOT NULL,
    raza TEXT NOT NULL,
    ubicacion_anillo TEXT NOT NULL CHECK(ubicacion_anillo IN ('Anillo 1 Casa', 'Anillo 2 Ladera Seca', 'Anillo 3 Vientos Abajo', 'Potreros Rotacionales')),
    estado_reproductivo TEXT NOT NULL CHECK(estado_reproductivo IN ('Parida', 'Servida_Toro', 'Inseminada_IATF_Gyr', 'Preñada', 'Reproductor_Activo', 'Lote_En_Produccion', 'Lote_Proyectado')),
    fecha_ultimo_parto TEXT,
    fecha_servicio TEXT,
    fecha_proximo_parto TEXT,
    fecha_secado TEXT,
    litros_promedio_dia REAL DEFAULT 0,
    collar_id TEXT DEFAULT NULL,
    es_elite_iatf INTEGER DEFAULT 0,
    cantidad_lote INTEGER DEFAULT 1,
    notas TEXT DEFAULT '',
    cii_visual_din TEXT DEFAULT '',
    rfid_iso_15digitos TEXT DEFAULT '',
    tipo_din_ica TEXT DEFAULT 'Combinado_Paleta_RFID',
    fecha_aplicacion_din TEXT DEFAULT '2025-06-15',
    orden_apartado_manga TEXT DEFAULT 'NORMAL'
);

-- 5. ECONOMÍA CIRCULAR Y 35 POTREROS ROTACIONALES
CREATE TABLE IF NOT EXISTS economia_circular_potreros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    modulo TEXT NOT NULL, -- 'Mosca_Soldado', 'Biodigestor', o 'Potrero_1' al 'Potrero_35'
    kg_estiercol_ingresado REAL DEFAULT 0,
    kg_larva_cosechada REAL DEFAULT 0,
    ahorro_concentrado_cop REAL DEFAULT 0,
    potrero_actual_id INTEGER DEFAULT NULL,
    dias_ocupacion INTEGER DEFAULT 0,
    dias_descanso INTEGER DEFAULT 0,
    estado_lote TEXT DEFAULT 'Activo',
    fecha_cosecha_estimada TEXT DEFAULT NULL,
    notas TEXT DEFAULT ''
);

-- 6. TELEMETRÍA IOT DE COLLARES ELECTRÓNICOS (LoRa SX1262 + GPS + MPU6050 + DS18B20)
CREATE TABLE IF NOT EXISTS telemetria_collares (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    collar_id TEXT NOT NULL,
    id_animal INTEGER NOT NULL,
    fecha_hora TEXT NOT NULL,
    latitud REAL NOT NULL,
    longitud REAL NOT NULL,
    indice_actividad_pasos INTEGER NOT NULL,
    minutos_rumia_24h INTEGER NOT NULL,
    temperatura_cuello_c REAL NOT NULL,
    bateria_pct INTEGER NOT NULL,
    alerta_estado TEXT NOT NULL CHECK(alerta_estado IN ('NORMAL', 'CELO_DETECTADO', 'FIEBRE_BAJA_RUMIA', 'POSIBLE_PARTO', 'FUERA_DE_CERCA')),
    rssi_dbm INTEGER DEFAULT -78
);

-- TABLA AUXILIAR: TALLER DIY DE COLLARES (19 Collares)
CREATE TABLE IF NOT EXISTS taller_diy_checklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    categoria TEXT NOT NULL,
    item TEXT NOT NULL,
    especificacion TEXT NOT NULL,
    costo_unitario_cop REAL DEFAULT 0,
    completado INTEGER DEFAULT 0,
    collares_armados INTEGER DEFAULT 3
);

-- =============================================================================
-- SEED DATA: DATOS INICIALES REALES DE LA FINCA AGROMACARENA 35 HA
-- =============================================================================

-- A. FASES DE CONSTRUCCIÓN PRECARGADAS
-- Fase 1: Corto Plazo ($14.500.000 COP en 7.5 quincenas)
INSERT INTO fases_obras (id, fase, quincena_meta, nombre_obra, presupuesto_estimado, gasto_acumulado, estado, detalles_tecnicos) VALUES
(1, 1, 'Quincena 1-2', 'Alcantarilla 2 tubos y pedraplén en el nacedero del camino (100m)', 2200000, 1450000, 'En Obra', 'Paso firme para moto y cantinas de leche sobre el nacedero a mitad de los 200m de trocha.'),
(2, 1, 'Quincena 1-2', 'Malla metálica bajo los 30 cm del piso de tabla de la casa', 600000, 600000, 'Terminado', 'Cierre perimetral anti-ofidios y control de plagas bajo piso elevado de madera en la cima (Anillo 1).'),
(3, 1, 'Quincena 3', 'Placa de cemento ranurado en corral, techo pintado de blanco y canal lluvia', 2200000, 0, 'Pendiente', 'Piso antideslizante para las 19 vacas, reducción de estrés calórico (-4°C) y cosecha de agua lluvia.'),
(4, 1, 'Quincena 4', 'Biodigestor tubular (corral + baño exterior) + Caseta Mosca Soldado Negra 4x4m', 2600000, 0, 'Pendiente', 'Geomenbrana tubular en Anillo 3 para biogás de cocina, biol fertilizante y biofábrica de proteína BSF (42%).'),
(5, 1, 'Quincena 5-6', 'Cerca eléctrica solar + acueducto manguera 1" para potreros', 3200000, 0, 'Pendiente', 'Impulsor solar 50km y red principal de agua hacia los 35 potreros rotacionales (24 ha).'),
(6, 1, 'Quincena 5-6', 'Sanidad general y 6 Inseminaciones IATF Gyr Lechero / Holstein', 1400000, 0, 'Pendiente', 'Protocolo hormonal IATF + pajillas sexadas para las 6 vacas élite buscando crías F1 Gyrolando.'),
(7, 1, 'Quincena 7-8', '100 Codornices con jaulas + 40 Gallinas ponedoras', 2300000, 0, 'Pendiente', 'Codornices en Anillo 1 (Casa) y 40 Gallinas ponedoras en Anillo 2 (Ladera Derecha Seca).'),

-- Fase 2: Mediano Plazo ($13.600.000 COP)
(8, 2, 'Quincena 9-10', 'Banco forrajero de 3.5 ha (Caña, Botón de Oro, Bore, Yuca, Plátano, Cacao)', 2500000, 0, 'Pendiente', 'Suplementación estratégica de verano y ensilaje para sostener 7.5 L/vaca/día.'),
(9, 2, 'Quincena 11-13', '2 Piscinas de peces + 1.500 alevinos (Cachama/Tilapia) + 20 Patos', 4800000, 0, 'Pendiente', 'Ubicados en Anillo 3 (80-120m). Alimentación suplementada con larva viva de Mosca Soldado y bore.'),
(10, 2, 'Quincena 14-15', 'Cochera vientos abajo + 1 cerda de cría + 6 lechones', 3900000, 0, 'Pendiente', 'Anillo 3 (Vientos abajo) conectada directamente a la boca de carga del biodigestor tubular.'),
(11, 2, 'Quincena 16', 'Galpones separados para 100 Pollos de engorde y 20 Piscos (Pavos)', 2400000, 0, 'Pendiente', 'Anillo 2 (Ladera Seca) con separación estricta entre Piscos y Gallinas para prevenir Histomoniasis.'),

-- Fase 3: Largo Plazo ($25.000.000 COP)
(12, 3, 'Quincena 17-20', 'Ordeño mecánico de 2 puestos y sistema de frío solar', 6500000, 0, 'Pendiente', 'Reducción de tiempo de ordeño a 45 min y bonificación por calidad bacteriológica y frío.'),
(13, 3, 'Quincena 21-27', 'Compra de 3-4 Novillas F1 Gyrolando certificadas', 14000000, 0, 'Pendiente', 'Salto productivo de hato a promedios de 12-15 L/vaca/día en pastoreo tropical.'),
(14, 3, 'Quincena 28-30', 'Acueducto solar total con bebederos automáticos en los 35 potreros', 4500000, 0, 'Pendiente', 'Bombeo solar desde reservorio hacia cada uno de los 35 potreros sin ingreso del ganado a quebradas.');

-- B. INVENTARIO DE LAS 19 VACAS PARIDAS + 1 TORO DEL SUEGRO + LOTES 8 ESPECIES
-- Las primeras 6 vacas son las Élite seleccionadas para IATF (F1 Gyrolando), y las 13 restantes van con el Toro del Suegro.
INSERT INTO inventario_animales (id, codigo_nombre, especie, raza, ubicacion_anillo, estado_reproductivo, fecha_ultimo_parto, fecha_servicio, fecha_proximo_parto, fecha_secado, litros_promedio_dia, collar_id, es_elite_iatf, cantidad_lote, notas) VALUES
(1, 'Vaca #1 - La Madrina', 'Bovinos', 'Cebú Comercial x Pardo', 'Anillo 1 Casa', 'Inseminada_IATF_Gyr', '2026-08-15', '2026-10-20', '2027-08-01', '2027-06-02', 8.2, 'COLLAR-01', 1, 1, 'Líder del hato + Cría #1. Élite IATF Gyr Lechero. Collar LoRa #1 activo.'),
(2, 'Vaca #2 - Macarena', 'Bovinos', 'Criolla Caqueteña x Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-18', NULL, NULL, NULL, 7.6, 'COLLAR-02', 1, 1, 'Con Cría #2. Abierta postparto lista para IATF F1 Gyrolando. Collar LoRa #2 activo.'),
(3, 'Vaca #3 - Guayabera', 'Bovinos', 'Cebú x Holstein (Media Sangre)', 'Anillo 1 Casa', 'Parida', '2026-09-22', NULL, NULL, NULL, 7.8, 'COLLAR-03', 1, 1, 'Con Cría #3. Abierta postparto candidata Élite IATF. Collar LoRa #3 activo.'),
(4, 'Vaca #4 - Lucero', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Inseminada_IATF_Gyr', '2026-08-25', '2026-10-28', '2027-08-09', '2027-06-10', 7.4, NULL, 1, 1, 'Con Cría #4. Élite IATF Gyr Lechero.'),
(5, 'Vaca #5 - Mariposa', 'Bovinos', 'Gyr x Cebú', 'Anillo 1 Casa', 'Inseminada_IATF_Gyr', '2026-08-28', '2026-10-30', '2027-08-11', '2027-06-12', 7.5, NULL, 1, 1, 'Con Cría #5. Élite IATF Holstein Rojo para F1 Gyrolando.'),
(6, 'Vaca #6 - Serranía', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Inseminada_IATF_Gyr', '2026-09-02', '2026-11-02', '2027-08-14', '2027-06-15', 7.2, NULL, 1, 1, 'Con Cría #6. Élite IATF Gyr Lechero.'),
(7, 'Vaca #7 - Canela', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Servida_Toro', '2026-08-10', '2026-10-15', '2027-07-27', '2027-05-28', 6.4, NULL, 0, 1, 'Con Cría #7. Monta natural con Toro del Suegro.'),
(8, 'Vaca #8 - Pintada', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Servida_Toro', '2026-08-14', '2026-10-18', '2027-07-30', '2027-05-31', 6.2, NULL, 0, 1, 'Con Cría #8. Monta natural con Toro del Suegro.'),
(9, 'Vaca #9 - Nube', 'Bovinos', 'Brahman Blanco x Criolla', 'Anillo 1 Casa', 'Servida_Toro', '2026-08-20', '2026-10-25', '2027-08-06', '2027-06-07', 6.0, NULL, 0, 1, 'Con Cría #9. Monta natural con Toro del Suegro.'),
(10, 'Vaca #10 - Bambú', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Servida_Toro', '2026-08-29', '2026-11-01', '2027-08-13', '2027-06-14', 6.1, NULL, 0, 1, 'Con Cría #10. Monta natural con Toro del Suegro.'),
(11, 'Vaca #11 - Sabana', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Servida_Toro', '2026-09-05', '2026-11-05', '2027-08-17', '2027-06-18', 5.8, NULL, 0, 1, 'Con Cría #11. Monta natural con Toro del Suegro.'),
(12, 'Vaca #12 - Palma', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-12', NULL, NULL, NULL, 5.9, NULL, 0, 1, 'Con Cría #12. En lote con Toro del Suegro.'),
(13, 'Vaca #13 - Yarumo', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-15', NULL, NULL, NULL, 5.7, NULL, 0, 1, 'Con Cría #13. En lote con Toro del Suegro.'),
(14, 'Vaca #14 - Cachama', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-20', NULL, NULL, NULL, 5.6, NULL, 0, 1, 'Con Cría #14. En lote con Toro del Suegro.'),
(15, 'Vaca #15 - Trocha', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-25', NULL, NULL, NULL, 5.8, NULL, 0, 1, 'Con Cría #15. En lote con Toro del Suegro.'),
(16, 'Vaca #16 - Moriche', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-09-28', NULL, NULL, NULL, 5.5, NULL, 0, 1, 'Con Cría #16. En lote con Toro del Suegro.'),
(17, 'Vaca #17 - Laguna', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-10-01', NULL, NULL, NULL, 5.6, NULL, 0, 1, 'Con Cría #17. En lote con Toro del Suegro.'),
(18, 'Vaca #18 - Cristales', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-10-04', NULL, NULL, NULL, 5.5, NULL, 0, 1, 'Con Cría #18. En lote con Toro del Suegro.'),
(19, 'Vaca #19 - Tinigua', 'Bovinos', 'Criolla/Cebú', 'Anillo 1 Casa', 'Parida', '2026-10-08', NULL, NULL, NULL, 5.4, NULL, 0, 1, 'Con Cría #19. En lote con Toro del Suegro.'),
(20, 'Toro Suegro - Cacique', 'Bovinos', 'Gyr Puro x Brahman', 'Anillo 1 Casa', 'Reproductor_Activo', NULL, NULL, NULL, NULL, 0, NULL, 0, 1, 'Toro prestado del suegro. Cubre las 13 vacas de monta natural.'),

-- Lotes Menores (8 especies en los 3 Anillos de Bioseguridad de la Lomita 1.5 ha)
(21, 'Lote Codornices Postura (100 aves)', 'Codornices', 'Japónica Mejorada', 'Anillo 1 Casa', 'Lote_En_Produccion', NULL, NULL, NULL, NULL, 0, NULL, 0, 100, 'Anillo 1 (Cima 0-25m): En baterías junto a la casa. Meta 80 huevos/día.'),
(22, 'Lote Gallinas Ponedoras (40 aves)', 'Gallinas', 'Hy-Line Brown / Criolla', 'Anillo 2 Ladera Seca', 'Lote_En_Produccion', NULL, NULL, NULL, NULL, 0, NULL, 0, 40, 'Anillo 2 (Ladera Derecha Seca 30-60m): Pastoreo semi-confinado + larva BSF.'),
(23, 'Lote Pollos Engorde (100 aves)', 'Pollos', 'Ross 308 / Campero', 'Anillo 2 Ladera Seca', 'Lote_Proyectado', NULL, NULL, NULL, NULL, 0, NULL, 0, 100, 'Anillo 2 (Ladera Derecha Seca 30-60m): Galpón ventilado separado.'),
(24, 'Lote Piscos / Pavos (20 aves)', 'Piscos', 'Bronceado / Criollo', 'Anillo 2 Ladera Seca', 'Lote_Proyectado', NULL, NULL, NULL, NULL, 0, NULL, 0, 20, 'ALERTA BIOSEGURIDAD: Prohibido juntar con Gallinas por Histomonas meleagridis (Cabeza Negra).'),
(25, 'Cochera Cerdos (1 Cerda Cría + 6 Lechones)', 'Cerdos', 'Duroc x Pietrain', 'Anillo 3 Vientos Abajo', 'Lote_Proyectado', NULL, NULL, NULL, NULL, 0, NULL, 0, 7, 'Anillo 3 (Ladera Izquierda Vientos Abajo 80-120m): Conectada al Biodigestor.'),
(26, 'Piscicultura (2 Piscinas - 1.500 Alevinos)', 'Peces', 'Cachama Blanca / Tilapia Roja', 'Anillo 3 Vientos Abajo', 'Lote_Proyectado', NULL, NULL, NULL, NULL, 0, NULL, 0, 1500, 'Anillo 3 (80-120m): Alimentación con larva viva de Mosca Soldado y hoja de bore.'),
(27, 'Lote Patos Acuáticos (20 aves)', 'Patos', 'Pekín / Real Criollo', 'Anillo 3 Vientos Abajo', 'Lote_Proyectado', NULL, NULL, NULL, NULL, 0, NULL, 0, 20, 'Anillo 3 (80-120m): Integrados al sistema de espejos de agua y control de insectos.');

-- C. PRODUCCIÓN DIARIA: QUINCENA ACTUAL (Días 1 al 12 de la Quincena 1 = 114 L a 122 L/día)
INSERT INTO produccion_diaria (fecha, quincena_id, especie, producto, cantidad, precio_unitario, total_cop, notas) VALUES
('2026-11-01', 1, 'Bovinos', 'Leche_Litros', 114.0, 2000, 228000, 'Ordeño mañana 19 vacas (Base 6.0 L/vaca)'),
('2026-11-02', 1, 'Bovinos', 'Leche_Litros', 115.0, 2000, 230000, 'Ordeño normal - Potrero 6'),
('2026-11-03', 1, 'Bovinos', 'Leche_Litros', 114.0, 2000, 228000, 'Ordeño normal - Potrero 7'),
('2026-11-04', 1, 'Bovinos', 'Leche_Litros', 116.0, 2000, 232000, 'Suplementación sal mineral 8%'),
('2026-11-05', 1, 'Bovinos', 'Leche_Litros', 114.0, 2000, 228000, 'Ordeño normal - Potrero 8'),
('2026-11-06', 1, 'Bovinos', 'Leche_Litros', 115.0, 2000, 230000, 'Ordeño normal - Potrero 9'),
('2026-11-07', 1, 'Bovinos', 'Leche_Litros', 117.0, 2000, 234000, 'Buen pasto estrella en Potrero 10'),
('2026-11-08', 1, 'Bovinos', 'Leche_Litros', 116.0, 2000, 232000, 'Ordeño normal - Potrero 10'),
('2026-11-09', 1, 'Bovinos', 'Leche_Litros', 118.0, 2000, 236000, 'Ración caña picada y botón de oro'),
('2026-11-10', 1, 'Bovinos', 'Leche_Litros', 116.0, 2000, 232000, 'Ordeño normal - Potrero 11'),
('2026-11-11', 1, 'Bovinos', 'Leche_Litros', 118.0, 2000, 236000, 'Ordeño normal - Potrero 12'),
('2026-11-12', 1, 'Bovinos', 'Leche_Litros', 119.0, 2000, 238000, 'Hoy: 19 vacas en Potrero #12 (6.26 L/vaca)'),
('2026-11-11', 1, 'Gallinas', 'Huevos_Unidades', 32.0, 600, 19200, 'Recolección nidos Anillo 2'),
('2026-11-12', 1, 'Gallinas', 'Huevos_Unidades', 34.0, 600, 20400, 'Recolección nidos Anillo 2'),
('2026-11-12', 1, 'Codornices', 'Huevos_Unidades', 78.0, 200, 15600, 'Batería jaulas Anillo 1');

-- D. CONTABILIDAD DE LOS 3 SOBRES QUINCENALES (Liquidación Base $3.420.000 COP + Gastos reales)
INSERT INTO contabilidad_sobres (quincena_num, fecha, tipo_movimiento, sobre_destino, concepto, monto_cop, obra_id) VALUES
(1, '2026-11-01', 'INGRESO', 'OPERATIVO_24', 'Asignación Quincenal Leche 24% (Base 1.710 L x $2.000)', 820800, NULL),
(1, '2026-11-01', 'INGRESO', 'FAMILIA_20', 'Asignación Quincenal Sueldo Libre Familiar 20%', 684000, NULL),
(1, '2026-11-01', 'INGRESO', 'OBRAS_56', 'Asignación Quincenal Fondo Intocable de Obras 56%', 1915200, NULL),
(1, '2026-11-02', 'GASTO', 'OPERATIVO_24', '2 Bultos Sal Mineralizada 8% Fósforo + Melaza', 185000, NULL),
(1, '2026-11-05', 'GASTO', 'OPERATIVO_24', 'Gasolina Moto y Guadaña + Aceite 2T', 95000, NULL),
(1, '2026-11-08', 'GASTO', 'OPERATIVO_24', 'Abono Quincena Ayudante de Corral y Trocha', 260000, NULL),
(1, '2026-11-04', 'GASTO', 'FAMILIA_20', 'Mercado quincenal remesa casa La Macarena', 310000, NULL),
(1, '2026-11-03', 'GASTO', 'OBRAS_56', 'Compra 12 rollos malla metálica + grapas bajo piso casa (Obra #2 Terminada)', 600000, 2),
(1, '2026-11-07', 'GASTO', 'OBRAS_56', '2 Tubos concreto 24" + viaje piedra rajón nacedero 100m (Obra #1 En Obra)', 850000, 1);

-- E. ECONOMÍA CIRCULAR: BANDEJAS MOSCA SOLDADO NEGRA (BSF) + BIODIGESTOR + 35 POTREROS
INSERT INTO economia_circular_potreros (fecha, modulo, kg_estiercol_ingresado, kg_larva_cosechada, ahorro_concentrado_cop, potrero_actual_id, dias_ocupacion, dias_descanso, estado_lote, fecha_cosecha_estimada, notas) VALUES
('2026-11-01', 'Mosca_Soldado', 60.0, 14.5, 58000, NULL, 12, 0, 'Listo_Cosecha', '2026-11-13', 'Bandeja #1 y #2: Estiércol fresco + suero. ¡Mañana cumple 12 días para cosechar larva 42% proteína!'),
('2026-11-04', 'Mosca_Soldado', 75.0, 18.0, 72000, NULL, 8, 0, 'En_Engorde', '2026-11-16', 'Bandeja #3, #4 y #5: Larvas de 8 días procesando estiércol del corral.'),
('2026-11-09', 'Mosca_Soldado', 50.0, 12.0, 48000, NULL, 3, 0, 'Inoculado', '2026-11-21', 'Bandeja #6 y #7: Postura recién sembrada de neonatos BSF.'),
('2026-11-12', 'Biodigestor', 120.0, 0.0, 45000, NULL, 1, 0, 'Produciendo_Biogas', NULL, 'Carga diaria corral + baño: Presión biogás 14 cmH2O (3.5 horas llama azul en cocina) + 80L Biol para el banco forrajero.');

-- Precargar los 35 Potreros Rotacionales (24 ha = ~0.68 ha por potrero)
-- El hato de 19 vacas + Toro está hoy en el Potrero 12 (Día 1 de ocupación)
INSERT INTO economia_circular_potreros (fecha, modulo, kg_estiercol_ingresado, kg_larva_cosechada, ahorro_concentrado_cop, potrero_actual_id, dias_ocupacion, dias_descanso, estado_lote, notas) VALUES
('2026-11-12', 'Potrero_1', 0, 0, 0, 1, 0, 22, 'Descanso', 'Brachiaria Brizantha - Cerca a Lomita'),
('2026-11-12', 'Potrero_2', 0, 0, 0, 2, 0, 20, 'Descanso', 'Brachiaria Decumbens'),
('2026-11-12', 'Potrero_3', 0, 0, 0, 3, 0, 18, 'Descanso', 'Pasto Estrella Africana'),
('2026-11-12', 'Potrero_4', 0, 0, 0, 4, 0, 16, 'Descanso', 'Brachiaria Humidicola'),
('2026-11-12', 'Potrero_5', 0, 0, 0, 5, 0, 14, 'Descanso', 'Brachiaria Brizantha'),
('2026-11-12', 'Potrero_6', 0, 0, 0, 6, 0, 12, 'Recuperacion', 'Recién fertilizado con Biol'),
('2026-11-12', 'Potrero_7', 0, 0, 0, 7, 0, 10, 'Recuperacion', 'Pasto Estrella + Arachis Pintoi'),
('2026-11-12', 'Potrero_8', 0, 0, 0, 8, 0, 8, 'Recuperacion', 'Brachiaria Brizantha'),
('2026-11-12', 'Potrero_9', 0, 0, 0, 9, 0, 6, 'Recuperacion', 'Borde protegido Quebrada Norte'),
('2026-11-12', 'Potrero_10', 0, 0, 0, 10, 0, 4, 'Recuperacion', 'Salió el hato hace 4 días'),
('2026-11-12', 'Potrero_11', 0, 0, 0, 11, 0, 2, 'Recuperacion', 'Salió el hato ayer'),
('2026-11-12', 'Potrero_12', 0, 0, 0, 12, 1, 0, 'Ocupado_Hato', 'HATO ACTUAL AQUÍ (19 Vacas + Toro Suegro) - Día 1 de 2 máx'),
('2026-11-12', 'Potrero_13', 0, 0, 0, 13, 0, 45, 'Listo_Optimo', 'PRÓXIMO TURNO MAÑANA - Pasto en punto óptimo (45 días descanso)'),
('2026-11-12', 'Potrero_14', 0, 0, 0, 14, 0, 43, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_15', 0, 0, 0, 15, 0, 41, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_16', 0, 0, 0, 16, 0, 39, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_17', 0, 0, 0, 17, 0, 37, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_18', 0, 0, 0, 18, 0, 35, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_19', 0, 0, 0, 19, 0, 34, 'Listo_Optimo', 'Pasto en punto óptimo'),
('2026-11-12', 'Potrero_20', 0, 0, 0, 20, 0, 33, 'Listo_Optimo', 'Cerca de Laguna protegida'),
('2026-11-12', 'Potrero_21', 0, 0, 0, 21, 0, 32, 'Listo_Optimo', 'Brachiaria Brizantha'),
('2026-11-12', 'Potrero_22', 0, 0, 0, 22, 0, 31, 'Listo_Optimo', 'Brachiaria Decumbens'),
('2026-11-12', 'Potrero_23', 0, 0, 0, 23, 0, 30, 'Listo_Optimo', 'Pasto Estrella'),
('2026-11-12', 'Potrero_24', 0, 0, 0, 24, 0, 29, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_25', 0, 0, 0, 25, 0, 28, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_26', 0, 0, 0, 26, 0, 27, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_27', 0, 0, 0, 27, 0, 26, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_28', 0, 0, 0, 28, 0, 25, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_29', 0, 0, 0, 29, 0, 24, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_30', 0, 0, 0, 30, 0, 24, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_31', 0, 0, 0, 31, 0, 23, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_32', 0, 0, 0, 32, 0, 23, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_33', 0, 0, 0, 33, 0, 22, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_34', 0, 0, 0, 34, 0, 22, 'Descanso', 'En descanso'),
('2026-11-12', 'Potrero_35', 0, 0, 0, 35, 0, 21, 'Descanso', 'En descanso');

-- F. TELEMETRÍA COLLARES ELECTRÓNICOS LORA (Collar #1, #2 y #3 en La Macarena, Meta: ~2.1835° N, -73.7845° W)
INSERT INTO telemetria_collares (collar_id, id_animal, fecha_hora, latitud, longitud, indice_actividad_pasos, minutos_rumia_24h, temperatura_cuello_c, bateria_pct, alerta_estado, rssi_dbm) VALUES
('COLLAR-01', 1, '2026-11-12 06:00:00', 2.1842, -73.7848, 135, 485, 38.2, 94, 'NORMAL', -71),
('COLLAR-01', 1, '2026-11-12 10:00:00', 2.1838, -73.7841, 152, 490, 38.4, 93, 'NORMAL', -74),
('COLLAR-01', 1, '2026-11-12 14:00:00', 2.1836, -73.7839, 148, 495, 38.5, 92, 'NORMAL', -72),
('COLLAR-01', 1, '2026-11-12 16:00:00', 2.1837, -73.7840, 142, 492, 38.3, 91, 'NORMAL', -73),

('COLLAR-02', 2, '2026-11-12 06:00:00', 2.1841, -73.7849, 160, 460, 38.3, 88, 'NORMAL', -75),
('COLLAR-02', 2, '2026-11-12 10:00:00', 2.1839, -73.7843, 220, 440, 38.6, 87, 'NORMAL', -77),
('COLLAR-02', 2, '2026-11-12 14:00:00', 2.1835, -73.7842, 285, 410, 38.9, 86, 'CELO_DETECTADO', -76),
('COLLAR-02', 2, '2026-11-12 16:00:00', 2.1836, -73.7841, 312, 398, 38.8, 85, 'CELO_DETECTADO', -75),

('COLLAR-03', 3, '2026-11-12 06:00:00', 2.1840, -73.7847, 140, 470, 38.1, 82, 'NORMAL', -76),
('COLLAR-03', 3, '2026-11-12 10:00:00', 2.1837, -73.7840, 130, 465, 38.3, 81, 'NORMAL', -79),
('COLLAR-03', 3, '2026-11-12 14:00:00', 2.1834, -73.7838, 128, 468, 38.4, 80, 'NORMAL', -78),
('COLLAR-03', 3, '2026-11-12 16:00:00', 2.1835, -73.7839, 134, 472, 38.2, 79, 'NORMAL', -78);

-- G. LISTA DE CHEQUEO TALLER DIY (FABRICACIÓN DE LOS 19 COLLARES LORA EN LA FINCA)
INSERT INTO taller_diy_checklist (id, categoria, item, especificacion, costo_unitario_cop, completado, collares_armados) VALUES
(1, 'Electrónica', 'Placa Microcontrolador + Radio LoRa + GPS', 'Heltec Wireless Tracker / LilyGO T-Beam (ESP32 + LoRa SX1262 915MHz + GPS NEO-6M/UC6580)', 115000, 1, 3),
(2, 'Sensores', 'Acelerómetro / Giroscopio 6 Ejes (Pasos y Rumia)', 'Módulo MPU6050 por bus I2C (Pines SDA/SCL) para detectar montas de celo y masticación de rumia', 9500, 1, 3),
(3, 'Sensores', 'Sonda Térmica Impermeable de Cuello', 'Sensor DS18B20 acero inoxidable con resistencia pull-up 4.7kΩ en contacto con la piel del cuello', 8500, 1, 3),
(4, 'Energía', 'Celdas de Litio Recicladas 18650 + BMS / TP4056', '2x Baterías 18650 recicladas de portátil en paralelo (4.400 mAh) + mini panel solar 5V opcional en lomo', 12000, 1, 3),
(5, 'Carcasa', 'Carcasa Estanca en Tubo PVC Sanitario 2"', 'Tramo de 12 cm de tubo PVC sanitario 2" + 2 tapones soldados con limpiador y soldadura PVC + empaque de neumático', 11000, 1, 3),
(6, 'Sujeción', 'Correa de Cinturón de Seguridad o Neumático + Hebilla', 'Cinta de cinturón de carro reciclado (1.10 m) resistente al barro y humedad de La Macarena', 8000, 1, 3),
(7, 'Mecánica', 'Contrapeso Inferior de Hierro (500 g)', 'Platina o trozo de hierro en la parte baja de la correa para que el collar nunca se gire y la antena GPS mire al cielo', 6000, 1, 3),
(8, 'Estación Base', 'Receptor Gateway LoRa en Techo de Zinc de la Casa', 'ESP32 LoRa SX1262 con antena externa 5dBi en la cumbrera de la lomita (cubre las 35 ha + camino 200m) conectado por USB al PC', 125000, 1, 1);

-- 8. CONFIGURACIÓN PREDIO ICA / SINIGAN V6 / LEY 2585 DE 2026
CREATE TABLE IF NOT EXISTS config_predio_ica (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    nombre_predio TEXT DEFAULT 'Finca AgroMacarena 35ha',
    rspp_numero TEXT DEFAULT 'RSPP-50370-001',
    ruv_ciclo_actual TEXT DEFAULT 'RUV-2026-CICLO-II (Res. ICA 019881)',
    fecha_ultimo_ruv TEXT DEFAULT '2026-10-01',
    cedula_responsable TEXT DEFAULT 'TG Legacy S.A.S.',
    estado_bpg_leche TEXT DEFAULT 'En Implementación Res. 67449/2020',
    hectareas_totales REAL DEFAULT 35.0,
    hectareas_bosque_protegido REAL DEFAULT 6.0
);

-- 9. CONTROL LECHERO ALEMÁN MLP (HERDEplus - Milchleistungsprüfung)
CREATE TABLE IF NOT EXISTS control_lechero_mlp (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    id_animal INTEGER NOT NULL,
    fecha_control TEXT NOT NULL,
    dias_en_leche INTEGER DEFAULT 60,
    litros_manana REAL DEFAULT 0,
    litros_tarde REAL DEFAULT 0,
    litros_total_dia REAL DEFAULT 0,
    numero_frasco_muestra TEXT DEFAULT '',
    estado_salud_ubre TEXT DEFAULT 'Sana'
);

-- 10. MOVIMIENTOS OFICIALES SINIGAN V6 / HI-TIER
CREATE TABLE IF NOT EXISTS movimientos_sinigan_hit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    tipo_evento TEXT NOT NULL,
    animales_din_json TEXT DEFAULT '[]',
    destino_o_detalle TEXT DEFAULT '',
    cedula_transportador TEXT DEFAULT '',
    estado_guia TEXT DEFAULT 'Pendiente_Subir_SINIGAN'
);
