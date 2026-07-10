# Bitácora de Vuelo — Guía de despliegue

Esta app tiene 2 piezas:

1. **Backend** (`Code.gs`) — vive dentro de un Google Sheet, como Apps Script. Actúa de API REST.
2. **Frontend** (`index.html`) — un archivo web único (HTML+CSS+JS) que puedes abrir en cualquier
   navegador (móvil, tablet, PC) o alojar donde quieras. Se conecta al backend por HTTP.

No hace falta instalar nada ni pagar hosting: todo corre sobre tu cuenta de Google gratis.

---

## PASO 1 — Crear el Google Sheet

1. Ve a [sheets.google.com](https://sheets.google.com) y crea una hoja de cálculo nueva.
2. Ponle un nombre, por ejemplo **"Bitácora de Vuelo — Datos"**.
3. No hace falta crear pestañas manualmente: el script las crea solo (`Logbook_Piloto`,
   `Logbook_Avion`, `Aeronaves`, `Squawks`).

## PASO 2 — Pegar el backend (Code.gs)

1. En el Sheet, ve a **Extensiones → Apps Script**.
2. Borra el contenido de `Code.gs` que aparece por defecto.
3. Pega el contenido completo del archivo `Code.gs` que te he generado.
4. Guarda el proyecto (icono de disquete o `Ctrl+S`). Ponle un nombre, ej. "Bitácora API".
5. En la barra de funciones de arriba, selecciona la función `setup` y pulsa **Ejecutar** ▶️.
   - La primera vez te pedirá autorización: acepta los permisos (es tu propio script sobre tu
     propia hoja, es seguro).
   - Esto crea las 4 pestañas con sus cabeceras.
6. Verifica en el Sheet que aparecieron las pestañas `Logbook_Piloto`, `Logbook_Avion`,
   `Aeronaves` y `Squawks`.

## PASO 3 — Desplegar como aplicación web

1. En el editor de Apps Script, pulsa **Implementar → Nueva implementación** (botón azul,
   arriba a la derecha).
2. En "Selecciona el tipo", elige **Aplicación web**.
3. Configura:
   - **Descripción**: "API Bitácora v1" (o lo que prefieras).
   - **Ejecutar como**: *Yo (tu cuenta)*.
   - **Quién tiene acceso**: **Cualquier usuario** (necesario para que el frontend pueda
     hacer peticiones sin login de Google; los datos siguen estando solo en tu Sheet privado).
4. Pulsa **Implementar**.
5. Autoriza permisos si te los vuelve a pedir.
6. Copia la **URL de la aplicación web** que te da Google. Tiene esta forma:
   ```
   https://script.google.com/macros/s/AKfycb........................./exec
   ```
   Esta es la URL que necesita el frontend.

> ⚠️ **Importante:** cada vez que edites `Code.gs`, debes crear una **nueva implementación**
> (o editar la existente con "Gestionar implementaciones → editar → Nueva versión") para que
> los cambios se reflejen en la URL pública. Guardar el archivo NO actualiza la Web App por sí solo.

## PASO 4 — Configurar el frontend

1. Abre el archivo `index.html` (haz doble clic, se abre en tu navegador; o súbelo a cualquier
   hosting estático — GitHub Pages, Netlify, Google Sites, un servidor propio, etc.).
2. Pulsa el botón **⚙ CONFIG** arriba a la derecha.
3. Pega la URL del Paso 3 en "URL del Web App".
4. Pulsa **GUARDAR** y luego **PROBAR CONEXIÓN**. Debe aparecer "✓ Conexión correcta" y el
   punto de estado (arriba a la izquierda) debe ponerse verde.

Listo — la app ya está operativa. Puedes:
- Guardar `index.html` como acceso directo / "Añadir a pantalla de inicio" en el móvil o tablet
  para que se sienta como una app nativa en cabina.
- Compartir el mismo `index.html` con varios pilotos: cada uno introduce su nombre y ve su
  propio libro; el libro de avión se comparte entre todos automáticamente porque los datos
  viven en el mismo Sheet.

## PASO 5 — Configurar cada aeronave (TTAF e inspecciones)

Por defecto, una aeronave nueva parte de 0 horas y de un intervalo de inspección de 100h.
Para ajustarlo a la realidad de tu avión:

1. En la pestaña **Libro de Avión**, escribe la matrícula y pulsa **CARGAR** (aunque no tenga
   vuelos registrados, se generará una ficha vacía).
2. Pulsa **⚙ AJUSTAR** y rellena:
   - **TTAF inicial**: horas de célula que ya tenía el avión antes de empezar a usar esta app.
   - **Horas de célula en la última inspección**: para calcular la cuenta atrás.
   - **Intervalo de inspección**: 50h o 100h.
   - **Fecha de la última inspección**.
3. Guarda. El contador de inspección y la barra de progreso se recalculan automáticamente
   con cada vuelo que se registre para esa matrícula.

---

## Cómo funciona la automatización (resumen técnico)

- El frontend (`index.html`) nunca escribe directamente en el Sheet: siempre pasa por la
  API de Apps Script (`doGet` / `doPost` en `Code.gs`), que valida los datos antes de guardarlos.
- **POST `addFlight`**: valida campos obligatorios, horas > 0 y aterrizajes ≥ 1; si todo es
  correcto, añade una fila idéntica en `Logbook_Piloto` y `Logbook_Avion` (mismo vuelo, dos
  vistas). Si el campo "Notas" no está vacío, además crea automáticamente una fila en
  `Squawks` con estado "Abierto".
- **GET `getPilotSummary`**: filtra `Logbook_Piloto` por nombre de PIC y calcula en el momento
  las horas totales, el desglose VFR/IFR y Diurno/Nocturno, y los aterrizajes de los
  últimos 90 días.
- **GET `getAircraftSummary`**: filtra `Logbook_Avion` por matrícula, suma horas para obtener
  el TTAF actual, cruza con la pestaña `Aeronaves` para calcular horas restantes hasta la
  próxima inspección, y añade las novedades (`Squawks`) abiertas/cerradas de esa aeronave.
- Las peticiones POST se envían con `Content-Type: text/plain` (en vez de `application/json`)
  a propósito: es la forma estándar de evitar que Apps Script bloquee la petición por CORS
  (Apps Script no gestiona bien el "preflight" OPTIONS que exige `application/json`).

## Solución de problemas

| Síntoma | Causa probable | Solución |
|---|---|---|
| "Configura primero la URL del Web App" | No has guardado la URL en ⚙ CONFIG | Repite el Paso 4 |
| El LED de conexión está en rojo | La URL es incorrecta, o la implementación no es "Cualquier usuario" | Revisa el Paso 3, apartado "Quién tiene acceso" |
| Los cambios en Code.gs no se aplican | Falta crear una nueva versión de la implementación | Implementar → Gestionar implementaciones → editar → Nueva versión |
| Error "Acción GET/POST no reconocida" | El `index.html` y el `Code.gs` no están sincronizados (versiones distintas) | Verifica que pegaste el `Code.gs` completo y sin modificar los nombres de `action` |
| No aparecen las pestañas del Sheet | No ejecutaste `setup()` manualmente | Repite el Paso 2, punto 5 |

---

## Estructura de archivos entregados

```
index.html        → Frontend completo (HTML + CSS + JS), un solo archivo, sin dependencias de build.
Code.gs            → Backend (Google Apps Script), pegar en el editor de Apps Script del Sheet.
INSTRUCCIONES.md    → Esta guía.
```
