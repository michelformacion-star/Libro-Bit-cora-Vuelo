/**
 * ============================================================================
 *  BITÁCORA DE VUELO — Backend (Google Apps Script)
 *  Actúa como API REST sobre un Google Sheet.
 *
 *  Pestañas gestionadas automáticamente:
 *    - Logbook_Piloto   -> historial de vuelos (vista piloto)
 *    - Logbook_Avion    -> historial de vuelos (vista aeronave, mismos datos)
 *    - Aeronaves        -> configuración de TTAF e inspecciones por matrícula
 *    - Squawks          -> reportes de mantenimiento (abiertos/cerrados)
 *
 *  INSTALACIÓN: pega este archivo en Extensiones > Apps Script del Google
 *  Sheet, guarda, y despliega como Web App (ver INSTRUCCIONES.md).
 * ============================================================================
 */

// ----------------------------------------------------------------------------
// CONFIGURACIÓN
// ----------------------------------------------------------------------------

var SHEET_PILOTO   = 'Logbook_Piloto';
var SHEET_AVION    = 'Logbook_Avion';
var SHEET_AERONAVES = 'Aeronaves';
var SHEET_SQUAWKS  = 'Squawks';

// Cabeceras de cada pestaña, en orden. addFlight() escribe en este orden.
var HEADERS_LOGBOOK = [
  'Timestamp', 'Fecha', 'Matricula', 'Modelo', 'PIC', 'SIC',
  'Origen', 'Destino', 'Salida_UTC', 'Llegada_UTC',
  'Tiempo_Total_HHMM', 'Tiempo_Total_Decimal',
  'Tipo_Vuelo', 'Regla_Vuelo', 'Franja_Horaria',
  'Aterrizajes', 'Notas'
];

var HEADERS_AERONAVES = [
  'Matricula', 'TTAF_Inicial', 'Horas_Ultima_Inspeccion',
  'Intervalo_Inspeccion', 'Fecha_Ultima_Inspeccion', 'Fecha_Actualizacion'
];

var HEADERS_SQUAWKS = [
  'ID', 'Timestamp', 'Matricula', 'Descripcion', 'Estado',
  'Fecha_Apertura', 'Fecha_Cierre'
];

// ----------------------------------------------------------------------------
// UTILIDADES DE HOJA
// ----------------------------------------------------------------------------

function getSS_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function getOrCreateSheet_(name, headers) {
  var ss = getSS_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#1A2530').setFontColor('#FFFFFF');
    sh.autoResizeColumns(1, headers.length);
  }
  return sh;
}

/**
 * Ejecuta esto UNA VEZ manualmente desde el editor de Apps Script
 * (menú "Ejecutar" > seleccionar setup) para crear las 4 pestañas
 * con sus cabeceras antes de usar la app. También se auto-ejecuta
 * de forma perezosa en cada request, así que es opcional.
 */
function setup() {
  getOrCreateSheet_(SHEET_PILOTO, HEADERS_LOGBOOK);
  getOrCreateSheet_(SHEET_AVION, HEADERS_LOGBOOK);
  getOrCreateSheet_(SHEET_AERONAVES, HEADERS_AERONAVES);
  getOrCreateSheet_(SHEET_SQUAWKS, HEADERS_SQUAWKS);
}

function sheetToObjects_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    // saltar filas totalmente vacías
    if (row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    rows.push(obj);
  }
  return rows;
}

// ----------------------------------------------------------------------------
// RESPUESTAS
// ----------------------------------------------------------------------------

function jsonOut_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function okResponse_(data) {
  return jsonOut_({ status: 'success', data: data || null });
}

function errorResponse_(message) {
  return jsonOut_({ status: 'error', message: String(message) });
}

// ----------------------------------------------------------------------------
// ENTRY POINTS (doGet / doPost)
// ----------------------------------------------------------------------------

function doGet(e) {
  try {
    setup();
    var action = e.parameter.action;
    var lock = LockService.getScriptLock();
    lock.tryLock(5000);
    var result;
    switch (action) {
      case 'getPilotList':
        result = getPilotList_();
        break;
      case 'getAircraftList':
        result = getAircraftList_();
        break;
      case 'getPilotSummary':
        result = getPilotSummary_(e.parameter.pilot);
        break;
      case 'getAircraftSummary':
        result = getAircraftSummary_(e.parameter.matricula);
        break;
      case 'getSquawks':
        result = getSquawks_(e.parameter.matricula);
        break;
      case 'ping':
        result = { ok: true, time: new Date().toISOString() };
        break;
      default:
        lock.releaseLock();
        return errorResponse_('Acción GET no reconocida: ' + action);
    }
    lock.releaseLock();
    return okResponse_(result);
  } catch (err) {
    return errorResponse_(err.message || err);
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.tryLock(10000);
    setup();
    var body = JSON.parse(e.postData.contents);
    var action = body.action;
    var result;
    switch (action) {
      case 'addFlight':
        result = addFlight_(body.payload);
        break;
      case 'setAircraftConfig':
        result = setAircraftConfig_(body.payload);
        break;
      case 'closeSquawk':
        result = closeSquawk_(body.payload);
        break;
      default:
        return errorResponse_('Acción POST no reconocida: ' + action);
    }
    return okResponse_(result);
  } catch (err) {
    return errorResponse_(err.message || err);
  } finally {
    lock.releaseLock();
  }
}

