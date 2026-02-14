/**
 * Seed script — Genera datos demo realistas para OICP
 * Run: npx tsx server/seed.ts
 */
import { migrate, upsertProcedure, rebuildConcentrationIndex } from './db.js';
import { evaluateAllFlags, getRegime, getInfimaThreshold, parseOcdsRelease } from './flag-engine.js';

migrate();

// ── Realistic Entities ──────────────────────────────────────
const BUYERS = [
  { id: 'GAD-170150', name: 'GAD Municipal del Distrito Metropolitano de Quito' },
  { id: 'GAD-090150', name: 'GAD Municipal de Guayaquil' },
  { id: 'GAD-010150', name: 'GAD Municipal de Cuenca' },
  { id: 'MTOP-001', name: 'Ministerio de Transporte y Obras Públicas' },
  { id: 'MSP-001', name: 'Ministerio de Salud Pública' },
  { id: 'MINEDUC-001', name: 'Ministerio de Educación' },
  { id: 'IESS-001', name: 'Instituto Ecuatoriano de Seguridad Social' },
  { id: 'PETROECUADOR-001', name: 'EP Petroecuador' },
  { id: 'GAD-130150', name: 'GAD Municipal de Portoviejo' },
  { id: 'GAD-080150', name: 'GAD Municipal de Esmeraldas' },
  { id: 'SENAGUA-001', name: 'Secretaría del Agua' },
  { id: 'CNE-001', name: 'Consejo Nacional Electoral' },
];

const SUPPLIERS = [
  { id: 'RUC-1791234567001', name: 'CONSTRUCTORA ANDINA S.A.' },
  { id: 'RUC-0991234567001', name: 'SERVICIOS INTEGRALES GUAYAQUIL CIA. LTDA.' },
  { id: 'RUC-1791234568001', name: 'TECNOLOGÍA AVANZADA S.A.' },
  { id: 'RUC-0101234567001', name: 'SUMINISTROS DEL AUSTRO CIA. LTDA.' },
  { id: 'RUC-1791234569001', name: 'MEDICAL IMPORT ECUADOR S.A.' },
  { id: 'RUC-0991234568001', name: 'ALIMENTOS COSTA RICA S.A.' },
  { id: 'RUC-1791234570001', name: 'CONSULTING GROUP ECUADOR CIA. LTDA.' },
  { id: 'RUC-1791234571001', name: 'INFRAESTRUCTURA NACIONAL S.A.' },
  { id: 'RUC-0991234569001', name: 'PROVEEDORA GENERAL DEL LITORAL S.A.' },
  { id: 'RUC-1791234572001', name: 'SEGURIDAD INDUSTRIAL QUITO CIA. LTDA.' },
  { id: 'RUC-1791234573001', name: 'EMPRESA FANTASMA MULTISERVICIO S.A.' },
  { id: 'RUC-1091234567001', name: 'LIMPIEZA Y MANTENIMIENTO TOTAL S.A.' },
];

const METHODS = [
  { method: 'open', details: 'Subasta Inversa Electrónica' },
  { method: 'open', details: 'Licitación' },
  { method: 'limited', details: 'Ínfima Cuantía' },
  { method: 'open', details: 'Cotización' },
  { method: 'open', details: 'Menor Cuantía Bienes y Servicios' },
  { method: 'open', details: 'Concurso Público' },
  { method: 'selective', details: 'Régimen Especial' },
  { method: 'direct', details: 'Catálogo Electrónico' },
  { method: 'open', details: 'Feria Inclusiva' },
  { method: 'selective', details: 'Contratación Directa' },
];

const CPC_CODES = ['43', '46', '53', '62', '72', '83', '84', '85', '91', '94'];
const TITLES = [
  'Adquisición de equipos de computación para la institución',
  'Servicio de limpieza y mantenimiento de oficinas',
  'Construcción de vía de acceso principal',
  'Adquisición de insumos médicos y medicamentos',
  'Servicio de alimentación para personal operativo',
  'Consultoría para diseño arquitectónico',
  'Adquisición de mobiliario de oficina',
  'Servicio de seguridad y vigilancia',
  'Mantenimiento de vehículos institucionales',
  'Adquisición de material didáctico',
  'Construcción de sistema de alcantarillado',
  'Servicio de transporte institucional',
  'Adquisición de uniformes para personal',
  'Consultoría para auditoría de gestión',
  'Provisión de combustibles y lubricantes',
  'Reparación y mantenimiento de infraestructura',
  'Adquisición de equipos de laboratorio',
  'Servicio de comunicación social',
  'Construcción de centro de salud tipo B',
  'Servicio de capacitación técnica especializada',
];

