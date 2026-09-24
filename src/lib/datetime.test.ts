import { describe, expect, it } from 'vitest'
import { datetimeLocalToIso, toDatetimeLocalValue } from './datetime'

describe('datetime-local helpers', () => {
  it('round-trips through the local time zone', () => {
    const iso = new Date(2026, 8, 25, 9, 5).toISOString()
    const local = toDatetimeLocalValue(iso)
    expect(local).toBe('2026-09-25T09:05')
    expect(datetimeLocalToIso(local)).toBe(iso)
  })

  it('empty / invalid values map to "" / null', () => {
    expect(toDatetimeLocalValue(null)).toBe('')
    expect(toDatetimeLocalValue(undefined)).toBe('')
    expect(toDatetimeLocalValue('not a date')).toBe('')
    expect(datetimeLocalToIso('')).toBeNull()
    expect(datetimeLocalToIso('garbage')).toBeNull()
  })
})
