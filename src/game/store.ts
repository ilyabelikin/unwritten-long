import { create } from 'zustand'
import { generateWorld } from '../core/worldgen/generateWorld'
import type { World } from '../core/types'
import { advanceWorldTurn, moveCharacter, playerAttackOnTile, playerRob } from '../core/sim/turn'
import { loadFromLocalStorage, saveToLocalStorage } from './persistence'

interface GameState {
  world: World
  actionFeed: string[]
  lastSavedAt?: number
  regenerate: (seed?: number) => void
  selectTile: (tileId: string) => void
  clickTile: (tileId: string) => void
  clickCharacter: (characterId: string) => void
  confirmRobbery: (confirm: boolean) => void
  forceEndTurn: () => void
  saveGame: () => void
  loadGame: () => void
}

const resolvePostActionTurn = (world: World, messages: string[]): string[] => {
  const player = world.characters[world.playerId]
  if (player && player.ap <= 0) {
    messages.push('You are out of AP. The world takes its turn.')
    messages.push(...advanceWorldTurn(world, messages.length))
  }
  return messages
}

const bootState = (): { world: World; lastSavedAt?: number } => {
  const loaded = loadFromLocalStorage()
  if (loaded.world) {
    return { world: loaded.world, lastSavedAt: loaded.timestamp }
  }
  const world = generateWorld(9245)
  return { world }
}

const commitWorld = (world: World): { world: World; lastSavedAt?: number } => {
  const lastSavedAt = saveToLocalStorage(world)
  return { world, lastSavedAt }
}

export const useGameStore = create<GameState>((set, get) => ({
  ...bootState(),
  actionFeed: [],

  regenerate: (seed) => {
    const world = generateWorld(seed ?? Date.now() % 999999)
    set({ ...commitWorld(world), actionFeed: ['A fresh world has been generated.'] })
  },

  selectTile: (tileId) => {
    set((state) => ({
      world: {
        ...state.world,
        selectedTileId: tileId,
        selectedCharacterId: undefined,
      },
    }))
  },

  clickTile: (tileId) => {
    const world = structuredClone(get().world)
    world.selectedTileId = tileId
    world.selectedCharacterId = undefined
    const player = world.characters[world.playerId]
    const messages: string[] = []
    if (player && player.location !== tileId) {
      const result = moveCharacter(world, player.id, tileId)
      messages.push(result)
      resolvePostActionTurn(world, messages)
    }
    set({ ...commitWorld(world), actionFeed: messages.length > 0 ? messages : get().actionFeed })
  },

  clickCharacter: (characterId) => {
    const world = structuredClone(get().world)
    const target = world.characters[characterId]
    if (!target) return
    world.selectedCharacterId = characterId
    world.selectedTileId = target.location

    const player = world.characters[world.playerId]
    const messages: string[] = []
    if (player.location === target.location) {
      if (target.role === 'trader') {
        messages.push(...playerRob(world, target.id, false))
      } else if (target.id !== world.playerId) {
        messages.push(...playerAttackOnTile(world, target.id))
      }
      resolvePostActionTurn(world, messages)
    }
    set({ ...commitWorld(world), actionFeed: messages.length > 0 ? messages : get().actionFeed })
  },

  confirmRobbery: (confirm) => {
    const world = structuredClone(get().world)
    const pending = world.pendingRobberyCharacterId
    const messages: string[] = []
    if (pending) {
      messages.push(...playerRob(world, pending, confirm))
      if (!confirm) world.pendingRobberyCharacterId = undefined
      resolvePostActionTurn(world, messages)
    }
    set({ ...commitWorld(world), actionFeed: messages.length > 0 ? messages : get().actionFeed })
  },

  forceEndTurn: () => {
    const world = structuredClone(get().world)
    const player = world.characters[world.playerId]
    if (player) player.ap = 0
    const messages = resolvePostActionTurn(world, ['You ended your turn.'])
    set({ ...commitWorld(world), actionFeed: messages })
  },

  saveGame: () => {
    const world = structuredClone(get().world)
    const savedAt = saveToLocalStorage(world)
    set({
      world,
      lastSavedAt: savedAt ?? get().lastSavedAt,
      actionFeed: ['Game saved.', ...get().actionFeed].slice(0, 20),
    })
  },

  loadGame: () => {
    const loaded = loadFromLocalStorage()
    if (!loaded.world) {
      set({ actionFeed: ['No saved game found.', ...get().actionFeed].slice(0, 20) })
      return
    }
    set({
      world: loaded.world,
      lastSavedAt: loaded.timestamp,
      actionFeed: ['Saved game loaded.', ...get().actionFeed].slice(0, 20),
    })
  },
}))

