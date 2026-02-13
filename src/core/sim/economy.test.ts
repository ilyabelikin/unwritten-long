import { describe, expect, it } from 'vitest'
import { generateWorld } from '../worldgen/generateWorld'
import { SeededRng } from '../random'
import { simulateEconomyTurn, estimateGoodPrice } from './economy'
import { keyFor, neighborsOf } from '../hex'

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

  it('advances crop stage across seasonal boundaries', () => {
    const world = generateWorld(9931)
    const settlement = Object.values(world.settlements)[0]

    world.season = 'spring'
    world.seasonTurn = 0
    simulateEconomyTurn(world, new SeededRng(1))
    expect(settlement.meta.cropStage).toBe('sown')

    world.season = 'summer'
    world.seasonTurn = 0
    simulateEconomyTurn(world, new SeededRng(2))
    expect(settlement.meta.cropStage).toBe('growing')

    world.season = 'autumn'
    world.seasonTurn = 0
    simulateEconomyTurn(world, new SeededRng(3))
    expect(settlement.meta.cropStage).toBe('ripe')

    world.season = 'winter'
    world.seasonTurn = 0
    simulateEconomyTurn(world, new SeededRng(4))
    expect(settlement.meta.cropStage).toBe('dormant')
  })

  it('does not construct fisher homes for inland settlements', () => {
    const world = generateWorld(1111)
    const inland = Object.values(world.settlements).find((settlement) =>
      settlement.tiles.every((tileId) => {
        const tile = world.tiles[tileId]
        if (tile.terrain === 'coast') return false
        return neighborsOf(tile.coord).every((neighbor) => {
          const near = world.tiles[keyFor(neighbor.q, neighbor.r)]
          return near?.terrain !== 'sea' && near?.terrain !== 'coast'
        })
      }),
    )
    expect(inland).toBeDefined()
    if (!inland) return

    inland.dream = 'Build fisher home for food security.'
    inland.treasury = 400
    inland.stockpile.wood = 300
    inland.stockpile.stone = 200
    const before = inland.buildings.filter((building) => building.type === 'fisher_home').length
    world.turn = 8
    simulateEconomyTurn(world, new SeededRng(9))
    const after = inland.buildings.filter((building) => building.type === 'fisher_home').length
    expect(after).toBe(before)
  })

  it('upgrades a prosperous settlement tier when thresholds are met', () => {
    const world = generateWorld(2222)
    const candidate = Object.values(world.settlements)
      .filter((settlement) => settlement.tier !== 'city')
      .sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    expect(candidate).toBeDefined()
    if (!candidate) return

    const nextTier = candidate.tier === 'hamlet' ? 'village' : candidate.tier === 'village' ? 'town' : 'city'
    const threshold = nextTier === 'village' ? 8 : nextTier === 'town' ? 14 : 30
    const sampleCitizen = world.characters[candidate.populationIds[0]]
    while (candidate.populationIds.length < threshold + 2) {
      const id = `test-citizen-${candidate.populationIds.length}`
      world.characters[id] = {
        ...sampleCitizen,
        id,
        name: `Test Citizen ${candidate.populationIds.length}`,
        role: 'villager',
        location: candidate.tiles[0],
        homeSettlementId: candidate.id,
        alive: true,
        hp: 10,
        ap: 4,
      }
      candidate.populationIds.push(id)
    }
    candidate.meta.prosperity = 99
    candidate.meta.foodStress = 0
    candidate.treasury = 900
    world.turn = 8
    simulateEconomyTurn(world, new SeededRng(44))
    expect(candidate.tier).toBe(nextTier)
  })

  it('raises key seasonal needs during winter', () => {
    const world = generateWorld(2233)
    const settlement = Object.values(world.settlements)[0]

    world.season = 'summer'
    world.seasonTurn = 10
    simulateEconomyTurn(world, new SeededRng(51))
    const summerGrainNeed = settlement.needs.grain
    const summerWoodNeed = settlement.needs.wood

    world.season = 'winter'
    world.seasonTurn = 10
    simulateEconomyTurn(world, new SeededRng(52))
    expect(settlement.needs.grain).toBeGreaterThanOrEqual(summerGrainNeed)
    expect(settlement.needs.wood).toBeGreaterThanOrEqual(summerWoodNeed)
  })
})