// ----------------------------------------------------------------------------
// VALIDACIÓN
// ----------------------------------------------------------------------------

function validateFlight_(p) {
  var required = ['fecha', 'matricula', 'modelo', 'pic', 'origen', 'destino', 'salida', 'llegada', 'tiempoDecimal', 'tipoVuelo', 'reglaVuelo', 'franja', 'aterrizajes'];
  required.forEach(function (field) {
    if (p[field] === undefined || p[field] === null || p[field] === '') {
      throw new Error('Campo obligatorio faltante: ' + field);
    }
  });
  if (Number(p.tiempoDecimal) <= 0) {
    throw new Error('El tiempo total de vuelo debe ser mayor que cero.');
  }
  if (Number(p.aterrizajes) < 1 || !Number.isInteger(Number(p.aterrizajes))) {
    throw new Error('El número de aterrizajes debe ser un entero mayor o igual a 1.');
  }
  if (Number(p.tiempoDecimal) < 0 || Number(p.aterrizajes) < 0) {
    throw new Error('No se permiten valores negativos.');
  }
}

// ----------------------------------------------------------------------------
// LÓGICA: REGISTRAR VUELO
// ----------------------------------------------------------------------------

function addFlight_(p) {
  validateFlight_(p);

  var row = [
    new Date(),                 // Timestamp
    p.fecha,                    // Fecha DD/MM/AAAA
    String(p.matricula).toUpperCase().trim(),
    p.modelo,
    p.pic,
    p.sic || '',
    String(p.origen).toUpperCase().trim(),
    String(p.destino).toUpperCase().trim(),
    p.salida,
    p.llegada,
    p.tiempoHHMM,
    Number(p.tiempoDecimal),
    p.tipoVuelo,
    p.reglaVuelo,
    p.franja,
    Number(p.aterrizajes),
    p.notas || ''
  ];

  var shPiloto = getOrCreateSheet_(SHEET_PILOTO, HEADERS_LOGBOOK);
  var shAvion  = getOrCreateSheet_(SHEET_AVION, HEADERS_LOGBOOK);
  shPiloto.appendRow(row);
  shAvion.appendRow(row);

  // Si hay novedades reportadas, crear automáticamente un squawk abierto
  if (p.notas && String(p.notas).trim() !== '') {
    var shSquawks = getOrCreateSheet_(SHEET_SQUAWKS, HEADERS_SQUAWKS);
    var nextId = shSquawks.getLastRow(); // fila 1 = cabecera -> primer ID útil = lastRow
    shSquawks.appendRow([
      nextId,
      new Date(),
      String(p.matricula).toUpperCase().trim(),
      p.notas,
      'Abierto',
      p.fecha,
      ''
    ]);
  }

  return { inserted: true, fecha: p.fecha, matricula: p.matricula };
}

// ----------------------------------------------------------------------------
// LÓGICA: CONFIGURACIÓN DE AERONAVE (TTAF / inspecciones)
// ----------------------------------------------------------------------------

function setAircraftConfig_(p) {
  if (!p.matricula) throw new Error('Falta la matrícula.');
  var matricula = String(p.matricula).toUpperCase().trim();
  var sh = getOrCreateSheet_(SHEET_AERONAVES, HEADERS_AERONAVES);
  var values = sh.getDataRange().getValues();
  var rowIndex = -1;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).toUpperCase().trim() === matricula) {
      rowIndex = i + 1; // 1-indexed sheet row
      break;
    }
  }
  var newRow = [
    matricula,
    Number(p.ttafInicial) || 0,
    Number(p.horasUltimaInspeccion) || 0,
    Number(p.intervaloInspeccion) || 100,
    p.fechaUltimaInspeccion || '',
    new Date()
  ];
  if (rowIndex === -1) {
    sh.appendRow(newRow);
  } else {
    sh.getRange(rowIndex, 1, 1, newRow.length).setValues([newRow]);
  }
  return { saved: true, matricula: matricula };
}

// ----------------------------------------------------------------------------
// LÓGICA: CERRAR SQUAWK
// ----------------------------------------------------------------------------

function closeSquawk_(p) {
  if (p.id === undefined) throw new Error('Falta el ID del reporte.');
  var sh = getOrCreateSheet_(SHEET_SQUAWKS, HEADERS_SQUAWKS);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === String(p.id)) {
      sh.getRange(i + 1, 5).setValue('Cerrado'); // columna Estado
      sh.getRange(i + 1, 7).setValue(new Date());  // columna Fecha_Cierre
      return { closed: true, id: p.id };
    }
  }
  throw new Error('No se encontró el reporte con ID ' + p.id);
}

// ----------------------------------------------------------------------------
// LÓGICA: LISTAS (para selects del frontend)
// ----------------------------------------------------------------------------

function getPilotList_() {
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_PILOTO, HEADERS_LOGBOOK));
  var set = {};
  rows.forEach(function (r) { if (r.PIC) set[r.PIC] = true; });
  return Object.keys(set).sort();
}

