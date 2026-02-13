import { keyFor, neighborsOf } from '../hex'
import { SeededRng } from '../random'
import type { Character, Species, World } from '../types'

const wildlifeForTile = (rng: SeededRng): Species => {
  const roll = rng.next()
  if (roll < 0.38) return 'rabbit'
  if (roll < 0.63) return 'deer'
  if (roll < 0.8) return 'boar'
  if (roll < 0.94) return 'wolf'
  return 'bear'
}

const createSimpleCharacter = (
  id: string,
  role: Character['role'],
  species: Species,
  tileId: string,
  name: string,
): Character => ({
  id,
  name,
  role,
  species,
  hp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  maxHp: role === 'monster' ? 16 : role === 'wildlife' ? 8 : 10,
  ap: 4,
  maxAp: 4,
  age: 3,
  skills: { combat: role === 'monster' ? 6 : role === 'bandit' ? 4 : 2, travel: 3 },
  history: [`Appeared near ${tileId}.`],
  traits: [role === 'migrant' ? 'hopeful' : role === 'bandit' ? 'ruthless' : 'restless'],
  flaws: [role === 'migrant' ? 'weak' : 'reckless'],
  reputation: role === 'migrant' ? 2 : -30,
  location: tileId,
  alive: true,
  inventory: {},
  meta: {},
})

const randomLandTileBy = (
  world: World,
  predicate: (tileId: string) => boolean,
  rng: SeededRng,
): string | undefined => {
  const candidates = world.tileOrder.filter(
    (id) => world.tiles[id].terrain !== 'sea' && world.characters[world.playerId].location !== id && predicate(id),
  )
  if (candidates.length === 0) return undefined
  return candidates[rng.int(0, candidates.length - 1)]
}

export const spawnWorldEvents = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const spawn = (character: Character): void => {
    if (world.characters[character.id]) return
    world.characters[character.id] = character
  }

  const chanceScale = world.season === 'winter' ? 0.85 : 1

  if (rng.chance(0.17 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].road, rng)
    if (tileId) {
      const id = `bandit-${world.turn}-${rng.int(100, 999)}`
      const bandit = createSimpleCharacter(id, 'bandit', 'human', tileId, `Bandit ${rng.int(10, 99)}`)
      bandit.meta.hostile = true
      spawn(bandit)
      messages.push('Bandits were spotted on a major road.')
    }
  }

  if (rng.chance(0.14 * chanceScale)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].terrain === 'mountain', rng)
    if (tileId) {
      const id = `monster-${world.turn}-${rng.int(100, 999)}`
      const monster = createSimpleCharacter(
        id,
        'monster',
        rng.chance(0.65) ? 'ogre' : 'wyrm',
        tileId,
        rng.chance(0.65) ? 'Ogre' : 'Wyrm',
      )
      spawn(monster)
      messages.push('A roaming monster emerged from the highlands.')
    }
  }

  if (rng.chance(0.12)) {
    const tileId = randomLandTileBy(world, (id) => world.tiles[id].vegetation === 'deep_forest', rng)
    if (tileId) {
      const species = wildlifeForTile(rng)
      const id = `wild-${world.turn}-${rng.int(100, 999)}`
      spawn(createSimpleCharacter(id, 'wildlife', species, tileId, species))
      messages.push(`${species} were seen in the deep forests.`)
    }
  }

  if (rng.chance(0.11)) {
    const settlement = Object.values(world.settlements).sort((a, b) => a.populationIds.length - b.populationIds.length)[0]
    const target = Object.values(world.settlements).sort((a, b) => b.populationIds.length - a.populationIds.length)[0]
    if (settlement && target && settlement.id !== target.id) {
      const id = `migrant-${world.turn}-${rng.int(100, 999)}`
      const migrant = createSimpleCharacter(id, 'migrant', 'human', settlement.tiles[0], `Migrant ${rng.int(10, 99)}`)
      migrant.meta.targetSettlementId = target.id
      migrant.meta.pathProgress = 0
      spawn(migrant)
      messages.push(`Migrants left ${settlement.name} for ${target.name}.`)
    }
  }

  if (rng.chance(world.season === 'winter' ? 0.08 : 0.03)) {
    const city = Object.values(world.settlements).find((s) => s.tier === 'city')
    if (city) {
      const ring = city.tiles.flatMap((tileId) =>
        neighborsOf(world.tiles[tileId].coord).map((n) => keyFor(n.q, n.r)),
      )
      const candidates = ring.filter((id) => world.tiles[id] && world.tiles[id].terrain !== 'sea')
      const tileId = candidates[rng.int(0, Math.max(0, candidates.length - 1))]
      if (tileId) {
        const id = `raid-${world.turn}-${rng.int(100, 999)}`
        const monster = createSimpleCharacter(id, 'monster', 'ogre', tileId, 'Raider Ogre')
        spawn(monster)
        messages.push(`A raiding monster approaches ${city.name}.`)
      }
    }
  }

  return messages
}

