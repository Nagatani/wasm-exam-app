function escapeCsvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

export function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n');
}

// Excel on Windows/macOS misdetects plain UTF-8 CSVs as the system's legacy
// encoding without a BOM, garbling Japanese text — prepend it for any CSV a
// teacher is likely to open directly in Excel.
export const UTF8_BOM = '﻿';
