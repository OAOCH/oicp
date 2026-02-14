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
