// ============================================================
// A small, correct CSV reader for the import: quoted cells may contain
// commas, quotes ("") and line breaks; a UTF-8 BOM and CRLF are handled;
// the delimiter (comma, semicolon or tab) is detected from the header line.
// ============================================================

export interface CsvGrid {
  headers: string[]
  rows: string[][]
}

function detectDelimiter(firstLine: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && ch in counts) counts[ch]++
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ','
}

export function parseCsvGrid(input: string): CsvGrid {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const delimiter = detectDelimiter(firstLine)

  const records: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  const endCell = () => {
    row.push(cell)
    cell = ''
  }
  const endRow = () => {
    endCell()
    records.push(row)
    row = []
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        cell += ch
      }
    } else if (ch === '"' && cell === '') {
      inQuotes = true
    } else if (ch === delimiter) {
      endCell()
    } else if (ch === '\n') {
      endRow()
    } else if (ch === '\r') {
      if (text[i + 1] === '\n') i++
      endRow()
    } else {
      cell += ch
    }
  }
  if (cell !== '' || row.length > 0) endRow()

  const clean = records
    .map((r) => r.map((c) => c.trim()))
    .filter((r) => r.some((c) => c !== ''))
  if (clean.length === 0) return { headers: [], rows: [] }
  const headers = clean[0]
  const width = headers.length
  const rows = clean.slice(1).map((r) => {
    const padded = r.slice(0, width)
    while (padded.length < width) padded.push('')
    return padded
  })
  return { headers, rows }
}
