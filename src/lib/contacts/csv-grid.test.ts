import { describe, expect, it } from 'vitest'
import { parseCsvGrid } from './csv-grid'

describe('parseCsvGrid', () => {
  it('reads quoted commas, doubled quotes and line breaks inside quotes', () => {
    const g = parseCsvGrid('phone,notes\n+1555,"likes yoga, ""boxing""\nand spin"\n+1556,plain')
    expect(g.headers).toEqual(['phone', 'notes'])
    expect(g.rows).toEqual([
      ['+1555', 'likes yoga, "boxing"\nand spin'],
      ['+1556', 'plain'],
    ])
  })
  it('handles BOM, CRLF, blank lines and short rows', () => {
    const g = parseCsvGrid('﻿phone,name,email\r\n+1,A\r\n\r\n+2,B,b@x.com\r\n')
    expect(g.headers).toEqual(['phone', 'name', 'email'])
    expect(g.rows).toEqual([
      ['+1', 'A', ''],
      ['+2', 'B', 'b@x.com'],
    ])
  })
  it('detects semicolon and tab delimiters', () => {
    expect(parseCsvGrid('phone;name\n+1;A').rows).toEqual([['+1', 'A']])
    expect(parseCsvGrid('phone\tname\n+1\tA').rows).toEqual([['+1', 'A']])
  })
  it('returns nothing for empty input', () => {
    expect(parseCsvGrid('')).toEqual({ headers: [], rows: [] })
  })
})
