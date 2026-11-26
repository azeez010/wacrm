import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  isDefaultLayout,
  moveWidget,
  parseLayout,
  setHidden,
  visibleWidgets,
} from './layout'

describe('parseLayout', () => {
  it('falls back to the default', () => {
    expect(parseLayout(null)).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{nope')).toEqual(DEFAULT_LAYOUT)
    expect(parseLayout('{"order":"x"}')).toEqual(DEFAULT_LAYOUT)
  })

  it('keeps a saved order, drops unknown/duplicate ids, appends new widgets', () => {
    const l = parseLayout(
      JSON.stringify({ order: ['team', 'team', 'ghost', 'kpis'], hidden: ['activity', 'ghost'] }),
    )
    expect(l.order.slice(0, 2)).toEqual(['team', 'kpis'])
    expect([...l.order].sort()).toEqual([...WIDGET_IDS].sort())
    expect(l.hidden).toEqual(['activity'])
  })
})

describe('moveWidget', () => {
  it('moves a card to the drop target', () => {
    const l = moveWidget(DEFAULT_LAYOUT, 'team', 'volume')
    expect(l.order.indexOf('team')).toBe(DEFAULT_LAYOUT.order.indexOf('volume'))
    expect(l.order).toHaveLength(WIDGET_IDS.length)
  })
  it('ignores a no-op', () => {
    expect(moveWidget(DEFAULT_LAYOUT, 'team', 'team')).toBe(DEFAULT_LAYOUT)
  })
})

describe('setHidden', () => {
  it('hides and shows a card in its old place', () => {
    const hidden = setHidden(DEFAULT_LAYOUT, 'campaigns', true)
    expect(visibleWidgets(hidden)).not.toContain('campaigns')
    const shown = setHidden(hidden, 'campaigns', false)
    expect(visibleWidgets(shown)).toEqual(DEFAULT_LAYOUT.order)
    expect(isDefaultLayout(shown)).toBe(true)
    expect(isDefaultLayout(hidden)).toBe(false)
  })
})
