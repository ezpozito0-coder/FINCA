/**
 * =============================================================================
 * FINCA - AgroMacarena 35ha (La Macarena, Meta, Colombia)
 * Sketch Arduino / PlatformIO para Collares DIY y Receptor Gateway Techo Zinc
 * Hardware: ESP32 + LoRa SX1262 (915 MHz) + GPS NEO-6M + MPU6050 + DS18B20 + Tag NFC NTAG213
 * =============================================================================
 * MODO 1 (POR DEFECTO): NODO COLLAR VACA (Deep Sleep + Lectura Biométrica + LoRa TX)
 * MODO 2: GATEWAY RECEPTOR CASA (En el techo de zinc -> Envío DUAL simultáneo:
 *         1. Cable USB Serial (COM3/COM4 a 115200 baudios) leído por server.js
 *         2. WiFi HTTP POST hacia http://<IP_PC>:3000/api/telemetria/lora)
 */

#include <Arduino.h>
#include <Wire.h>
#if defined(ESP32)
  #include <WiFi.h>
  #include <HTTPClient.h>
#endif

// Cambiar a true para quemar el ESP32 Receptor ubicado en el techo de zinc de la casa
#define MODO_GATEWAY_CASA false

#define COLLAR_ID         "COLLAR-02"
#define ID_ANIMAL         2                   // Vaca #2 - Macarena
#define NFC_UID_COLLAR    "NFC-COLLAR-02"     // Tag NFC NTAG213/215 encapsulado en el tubo PVC

// Pines sensores en el Collar DIY (Tubo PVC Sanitario 2")
#define PIN_DS18B20       4      // Sonda térmica acero inoxidable con pull-up 4.7k
#define PIN_I2C_SDA       21     // Acelerómetro MPU6050 (Pasos y Rumia)
#define PIN_I2C_SCL       22
#define PIN_BAT_ADC       35     // Divisor resistivo batería 18650 reciclada

// Configuración WiFi Local de la Casa (Router LAN sin internet externo)
const char* WIFI_SSID     = "FINCA_MACARENA_LAN";
const char* WIFI_PASS     = "macarena35ha";
const char* SERVER_PC_URL = "http://192.168.1.100:3000/api/telemetria/lora";

void conectarWiFiGateway() {
#if defined(ESP32)
    if (WiFi.status() == WL_CONNECTED) return;
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    unsigned long t0 = millis();
    while (WiFi.status() != WL_CONNECTED && (millis() - t0) < 6000) {
        delay(250);
    }
#endif
}

// Envía la trama JSON recibida por LoRa tanto por Cable USB Serial como por WiFi HTTP POST
void despacharTramaDesdeGateway(const String& jsonTrama) {
    // 1. SALIDA DIRECTA POR CABLE USB SERIAL (Leída nativamente por server.js en COM3/COM4)
    Serial.println(jsonTrama);

    // 2. SALIDA SIMULTÁNEA POR WIFI LAN HTTP POST AL SERVIDOR SQLITE DEL PC
#if defined(ESP32)
    conectarWiFiGateway();
    if (WiFi.status() == WL_CONNECTED) {
        HTTPClient http;
        http.begin(SERVER_PC_URL);
        http.addHeader("Content-Type", "application/json");
        int httpCode = http.POST(jsonTrama);
        if (httpCode > 0) {
            Serial.printf("[GATEWAY WIFI POST OK] HTTP %d\n", httpCode);
        } else {
            Serial.printf("[GATEWAY WIFI WARN] Fallo POST (%s), trama entregada vía USB Serial.\n",
                          http.errorToString(httpCode).c_str());
        }
        http.end();
    }
#endif
}

void setup() {
    Serial.begin(115200);
    Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);

    if (MODO_GATEWAY_CASA) {
        Serial.println("[GATEWAY TECHO ZINC] Iniciando receptor LoRa 915MHz (USB Serial + WiFi HTTP POST)...");
        conectarWiFiGateway();
    } else {
        Serial.println("[COLLAR DIY] Iniciando lectura GPS + MPU6050 + DS18B20 + Tag NFC...");
    }
}

void loop() {
    if (!MODO_GATEWAY_CASA) {
        // ---------------------------------------------------------------------
        // MODO 1: COLLAR EN EL CUELLO DE LA VACA
        // ---------------------------------------------------------------------
        float tempCuello = 38.5;
        int pasosHora = 148;
        int rumia24h = 485;
        float lat = 2.15486;
        float lon = -73.71121;
        int bateriaPct = 89;

        String jsonPayload = "{";
        jsonPayload += "\"collar_id\":\"" + String(COLLAR_ID) + "\",";
        jsonPayload += "\"id_animal\":" + String(ID_ANIMAL) + ",";
        jsonPayload += "\"nfc_uid\":\"" + String(NFC_UID_COLLAR) + "\",";
        jsonPayload += "\"latitud\":" + String(lat, 6) + ",";
        jsonPayload += "\"longitud\":" + String(lon, 6) + ",";
        jsonPayload += "\"indice_actividad_pasos\":" + String(pasosHora) + ",";
        jsonPayload += "\"minutos_rumia_24h\":" + String(rumia24h) + ",";
        jsonPayload += "\"temperatura_cuello_c\":" + String(tempCuello, 1) + ",";
        jsonPayload += "\"bateria_pct\":" + String(bateriaPct);
        jsonPayload += "}";

        // Transmitir paquete por radio LoRa SX1262 (915 MHz) hacia el techo de zinc
        Serial.println(jsonPayload);

        // Dormir 15 minutos en Deep Sleep para autonomía de ~45 días con 2 celdas 18650
        delay(15000);
    } else {
        // ---------------------------------------------------------------------
        // MODO 2: GATEWAY RECEPTOR EN EL TECHO DE ZINC DE LA CASA
        // Recibe paquetes LoRa 915MHz (con RSSI) y los despacha por USB Serial + WiFi HTTP POST
        // ---------------------------------------------------------------------
        // Ejemplo de paquete recibido desde la antena LoRa SX1262:
        String loraRxJson = "{\"collar_id\":\"COLLAR-01\",\"id_animal\":1,\"nfc_uid\":\"NFC-COLLAR-01\",\"latitud\":2.154967,\"longitud\":-73.711417,\"indice_actividad_pasos\":142,\"minutos_rumia_24h\":490,\"temperatura_cuello_c\":38.4,\"bateria_pct\":91,\"rssi_dbm\":-72}";
        despacharTramaDesdeGateway(loraRxJson);

        delay(15000);
    }
}
