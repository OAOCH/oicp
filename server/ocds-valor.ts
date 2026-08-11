/**
 * Lectura del PRESUPUESTO REFERENCIAL desde un release OCDS del SERCOP.
 *
 * Vive en su propio módulo, sin dependencias ni efectos secundarios, porque lo usan los dos
 * caminos de ingesta (server/updater.ts y server/load-data.ts) y tiene que haber UNA sola
 * definición del monto, igual que MONTO_SQL y montoPlausible() (regla 11). Antes vivía duplicada
 * en línea en los dos, y por eso el defecto de abajo estuvo en las dos.
 *
 * EL DEFECTO, CORREGIDO EL 11-AGO-2026. Los dos mapeos leían solo `tender.value.amount` y
 * `planning.budget`, y en los procesos del SERCOP ese campo viene VACÍO: el monto vive en
 * `tender.lots[].value.amount`. El último recurso era `parseFloat(sr.budget)` sobre el resultado
 * de búsqueda, que en esos casos trae la cadena "USD", y así acabó el TEXTO "USD" guardado como
 * si fuera un monto en 174.547 procesos, el 11,9% del corpus.
 *
 * Se había concluido que el dato era irrecuperable. Era falso: la fuente sí lo publica.
 * Comprobado contra la API del SERCOP en cinco procesos de esa bolsa; en los cinco `tender.value`
 * venía vacío y los lotes traían el monto:
 *
 *   SIE-DD01D04S-2024-00003 ->  40.105,69     SIE-CELECEP-2024-04422 -> 536.037,63
 *   SIE-GADMCG-2024-071     ->  26.057,94     SIE-EMAPAACEP-2024-015 ->  18.033,59
 *   SIE-GADGIRON-2024-20    ->  16.812,60
 *
 * En OCDS `tender.lots[].value` es el valor máximo estimado del lote, así que la suma de los
 * lotes es el valor estimado del procedimiento: el mismo concepto que `tender.value`.
 *
 * Devuelve un NÚMERO o null. Nunca una cadena. Guardar "USD" como monto fue el origen de todo.
 */
export function valorReferencial(tender: any, release: any, resultadoBusqueda: any): number | null {
  const num = (x: any): number | null => {
    const n = typeof x === 'number' ? x : parseFloat(x);
    return Number.isFinite(n) && n > 0 ? n : null;
  };

  const directo = num(tender?.value?.amount) ?? num(release?.planning?.budget?.amount?.amount);
  if (directo !== null) return directo;

  const lotes = Array.isArray(tender?.lots) ? tender.lots : [];
  let suma = 0;
  for (const lote of lotes) {
    const v = num(lote?.value?.amount);
    if (v !== null) suma += v;
  }
  if (suma > 0) return suma;

  return num(resultadoBusqueda?.budget);
}
