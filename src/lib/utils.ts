import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Parsea un número que puede tener coma o punto decimal (formato europeo vs americano)
 */
export function parseNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value;

  // Convertir a string y reemplazar coma por punto para parsear correctamente
  const stringValue = String(value).replace(',', '.');
  const parsed = parseFloat(stringValue);
  return isNaN(parsed) ? 0 : parsed;
}

export function formatCurrency(value: string | number | null | undefined): string {
  return new Intl.NumberFormat('es-AD', {
    style: 'currency',
    currency: 'EUR',
  }).format(parseNumber(value));
}
