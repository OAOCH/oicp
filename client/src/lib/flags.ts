export const FLAG_CATEGORIES: Record<string, { label: string; color: string }> = {
  competencia: { label: 'Competencia', color: 'blue' },
  tiempo: { label: 'Tiempo', color: 'amber' },
  precio: { label: 'Precio', color: 'orange' },
  concentracion: { label: 'Concentración', color: 'red' },
  transparencia: { label: 'Transparencia', color: 'gray' },
};

export const SEVERITY_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  0: { label: 'Info', color: 'text-gray-600', bg: 'bg-gray-100' },
  1: { label: 'Baja', color: 'text-yellow-700', bg: 'bg-yellow-50' },
  2: { label: 'Media', color: 'text-orange-700', bg: 'bg-orange-50' },
  3: { label: 'Alta', color: 'text-red-700', bg: 'bg-red-50' },
};

export const RISK_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  low: { bg: 'bg-green-100', text: 'text-green-800', label: 'Bajo' },
  moderate: { bg: 'bg-yellow-100', text: 'text-yellow-800', label: 'Moderado' },
  high: { bg: 'bg-orange-100', text: 'text-orange-800', label: 'Alto' },
  critical: { bg: 'bg-red-100', text: 'text-red-800', label: 'Crítico' },
};

export function riskColor(level: string) {
  return RISK_COLORS[level] || RISK_COLORS.low;
}

// ── Estados del proceso ──────────────────────────────────────
// Definición ÚNICA, compartida por la búsqueda y por el perfil de proveedor. Antes cada
// pantalla tenía su propia copia y ninguna cubría 'active' ni 'planned', así que el SERCOP
// devolvía esos valores y la interfaz los mostraba en crudo, en inglés, mezclados con
// "Finalizado" y "Contratado". Un valor desconocido ahora se muestra capitalizado y en su
// propio color, nunca como un código suelto.
export const STATUS_LABELS: Record<string, string> = {
  planning: 'Planificación',
  planned: 'Planificado',
  active: 'En curso',
  tender: 'Publicado',
  award: 'Adjudicado',
  contract: 'Contratado',
  complete: 'Finalizado',
  cancelled: 'Cancelado',
  unsuccessful: 'Desierto',
  withdrawn: 'Retirado',
  unknown: 'Sin estado',
};

export const STATUS_COLORS: Record<string, string> = {
  planning: 'bg-gray-100 text-gray-700',
  planned: 'bg-gray-100 text-gray-700',
  active: 'bg-sky-100 text-sky-700',
  tender: 'bg-blue-100 text-blue-700',
  award: 'bg-green-100 text-green-700',
  contract: 'bg-emerald-100 text-emerald-700',
  complete: 'bg-teal-100 text-teal-700',
  cancelled: 'bg-red-100 text-red-700',
  unsuccessful: 'bg-orange-100 text-orange-700',
  withdrawn: 'bg-orange-100 text-orange-700',
  unknown: 'bg-gray-100 text-gray-500',
};

/** Etiqueta legible de un estado. Un valor no catalogado se capitaliza en vez de mostrarse
 *  crudo, y así nunca aparece un identificador técnico en pantalla. */
export function statusLabel(status: string | null | undefined): string {
  if (!status) return STATUS_LABELS.unknown;
  const s = String(status).toLowerCase();
  if (STATUS_LABELS[s]) return STATUS_LABELS[s];
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]+/g, ' ');
}

export function statusColor(status: string | null | undefined): string {
  const s = String(status || 'unknown').toLowerCase();
  return STATUS_COLORS[s] || 'bg-gray-100 text-gray-600';
}

// ── Régimen normativo ───────────────────────────────────────
// El campo `regime` guarda identificadores internos (LOSNCP_COEFICIENTES,
// LOSNCP_REFORMADA, LOIP) que se mostraban CRUDOS en la ficha del proceso, con guion bajo y
// en mayúsculas. Aquí se traducen a algo que un lector pueda entender, y un valor no
// catalogado se limpia en vez de exponer el identificador.
// El régimen y el UMBRAL de ínfima cambian en fechas distintas, así que la etiqueta ya no
// puede prometer "coeficiente hasta el 6-oct": el régimen legal pasa a LOSNCP reformada el
// 7-oct-2025, pero el umbral de ínfima ya era de USD 10.000 desde el 7-jul-2025 por la
// Resolución R.E-SERCOP-2025-0152. Un proceso de agosto de 2025 lleva régimen de coeficientes
// y umbral de 10.000 a la vez, y la etiqueta anterior lo desmentía en la propia ficha.
const REGIMEN_LABELS: Record<string, string> = {
  LOSNCP_COEFICIENTES: 'LOSNCP · marco previo a la reforma del 7-oct-2025',
  LOSNCP_REFORMADA: 'LOSNCP reformada (desde el 7-oct-2025)',
  LOIP: 'LOSNCP reformada (desde el 7-oct-2025)',
  LOSNCP: 'LOSNCP',
};

export function regimeLabel(regime: string | null | undefined): string {
  if (!regime) return '';
  const r = String(regime).trim().toUpperCase();
  return REGIMEN_LABELS[r] || r.replace(/[_-]+/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
}

/** Cantidad entera para mostrar. Distingue el CERO real (se imprime "0") de la ausencia de
 *  dato (se imprime "—"). Mostrar un guion cuando el valor es cero hace leer "no se sabe"
 *  donde en realidad dice "ninguno". */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Number(n).toLocaleString('es-EC');
}

export function scoreColor(score: number): string {
  if (score <= 10) return '#22c55e';
  if (score <= 30) return '#eab308';
  if (score <= 60) return '#f97316';
  return '#ef4444';
}

export function formatCurrency(amount: number | null | undefined): string {
  if (!amount) return '—';
  return '$' + amount.toLocaleString('es-EC', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatDate(date: string | null | undefined): string {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('es-EC', { year: 'numeric', month: 'short', day: 'numeric' });
}
