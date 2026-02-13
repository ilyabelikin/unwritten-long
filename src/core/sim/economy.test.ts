import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { simulateEconomyTurn, estimateGoodPrice } from './economy'

describe('economy simulation', () => {
  it('updates settlement dreams and stockpiles over a turn', () => {
    const world = generateWorld(11337)
    const firstSettlement = Object.values(world.settlements)[0]
    const before = firstSettlement.stockpile.grain + firstSettlement.stockpile.vegetables
    const messages = simulateEconomyTurn(world, new SeededRng(99))
    const after = firstSettlement.stockpile.grain + firstSettlement.stockpile.vegetables
    expect(firstSettlement.dream.length).toBeGreaterThan(4)
    expect(messages.length).toBeGreaterThanOrEqual(0)
    expect(after).not.toBe(before)
  })

  it('prices rise under scarcity and fall with surplus', () => {
    const world = generateWorld(5566)
    const settlement = Object.values(world.settlements)[0]
    settlement.stockpile.grain = 1
    settlement.needs.grain = 15
    const scarce = estimateGoodPrice(settlement, 'grain', world.season)
    settlement.stockpile.grain = 35
    settlement.needs.grain = 8
    const abundant = estimateGoodPrice(settlement, 'grain', world.season)
    expect(scarce).toBeGreaterThan(abundant)
  })
})

