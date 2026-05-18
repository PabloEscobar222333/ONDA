const PREFIXES = new Set([
  '24', '54', '55', '59',
  '20', '50',
  '26', '27', '56', '57',
]);

const FULL_PATTERN = /^\+233\d{9}$/;

export function isValidGhanaPhone(input: string): boolean {
  if (!FULL_PATTERN.test(input)) return false;
  const prefix = input.slice(4, 6);
  return PREFIXES.has(prefix);
}

export function normalizeGhanaPhone(input: string): string | null {
  const cleaned = input.replace(/\s+/g, '');
  if (isValidGhanaPhone(cleaned)) return cleaned;
  const local = cleaned.replace(/^(\+233|233|0)/, '');
  if (!/^\d{9}$/.test(local)) return null;
  const prefix = local.slice(0, 2);
  if (!PREFIXES.has(prefix)) return null;
  return `+233${local}`;
}

export function carrierFromPhone(phone: string): 'MTN' | 'Telecel' | 'AirtelTigo' | null {
  if (!isValidGhanaPhone(phone)) return null;
  const prefix = phone.slice(4, 6);
  if (['24', '54', '55', '59'].includes(prefix)) return 'MTN';
  if (['20', '50'].includes(prefix)) return 'Telecel';
  if (['26', '27', '56', '57'].includes(prefix)) return 'AirtelTigo';
  return null;
}
