// Cola de inputs por jugador (servidor).
//
// El cliente predice aplicando cada INPUT exactamente una vez, uno por tick de 30 Hz. Para que
// la reconciliación cuadre, el servidor hace lo mismo: guarda los inputs en una cola corta y
// consume uno por tick, en vez de quedarse solo con el último que llegó (con jitter de red
// llegaban dos en un tick y uno se perdía, o ninguno y se repetía el anterior).
//
// - Cola vacía (el input se retrasó): se repite el último eje y los botones mantenidos
//   (turbo 2, acelerar 8), nunca saltar (1) ni usar habilidad (4), y se anota un tick debido.
// - Los ticks debidos no se saldan enseguida: dejan hasta CUSHION inputs de colchón en la cola
//   (un desfase constante con la predicción no se nota, lo que da tirones es que cambie). Así
//   el siguiente retraso de red se absorbe sin repetir. Solo si se acumulan más, cada tick
//   debido se salda confirmando un input sin volver a avanzar. Sin jitter no hay deuda ni retraso.
// - Nunca se avanza más de una vez por tick: mandar inputs más rápido no da más velocidad;
//   el exceso se descarta (conservando saltos y habilidades pendientes).
export const HELD = 2 | 8, ONE_SHOT = 1 | 4;
export const MAX_QUEUE = 6;      // ~200 ms de inputs en espera como máximo
export const MAX_OWED = 15;      // ticks repetidos que se pueden saldar (~0,5 s)
export const CUSHION = 2;        // inputs de colchón (~66 ms) que se conservan ante el jitter
export const STALE_MS = 500;     // sin inputs durante más tiempo: eje 0 y sin botones

export function createInputQueue() {
  return {queue: [], lastSeq: 0, ackSeq: 0, owed: 0, axis: 0, held: 0, updatedAt: -Infinity};
}

// Guarda un INPUT recibido. Devuelve false si es antiguo o repetido.
export function pushInput(q, seq, axis, buttons, now) {
  if (seq <= q.lastSeq) return false;
  q.lastSeq = seq; q.updatedAt = now;
  q.queue.push({seq, axis, buttons});
  while (q.queue.length > MAX_QUEUE) {
    const dropped = q.queue.shift();
    q.queue[0].buttons |= dropped.buttons & ONE_SHOT;   // no perder un salto o una habilidad
    q.ackSeq = dropped.seq;
  }
  return true;
}

// Entrada a aplicar en este tick: {axis, buttons}. Actualiza q.ackSeq (el seq que se confirma
// al cliente en el SNAPSHOT, hasta el que ya no debe volver a simular).
export function nextInput(q, now) {
  if (!q.queue.length) {
    if (now - q.updatedAt >= STALE_MS) { q.owed = 0; return {axis: 0, buttons: 0}; }
    q.owed = Math.min(MAX_OWED, q.owed + 1);
    return {axis: q.axis, buttons: q.held};
  }
  // Saldar ticks repetidos: solo lo que exceda el colchón (así este tick sigue avanzando y
  // queda margen para el próximo retraso) y nunca un input con saltar/usar, que debe aplicarse.
  while (q.owed > 0 && q.queue.length > CUSHION + 1 && !(q.queue[0].buttons & ONE_SHOT)) {
    const paid = q.queue.shift();
    q.ackSeq = paid.seq; q.axis = paid.axis; q.held = paid.buttons & HELD; q.owed--;
  }
  const input = q.queue.shift();
  q.ackSeq = input.seq; q.axis = input.axis; q.held = input.buttons & HELD;
  return {axis: input.axis, buttons: input.buttons};
}

// Antes de la salida (o al reiniciar la carrera) no hay nada que simular: se vacía la cola.
export function resetInputs(q) {
  if (q.queue.length) q.ackSeq = q.queue.at(-1).seq;
  q.queue.length = 0; q.owed = 0; q.axis = 0; q.held = 0;
}
