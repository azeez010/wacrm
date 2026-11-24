import { describe, expect, it } from 'vitest'

import { backgroundCss, logoImageClass, logoWrapperClass, overlayPercent } from './branding'

describe('form branding options', () => {
  it('defaults match the look forms had before the options existed', () => {
    expect(logoWrapperClass()).toBe('flex justify-start')
    expect(logoImageClass()).toContain('h-10')
    expect(backgroundCss()).toEqual({ backgroundSize: 'cover', backgroundRepeat: 'no-repeat', backgroundPosition: 'center' })
    expect(overlayPercent()).toBe(72)
  })

  it('aligns and sizes the logo', () => {
    expect(logoWrapperClass('center')).toBe('flex justify-center')
    expect(logoWrapperClass('right')).toBe('flex justify-end')
    expect(logoImageClass('small')).toContain('h-7')
    expect(logoImageClass('large')).toContain('h-16')
  })

  it('maps background fit and position to CSS', () => {
    expect(backgroundCss('contain', 'top')).toEqual({ backgroundSize: 'contain', backgroundRepeat: 'no-repeat', backgroundPosition: 'center top' })
    expect(backgroundCss('tile', 'center')).toEqual({ backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'center' })
  })

  it('maps the overlay strength', () => {
    expect(overlayPercent('none')).toBe(0)
    expect(overlayPercent('strong')).toBe(88)
  })
})
