import { SEVERITY_LABELS, FLAG_CATEGORIES, riskColor, scoreColor } from '../lib/flags';

// ── Flag Badge ──────────────────────────────────────────────
export function FlagBadge({ flag }: { flag: any }) {
  const sev = SEVERITY_LABELS[flag.severity] || SEVERITY_LABELS[0];
  const cat = FLAG_CATEGORIES[flag.category];
  return (
    <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${sev.bg} ${sev.color}`}>
      <span className="font-mono">{flag.code}</span>
      <span className="opacity-70">·</span>
      <span>{flag.name_es || flag.name}</span>
    </div>
  );
}

// ── Flag Detail Card ────────────────────────────────────────
export function FlagCard({ flag }: { flag: any }) {
  const sev = SEVERITY_LABELS[flag.severity] || SEVERITY_LABELS[0];
  return (
    <div className={`border rounded-lg p-3 ${sev.bg} border-opacity-30`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`font-mono text-sm font-bold ${sev.color}`}>{flag.code}</span>
        <span className={`text-xs px-2 py-0.5 rounded-full ${sev.bg} ${sev.color} font-medium`}>
          Severidad: {sev.label}
        </span>
      </div>
      <p className="text-sm font-medium text-gray-900">{flag.name_es || flag.name}</p>
      {flag.detail && <p className="text-xs text-gray-600 mt-1">{flag.detail}</p>}
    </div>
  );
}

// ── Risk Badge ──────────────────────────────────────────────
export function RiskBadge({ level }: { level: string }) {
  const r = riskColor(level);
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${r.bg} ${r.text}`}>
      {r.label}
    </span>
  );
}

// ── Score Gauge ─────────────────────────────────────────────
export function ScoreGauge({ score, size = 'md' }: { score: number; size?: 'sm' | 'md' | 'lg' }) {
  const color = scoreColor(score);
  const sizes = { sm: 'w-10 h-10 text-xs', md: 'w-14 h-14 text-lg', lg: 'w-20 h-20 text-2xl' };
  return (
    <div className={`${sizes[size]} rounded-full border-4 flex items-center justify-center font-bold`}
      style={{ borderColor: color, color }}>
      {score}
    </div>
  );
}

// ── Stat Card ───────────────────────────────────────────────
export function StatCard({ label, value, sub, color }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border p-4 shadow-sm">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color || 'text-gray-900'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────
export function EmptyState({ message = 'No se encontraron resultados' }: { message?: string }) {
  return (
    <div className="text-center py-16 text-gray-400">
      <p className="text-4xl mb-2">🔍</p>
      <p>{message}</p>
    </div>
  );
}

// ── Loading ─────────────────────────────────────────────────
export function Loading() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-600 border-t-transparent" />
    </div>
  );
}

// ── Error de servicio ───────────────────────────────────────
// Distinto de EmptyState: "no hay resultados" y "el servicio falló" son
// situaciones diferentes y el usuario debe poder distinguirlas (y reintentar).
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="text-center py-16">
      <p className="text-4xl mb-2">⚠️</p>
      <p className="text-gray-700">{message}</p>
      {onRetry && (
        <button onClick={onRetry}
          className="mt-4 bg-brand-600 hover:bg-brand-700 text-white rounded-lg px-4 py-2 text-sm font-medium">
          Reintentar
        </button>
      )}
    </div>
  );
}
