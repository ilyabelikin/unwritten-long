import { SeededRng } from '../random'
import type { Character, Species, World } from '../types'
import { performAttack } from './combat'

const preySpecies: Species[] = ['rabbit', 'deer', 'boar']
const predatorSpecies: Species[] = ['wolf', 'bear']

const isPrey = (character: Character): boolean => preySpecies.includes(character.species)
const isPredator = (character: Character): boolean =>
  character.role === 'wildlife' && predatorSpecies.includes(character.species)

const createWildlife = (id: string, species: Species, location: string, rng: SeededRng): Character => ({
  id,
  name: species,
  role: 'wildlife',
  species,
  hp: species === 'bear' ? 14 : species === 'wolf' ? 8 : species === 'deer' ? 6 : 4,
  maxHp: species === 'bear' ? 14 : species === 'wolf' ? 8 : species === 'deer' ? 6 : 4,
  ap: 4,
  maxAp: 4,
  age: rng.int(1, 12),
  skills: {
    combat: species === 'bear' ? 6 : species === 'wolf' ? 5 : 1,
    roaming: 4,
  },
  history: [`Spawned in ${location}.`],
  traits: [species === 'bear' || species === 'wolf' ? 'aggressive' : 'skittish'],
  flaws: [species === 'rabbit' ? 'fragile' : 'impulsive'],
  reputation: -20,
  location,
  alive: true,
  inventory: {},
  meta: {},
})

export const simulateWildlifeEcology = (world: World, rng: SeededRng): string[] => {
  const messages: string[] = []
  const wildlife = Object.values(world.characters).filter((char) => char.alive && char.role === 'wildlife')
  const byTile = new Map<string, Character[]>()
  for (const creature of wildlife) {
    if (!byTile.has(creature.location)) byTile.set(creature.location, [])
    byTile.get(creature.location)!.push(creature)
  }

  for (const residents of byTile.values()) {
    const predators = residents.filter(isPredator)
    const prey = residents.filter(isPrey)
    if (predators.length === 0 || prey.length === 0) continue
    for (const predator of predators) {
      const target = prey.find((candidate) => candidate.alive)
      if (!target) continue
      messages.push(...performAttack(world, predator.id, target.id, rng))
    }
  }

  if (world.season === 'spring' && world.seasonTurn % 12 === 0) {
    const deepForestTiles = world.tileOrder.filter((id) => world.tiles[id].vegetation === 'deep_forest')
    const spawnCount = Math.min(10, Math.max(2, Math.floor(deepForestTiles.length * 0.015)))
    for (let i = 0; i < spawnCount; i += 1) {
      const tile = deepForestTiles[rng.int(0, deepForestTiles.length - 1)]
      const species: Species = rng.chance(0.68) ? 'rabbit' : 'deer'
      const id = `wildlife-spawn-${world.turn}-${i}-${rng.int(100, 999)}`
      world.characters[id] = createWildlife(id, species, tile, rng)
    }
    messages.push('Spring brought new wildlife births in deep forests.')
  }

  if (world.season === 'winter' && world.seasonTurn % 10 === 0) {
    const atRisk = wildlife.filter((creature) => creature.species === 'rabbit' || creature.species === 'deer')
    for (const creature of atRisk) {
      if (rng.chance(0.1)) {
        creature.alive = false
      }
    }
    if (atRisk.length > 0) {
      messages.push('Winter scarcity thinned rabbit and deer populations.')
    }
  }

  return messages
}