// ── Helpers ─────────────────────────────────────────────────
const rand = (min: number, max: number) => Math.random() * (max - min) + min;
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];
const randDate = (year: number, monthStart = 1, monthEnd = 12) => {
  const month = Math.floor(rand(monthStart, monthEnd + 1));
  const day = Math.floor(rand(1, 29));
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};
const addDays = (date: string, days: number) => {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
};

// ── Generate procedures ─────────────────────────────────────
console.log('Generating demo data...');

const procedures: any[] = [];
let id = 0;

for (const year of [2022, 2023, 2024, 2025]) {
  const count = year === 2025 ? 200 : 300;

  for (let i = 0; i < count; i++) {
    id++;
    const buyer = pick(BUYERS);
    const supplier = pick(SUPPLIERS);
    const methodObj = year >= 2025 
      ? pick(METHODS.filter(m => !['Cotización', 'Menor Cuantía Bienes y Servicios', 'Contratación Directa'].includes(m.details)))
      : pick(METHODS);
    
    const isInfima = methodObj.details.includes('nfima');
    const threshold = getInfimaThreshold(`${year}-06-15`);
    
    // Generate realistic amounts
    let budget: number;
    if (isInfima) {
      // Most near threshold, some well below
      budget = Math.random() < 0.3 
        ? rand(threshold * 0.85, threshold)  // Near threshold — flag trigger
        : rand(500, threshold * 0.7);
    } else if (methodObj.details.includes('Licitación') || methodObj.details.includes('Concurso')) {
      budget = rand(100_000, 5_000_000);
    } else {
      budget = rand(threshold, 200_000);
    }
    budget = Math.round(budget * 100) / 100;

    // Award amount (sometimes differs significantly from budget)
    const awardDiff = Math.random() < 0.15 ? rand(-0.25, 0.30) : rand(-0.05, 0.05);
    const awardAmount = Math.round(budget * (1 + awardDiff) * 100) / 100;

    // Contract modifications
    const hasAmendments = Math.random() < 0.12;
    const contractAmount = hasAmendments 
      ? Math.round(awardAmount * rand(1.05, 1.45) * 100) / 100 
      : awardAmount;

    // Dates
    const pubDate = year === 2025 
      ? randDate(2025, 1, 11)
      : randDate(year);
    const deadlineDays = isInfima ? rand(1, 3) : rand(3, 30);
    const submissionDeadline = addDays(pubDate, Math.round(deadlineDays));
    const awardDays = isInfima ? rand(1, 5) : rand(5, 60);
    const awardDate = addDays(pubDate, Math.round(awardDays));

    // Number of tenderers
    const nTenderers = isInfima ? 1 
      : methodObj.method === 'direct' ? 1
      : Math.random() < 0.25 ? 1  // Single bidder 25% of competitive
      : Math.floor(rand(2, 8));

    const proc = {
      id: `ocds-demo-${String(id).padStart(6, '0')}`,
      ocid: `ocds-demo-${String(id).padStart(6, '0')}`,
      title: pick(TITLES),
      description: pick(TITLES) + ` - Proceso ${id}`,
      status: 'complete',
      procurement_method: methodObj.method,
      procurement_method_details: methodObj.details,
      buyer_id: buyer.id,
      buyer_name: buyer.name,
      budget_amount: budget,
      budget_currency: 'USD',
      award_amount: awardAmount,
      contract_amount: contractAmount,
      final_amount: hasAmendments ? contractAmount : null,
      published_date: pubDate,
      submission_deadline: submissionDeadline,
      award_date: awardDate,
      contract_date: addDays(awardDate, Math.round(rand(5, 30))),
      suppliers: [{ id: supplier.id, name: supplier.name }],
      number_of_tenderers: nTenderers,
      items_classification: pick(CPC_CODES),
      has_amendments: hasAmendments,
      amendment_count: hasAmendments ? Math.floor(rand(1, 4)) : 0,
      source_year: year,
      regime: getRegime(pubDate),
    };

    // Evaluate flags
    const { flags, score, riskLevel } = evaluateAllFlags(proc);
    proc.flags = flags;
    proc.score = score;
    proc.risk_level = riskLevel;

    procedures.push(proc);
  }
}

