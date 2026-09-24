import { describe, expect, it } from 'vitest'
import { changedOrders, moveItem } from './reorder'

describe('moveItem', () => {
  const items = ['a', 'b', 'c', 'd']

  it('moves an item down and up', () => {
    expect(moveItem(items, 0, 2)).toEqual(['b', 'c', 'a', 'd'])
    expect(moveItem(items, 3, 0)).toEqual(['d', 'a', 'b', 'c'])
  })

  it('does not mutate the input', () => {
    moveItem(items, 0, 3)
    expect(items).toEqual(['a', 'b', 'c', 'd'])
  })

  it('returns the same array for a no-op or out-of-range move', () => {
    expect(moveItem(items, 1, 1)).toBe(items)
    expect(moveItem(items, -1, 2)).toBe(items)
    expect(moveItem(items, 0, 4)).toBe(items)
    expect(moveItem(items, 9, 0)).toBe(items)
  })
})

describe('changedOrders', () => {
  const rows = (orders: number[]) => orders.map((order, i) => ({ id: `r${i}`, order }))

  it('reports only the rows whose position changed', () => {
    const moved = moveItem(rows([0, 1, 2, 3]), 3, 0) // r3 to the top
    expect(changedOrders(moved).map(({ item, order }) => [item.id, order])).toEqual([
      ['r3', 0],
      ['r0', 1],
      ['r1', 2],
      ['r2', 3],
    ])
  })

  it('skips untouched rows in the middle of a swap', () => {
    const moved = moveItem(rows([0, 1, 2, 3, 4]), 1, 2) // swap r1/r2
    expect(changedOrders(moved).map(({ item }) => item.id)).toEqual(['r2', 'r1'])
  })

  it('normalizes stale/non-contiguous order values', () => {
    expect(changedOrders(rows([0, 5, 9])).map(({ order }) => order)).toEqual([1, 2])
  })

  it('returns nothing when already in order', () => {
    expect(changedOrders(rows([0, 1, 2]))).toEqual([])
  })
})