function getAircraftList_() {
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_AVION, HEADERS_LOGBOOK));
  var set = {};
  rows.forEach(function (r) { if (r.Matricula) set[r.Matricula] = true; });
  return Object.keys(set).sort();
}

// ----------------------------------------------------------------------------
// LÓGICA: RESUMEN LIBRO DE PILOTO
// ----------------------------------------------------------------------------

function parseFechaDMY_(fecha) {
  // fecha en formato DD/MM/AAAA
  var parts = String(fecha).split('/');
  if (parts.length !== 3) return null;
  return new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
}

function getPilotSummary_(pilot) {
  if (!pilot) throw new Error('Falta el parámetro pilot.');
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_PILOTO, HEADERS_LOGBOOK));
  var mine = rows.filter(function (r) { return r.PIC === pilot; });

  var totalHoras = 0, vfr = 0, ifr = 0, diurno = 0, nocturno = 0;
  var aterrizajes90 = 0;
  var now = new Date();
  var ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

  mine.forEach(function (r) {
    var horas = Number(r.Tiempo_Total_Decimal) || 0;
    totalHoras += horas;
    if (r.Regla_Vuelo === 'VFR') vfr += horas;
    if (r.Regla_Vuelo === 'IFR') ifr += horas;
    if (r.Franja_Horaria === 'Diurno') diurno += horas;
    if (r.Franja_Horaria === 'Nocturno') nocturno += horas;

    var fechaVuelo = parseFechaDMY_(r.Fecha);
    if (fechaVuelo && fechaVuelo >= ninetyDaysAgo) {
      aterrizajes90 += Number(r.Aterrizajes) || 0;
    }
  });

  mine.sort(function (a, b) {
    var da = parseFechaDMY_(a.Fecha), db = parseFechaDMY_(b.Fecha);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });

  return {
    pilot: pilot,
    totalHoras: round2_(totalHoras),
    vfr: round2_(vfr),
    ifr: round2_(ifr),
    diurno: round2_(diurno),
    nocturno: round2_(nocturno),
    aterrizajes90: aterrizajes90,
    totalVuelos: mine.length,
    historial: mine
  };
}

// ----------------------------------------------------------------------------
// LÓGICA: RESUMEN LIBRO DE AVIÓN
// ----------------------------------------------------------------------------

function getAircraftSummary_(matricula) {
  if (!matricula) throw new Error('Falta el parámetro matricula.');
  matricula = String(matricula).toUpperCase().trim();

  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_AVION, HEADERS_LOGBOOK));
  var mine = rows.filter(function (r) { return String(r.Matricula).toUpperCase().trim() === matricula; });

  var horasAcumuladas = 0;
  mine.forEach(function (r) { horasAcumuladas += Number(r.Tiempo_Total_Decimal) || 0; });

  mine.sort(function (a, b) {
    var da = parseFechaDMY_(a.Fecha), db = parseFechaDMY_(b.Fecha);
    return (db ? db.getTime() : 0) - (da ? da.getTime() : 0);
  });

  // Configuración de la aeronave (TTAF inicial + inspección)
  var configRows = sheetToObjects_(getOrCreateSheet_(SHEET_AERONAVES, HEADERS_AERONAVES));
  var config = configRows.find(function (r) { return String(r.Matricula).toUpperCase().trim() === matricula; });

  var ttafInicial = config ? Number(config.TTAF_Inicial) || 0 : 0;
  var horasUltimaInspeccion = config ? Number(config.Horas_Ultima_Inspeccion) || 0 : 0;
  var intervalo = config ? Number(config.Intervalo_Inspeccion) || 100 : 100;

  var ttafActual = ttafInicial + horasAcumuladas;
  var proximaInspeccionEn = horasUltimaInspeccion + intervalo;
  var horasRestantes = proximaInspeccionEn - ttafActual;

  // Squawks
  var squawks = getSquawks_(matricula);

  return {
    matricula: matricula,
    ttafInicial: round2_(ttafInicial),
    horasAcumuladasEnApp: round2_(horasAcumuladas),
    ttafActual: round2_(ttafActual),
    intervaloInspeccion: intervalo,
    horasUltimaInspeccion: round2_(horasUltimaInspeccion),
    proximaInspeccionEn: round2_(proximaInspeccionEn),
    horasRestantesInspeccion: round2_(horasRestantes),
    totalVuelos: mine.length,
    historial: mine,
    squawksAbiertos: squawks.filter(function (s) { return s.Estado === 'Abierto'; }),
    squawksCerrados: squawks.filter(function (s) { return s.Estado === 'Cerrado'; }),
    tieneConfiguracion: !!config
  };
}

function getSquawks_(matricula) {
  var rows = sheetToObjects_(getOrCreateSheet_(SHEET_SQUAWKS, HEADERS_SQUAWKS));
  if (!matricula) return rows;
  matricula = String(matricula).toUpperCase().trim();
  return rows.filter(function (r) { return String(r.Matricula).toUpperCase().trim() === matricula; });
}

function round2_(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}