// Add some deliberately suspicious patterns for demo
// Pattern 1: Same buyer+supplier, many ínfimas
for (let i = 0; i < 8; i++) {
  id++;
  const proc = {
    id: `ocds-demo-${String(id).padStart(6, '0')}`,
    ocid: `ocds-demo-${String(id).padStart(6, '0')}`,
    title: 'Adquisición de suministros de oficina',
    description: `Adquisición de suministros de oficina - Lote ${i + 1}`,
    status: 'complete',
    procurement_method: 'limited',
    procurement_method_details: 'Ínfima Cuantía',
    buyer_id: 'GAD-170150',
    buyer_name: 'GAD Municipal del Distrito Metropolitano de Quito',
    budget_amount: 9_800 + i * 20,
    budget_currency: 'USD',
    award_amount: 9_750 + i * 25,
    contract_amount: 9_750 + i * 25,
    final_amount: null,
    published_date: `2024-${String(3 + i).padStart(2, '0')}-15`,
    submission_deadline: `2024-${String(3 + i).padStart(2, '0')}-16`,
    award_date: `2024-${String(3 + i).padStart(2, '0')}-17`,
    contract_date: `2024-${String(3 + i).padStart(2, '0')}-20`,
    suppliers: [{ id: 'RUC-1791234573001', name: 'EMPRESA FANTASMA MULTISERVICIO S.A.' }],
    number_of_tenderers: 1,
    items_classification: '46',
    has_amendments: false,
    amendment_count: 0,
    source_year: 2024,
    regime: 'LOSNCP_COEFICIENTES',
  };
  const { flags, score, riskLevel } = evaluateAllFlags(proc);
  proc.flags = flags;
  proc.score = score;
  proc.risk_level = riskLevel;
  procedures.push(proc);
}

// Pattern 2: Large contract with huge amendment
id++;
const bigProc = {
  id: `ocds-demo-${String(id).padStart(6, '0')}`,
  ocid: `ocds-demo-${String(id).padStart(6, '0')}`,
  title: 'Construcción de hospital tipo B — Provincia del Guayas',
  description: 'Construcción de hospital tipo B con equipamiento completo',
  status: 'complete',
  procurement_method: 'open',
  procurement_method_details: 'Licitación',
  buyer_id: 'MSP-001',
  buyer_name: 'Ministerio de Salud Pública',
  budget_amount: 4_500_000,
  budget_currency: 'USD',
  award_amount: 4_200_000,
  contract_amount: 5_800_000,
  final_amount: 5_800_000,
  published_date: '2023-03-01',
  submission_deadline: '2023-03-05',
  award_date: '2023-03-08',
  contract_date: '2023-04-01',
  suppliers: [{ id: 'RUC-1791234571001', name: 'INFRAESTRUCTURA NACIONAL S.A.' }],
  number_of_tenderers: 1,
  items_classification: '53',
  has_amendments: true,
  amendment_count: 3,
  source_year: 2023,
  regime: 'LOSNCP_COEFICIENTES',
};
const bigResult = evaluateAllFlags(bigProc);
bigProc.flags = bigResult.flags;
bigProc.score = bigResult.score;
bigProc.risk_level = bigResult.riskLevel;
procedures.push(bigProc);

// ── Insert all ──────────────────────────────────────────────
console.log(`Inserting ${procedures.length} procedures...`);
for (const proc of procedures) {
  upsertProcedure(proc);
}

console.log('Building concentration index...');
rebuildConcentrationIndex();

console.log(`\n✓ Seed complete: ${procedures.length} procedures inserted`);
console.log('  Run: npm run dev');
