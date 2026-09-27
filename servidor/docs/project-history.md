# Surf Salvaje - online alpha

## Ejecutar
Node.js 22 y Git. `npm install`, `npm start`, abrir http://localhost:3000. `npm test` verifica protocolo, limites, rampas, divisiones y reconciliacion.

## Juego
Stickman articulado sin costuras negras entre extremidades. Cinco colores y cinco tablas con borde luminoso y detalles animados. Nick y seleccion guardados en el navegador. El stickman y la tienda conservan su geometria y previews vectoriales. El entorno usa arte PNG.

Recorrido de 20 unidades de ancho con barreras visibles, mar abierto a la izquierda y playa a la derecha. Rampas de impulso y divisiones de madera. Las rampas dan salto y aceleracion durante 2,6 segundos. Las divisiones frenan al tocarlas a baja altura y se pueden rodear o saltar.

Practica y Online comparten simulacion a 30 Hz y recorrido. No aparecen rocas, aros, puertas para agacharse ni monedas. A/D o flechas laterales, raton o gesto horizontal para dirigir. Espacio para saltar. W/flecha arriba/boton tactil para turbo. Mantener clic derecho para mirar atras. E para usar la habilidad. Tienda gratis; Wings y Hats reservados.

## Red
uWebSockets.js, salas de ocho jugadores, snapshots a 30 Hz y protocolo binario v7: ArrayBuffer, DataView, Little-Endian. El impulso se serializa y reconcilia con la posicion y velocidad vertical. Prediccion local e interpolacion remota.

## Pendiente antes de beta
Carreras con salida y meta compartidas, reconexion con sesion, pruebas de carga y dispositivos moviles. El servidor aplica exactamente un input por jugador y tick desde una cola corta (ver seccion Cola de inputs). No hay cuentas ni clasificacion persistente. En produccion se requiere HTTPS/WSS. Babylon.js y fuentes aun se descargan desde proveedores externos.

Los archivos antiguos de sprites se conservan como respaldo; no se sirven ni se importan.


## Entorno pintado
Cinco PNG compartidos: palmera y vegetacion con transparencia, arena, madera y superficie de rampa. Vegetacion en capas con parallax en coordenadas del mundo; muros y rampas conservan volumen y colisiones. Archivos: `assets/coast-*.png`. Generados con imagegen integrado. Prompts en `assets/environment-prompts.md`.


### Circuito cerrado
El recorrido usa `shared/track.js`: ocho circuitos costeros cerrados sin cruces, parametrizados por distancia, compartidos por minimapa, pista, jugadores, camara, rampas y costa. Cada vuelta mide 960 unidades y la carrera tiene tres vueltas. La simulacion usa distancia longitudinal y desplazamiento lateral; la proyeccion mundial se aplica solo durante el render.
Los bordes de personajes y tablas usan una variante m?s oscura de su propia paleta, incluida la vista de tienda.


### Carreras aleatorias (protocolo v4)
Ocho trazados cerrados y ambientes seleccionados al azar, dificultad 1 a 8 (curvatura y ancho lateral). El servidor asigna mapa por sala y admite participantes solo antes de la salida compartida. Cuenta regresiva de 3 segundos; cada carrera tiene 3 vueltas de 960 unidades. El protocolo binario Little-Endian ahora incluye mapa, cuenta regresiva, tiempo en ticks, rampas, saltos, pirueta y puesto de llegada. El servidor avanza aunque no reciba comandos, descarta direcciones antiguas tras 500 ms y conserva el salto pendiente. Las r?fagas de entrada no llenan una cola ni provocan una expulsi?n.
La meta muestra tiempo, puesto, rampas y saltos. En pr?ctica, el puesto se etiqueta como individual. Espacio selecciona una de cinco piruetas por salto aceptado, con animaci?n visual independiente de la c?mara.
Validaci?n: `npm test`; con servidor activo, `node scripts/verify-race-live.mjs` comprueba dos conexiones, salida/mapa compartidos, r?faga de 100 entradas y pausa de 10 segundos.


### Salas de amigos
Crear/unirse abre el selector: el anfitrion fija uno de los ocho mapas y recibe un codigo de seis digitos. La sala queda detenida hasta que el anfitrion pulse Iniciar carrera. Invitados entran con el codigo, con limite de ocho jugadores; las salas iniciadas no admiten nuevas entradas. El servidor valida el permiso de inicio y transfiere anfitrion si el creador se desconecta. ROOM_REQUEST/ROOM_STATE/ROOM_START usan el protocolo binario y Little-Endian para los enteros multibyte. Las rampas activan una de cinco piruetas sincronizadas, manteniendo separados los contadores de rampas y saltos manuales.

Fondos ilustrados adicionales: pendientes. La herramienta de imagen devolvio limite de uso; consultar assets/pending-backgrounds.md. No se generaron archivos nuevos de fondo en esta etapa.


## Poderes y controles (septiembre 2026)
Ocho habilidades: Tiki (8 s), Ola cohete (3 s), Coco buscador, Remolino, Pulso de marea, Espuma cegadora (2 s), Salto del delfin con impulso al aterrizar y Estela del lider (5 s, requiere seguir al rival marcado). Tiki bloquea ataques. Una caja solo puede concederse a un jugador.
Cada sala comparte una semilla uint32 que produce 48 cajas individuales, incluidas cajas elevadas tras rampas. El servidor decide recogidas, objetivos e impactos. POWER_WORLD: cabecera de 20 bytes, ids recogidos uint8 y entidades de 32 bytes. SNAPSHOT: cabecera de 14 bytes y 108 bytes por jugador; temporizadores uint16 y objetivo de estela uint32. Todo multibyte es Little-Endian. Recargar clientes al cambiar version.
Velocidad base 16, turbo manual 34, turbo de habilidad 38 unidades/s. Efectos con un GlowLayer compartido; Tiki modifica la emision del avatar, sin esfera desplazada. Efectos extra desactivados en calidad baja. PNG originales en `assets/power-*.png` y marco en `assets/hud-surf-frame.png`.
Pruebas: `npm test`, `node scripts/verify-powerups-live.mjs`, `node scripts/verify-race-live.mjs`, `node scripts/verify-capacity-live.mjs` (servidor iniciado).


## Cola de inputs (septiembre 2026)
El servidor guarda los INPUT de cada jugador en una cola (`src/input-queue.js`) y aplica uno por tick, igual que la prediccion del cliente. Si la red retrasa un input, repite el ultimo eje y los botones mantenidos (nunca saltar ni usar habilidad) y anota un tick debido; esa deuda deja hasta 2 inputs de colchon ante el siguiente retraso y solo se salda si se acumulan mas. Nunca se avanza mas de una vez por tick. Sin inputs durante 500 ms el eje vuelve a 0.
Prueba con 8 humanos simulados: `node scripts/verify-inputs-live.mjs` (variables PORT, JITTER, SECONDS).
