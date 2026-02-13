import { describe, expect, it } from 'vitest'
import { SeededRng } from '../random'
import { generateWorld } from '../worldgen/generateWorld'
import { simulateSiegePressure } from './siege'

describe('siege pressure simulation', () => {
  it('increases pressure when hostiles gather near a city', () => {
    const world = generateWorld(9510)
    const city = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(city).toBeDefined()
    if (!city) return
    const tileId = city.tiles[0]
    city.meta.siegePressure = 0

    world.characters['siege-monster'] = {
      id: 'siege-monster',
      name: 'Siege Ogre',
      role: 'monster',
      species: 'ogre',
      hp: 16,
      maxHp: 16,
      ap: 4,
      maxAp: 4,
      age: 9,
      skills: { combat: 6 },
      history: [],
      traits: ['aggressive'],
      flaws: ['reckless'],
      reputation: -30,
      location: tileId,
      alive: true,
      inventory: {},
      meta: {},
    }

    simulateSiegePressure(world, new SeededRng(10))
    expect(city.meta.siegePressure).toBeGreaterThan(0)
  })

  it('naturally decays pressure when no hostiles remain', () => {
    const world = generateWorld(9511)
    const city = Object.values(world.settlements).find((settlement) => settlement.tier === 'city')
    expect(city).toBeDefined()
    if (!city) return
    city.meta.siegePressure = 24

    for (let i = 0; i < 4; i += 1) {
      simulateSiegePressure(world, new SeededRng(20 + i))
    }
    expect(city.meta.siegePressure).toBeLessThan(24)
  })

  it('peace dividends dampen raid pressure and local losses', () => {
    const withDividend = generateWorld(9512)
    const withoutDividend = generateWorld(9512)
    const cityA = Object.values(withDividend.settlements).find((settlement) => settlement.tier === 'city')
    const cityB = Object.values(withoutDividend.settlements).find((settlement) => settlement.tier === 'city')
    expect(cityA).toBeDefined()
    expect(cityB).toBeDefined()
    if (!cityA || !cityB) return

    const policyA = withDividend.kingdoms[cityA.kingdomId].policy
    const partner =
      Object.keys(withDividend.kingdoms).find((id) => id !== cityA.kingdomId) ?? cityA.kingdomId
    policyA.peaceDividendUntilTurn = withDividend.turn + 12
    policyA.peaceDividendPartnerKingdomId = partner
    policyA.peaceDividendIntensity = 35
    withoutDividend.kingdoms[cityB.kingdomId].policy.peaceDividendUntilTurn = -1
    withoutDividend.kingdoms[cityB.kingdomId].policy.peaceDividendPartnerKingdomId = 'none'
    withoutDividend.kingdoms[cityB.kingdomId].policy.peaceDividendIntensity = 0

    cityA.meta.siegePressure = 0
    cityB.meta.siegePressure = 0
    cityA.stockpile.grain = 20
    cityB.stockpile.grain = 20

    const makeHostile = (worldId: 'a' | 'b') => ({
      id: `siege-warband-${worldId}`,
      name: 'Warband',
      role: 'bandit' as const,
      species: 'human' as const,
      hp: 10,
      maxHp: 10,
      ap: 4,
      maxAp: 4,
      age: 30,
      skills: { combat: 6 },
      history: [],
      traits: ['ruthless'],
      flaws: ['reckless'],
      reputation: -30,
      location: cityA.tiles[0],
      alive: true,
      inventory: {},
      meta: { warPair: 'k1|k2' },
    })
    withDividend.characters['siege-warband-a'] = makeHostile('a')
    withoutDividend.characters['siege-warband-b'] = {
      ...makeHostile('b'),
      location: cityB.tiles[0],
    }

    simulateSiegePressure(withDividend, new SeededRng(30))
    simulateSiegePressure(withoutDividend, new SeededRng(30))
    expect(cityA.meta.siegePressure).toBeLessThan(cityB.meta.siegePressure)
    expect(cityA.stockpile.grain).toBeGreaterThanOrEqual(cityB.stockpile.grain)
  })
})

