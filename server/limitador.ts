/**
 * Limitador de EMISIÓN de peticiones, correcto con varios hilos en vuelo.
 *
 * Existe por un defecto concreto. El barrido pedía turno así:
 *
 *     const gap = 350 - (Date.now() - ultima);
 *     if (gap > 0) await sleep(gap);
 *     ultima = Date.now();
 *
 * Eso funciona en serie y se rompe en cuanto hay concurrencia: los N hilos leen la MISMA
 * `ultima`, calculan la misma espera, duermen lo mismo y despiertan a la vez. El resultado no es
 * una petición cada 350 ms: son N de golpe cada 350 ms. Con 12 hilos, ~34 por segundo.
 * Y ~8 por segundo es justo el ritmo que ya provocó 21 respuestas 429 seguidas del SERCOP,
 * con `Retry-After: 24` en cada una.
 *
 * La forma correcta es RESERVAR el turno en vez de consultarlo: cada llamada se apunta el
 * siguiente hueco libre y lo adelanta ANTES de dormir. Como JavaScript no interrumpe la ejecución
 * entre dos sentencias sin `await`, esa reserva es atómica y no hay carrera posible.
 *
 * Sirve además para lo otro que hacía falta: cuando el servidor responde 429, el freno tiene que
 * aplicarse a TODOS los hilos, no solo al que se llevó el rechazo. El límite es del servidor.
 */
export type Limitador = {
  /** Espera hasta que toque emitir. Reserva el hueco de forma atómica. */
  turno: () => Promise<void>;
  /** Frena a TODOS los hilos los segundos indicados (respuesta a un 429 con Retry-After). */
  frenar: (segundos: number) => void;
  /** Instante (ms epoch) del próximo hueco reservado. Para pruebas y diagnóstico. */
  proximoHueco: () => number;
};

export function crearLimitador(gapMs: number, dormir?: (ms: number) => Promise<void>): Limitador {
  const sleep = dormir || ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));
  let siguiente = 0;
  return {
    async turno() {
      const ahora = Date.now();
      const t = Math.max(ahora, siguiente);
      siguiente = t + gapMs;          // reserva atómica: sin await entre leer y escribir
      if (t > ahora) await sleep(t - ahora);
    },
    frenar(segundos: number) {
      siguiente = Math.max(siguiente, Date.now() + segundos * 1000);
    },
    proximoHueco: () => siguiente,
  };
}
