import { estimateGoodPrice } from '../core/sim/economy'
import { SPECIES_LABEL } from '../core/data/content'
import type { Good, World } from '../core/types'
import './Hud.css'

interface HudProps {
  world: World
  actionFeed: string[]
  lastSavedAt?: number
  onNewWorld: () => void
  onEndTurn: () => void
  onSaveGame: () => void
  onLoadGame: () => void
  onConfirmRobbery: (confirm: boolean) => void
}

const showGoods = (goods: Record<Good, number>): string =>
  (Object.entries(goods) as [Good, number][])
    .filter(([, amount]) => amount > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([good, amount]) => `${good}: ${Math.round(amount * 10) / 10}`)
    .join(' · ')

export const Hud = ({
  world,
  actionFeed,
  lastSavedAt,
  onNewWorld,
  onEndTurn,
  onSaveGame,
  onLoadGame,
  onConfirmRobbery,
}: HudProps) => {
  const player = world.characters[world.playerId]
  const selectedTile = world.selectedTileId ? world.tiles[world.selectedTileId] : undefined
  const selectedCharacter = world.selectedCharacterId ? world.characters[world.selectedCharacterId] : undefined
  const selectedSettlement = selectedTile?.settlementId ? world.settlements[selectedTile.settlementId] : undefined

  return (
    <aside className="hud">
      <h1>Frontier Realms</h1>
      <section className="panel compact">
        <strong>Turn {world.turn}</strong>
        <span>
          Season: {world.season} ({world.seasonTurn}/60)
        </span>
        <span>
          HP {player.hp}/{player.maxHp} · AP {player.ap}/{player.maxAp} · Reputation {player.reputation}
        </span>
        <span>Save: {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : 'not saved yet'}</span>
        <div className="button-row">
          <button onClick={onEndTurn}>End Turn</button>
          <button onClick={onNewWorld}>New World</button>
          <button onClick={onSaveGame}>Save</button>
          <button onClick={onLoadGame}>Load</button>
        </div>
      </section>

      {world.pendingRobberyCharacterId && (
        <section className="panel warning">
          <strong>Confirm robbery?</strong>
          <p>Robbing while your reputation is decent will make cities hostile.</p>
          <div className="button-row">
            <button onClick={() => onConfirmRobbery(true)}>Yes, rob</button>
            <button onClick={() => onConfirmRobbery(false)}>Cancel</button>
          </div>
        </section>
      )}

      <section className="panel">
        <h2>Selected Tile</h2>
        {selectedTile ? (
          <>
            <p>
              {selectedTile.id} · {selectedTile.terrain} · elevation {selectedTile.elevation}
            </p>
            <p>Vegetation: {selectedTile.vegetation}</p>
            <p>Resources: {selectedTile.resources.length ? selectedTile.resources.join(', ') : 'none'}</p>
            {selectedSettlement && (
              <div className="subpanel">
                <h3>
                  {selectedSettlement.name} ({selectedSettlement.tier})
                </h3>
                <p>
                  Pop: {selectedSettlement.populationIds.length} · Treasury: {Math.round(selectedSettlement.treasury)}
                </p>
                <p>
                  Crop cycle: {selectedSettlement.meta.cropStage} · Food stress:{' '}
                  {selectedSettlement.meta.foodStress.toFixed(1)} · Prosperity:{' '}
                  {selectedSettlement.meta.prosperity.toFixed(1)}
                </p>
                <p>Dream: {selectedSettlement.dream}</p>
                <p>Stock: {showGoods(selectedSettlement.stockpile)}</p>
                <p>Needs: {showGoods(selectedSettlement.needs)}</p>
                <p>
                  Prices:{' '}
                  {(['grain', 'fish', 'wood', 'iron_ingot', 'tools'] as Good[])
                    .map(
                      (good) =>
                        `${good} ${estimateGoodPrice(selectedSettlement, good, world.season).toFixed(1)}`,
                    )
                    .join(' · ')}
                </p>
                <p>
                  Buildings:{' '}
                  {selectedSettlement.buildings
                    .map((building) => `${building.type} L${building.level}`)
                    .join(', ')}
                </p>
              </div>
            )}
          </>
        ) : (
          <p>Click any hex to inspect it.</p>
        )}
      </section>

      <section className="panel">
        <h2>Selected Character</h2>
        {selectedCharacter ? (
          <>
            <p>
              {selectedCharacter.name} · {selectedCharacter.role} ·{' '}
              {SPECIES_LABEL[selectedCharacter.species] ?? selectedCharacter.species}
            </p>
            <p>
              HP {selectedCharacter.hp}/{selectedCharacter.maxHp} · AP {selectedCharacter.ap}/{selectedCharacter.maxAp}
            </p>
            <p>
              Traits: {selectedCharacter.traits.join(', ')} · Flaws: {selectedCharacter.flaws.join(', ')}
            </p>
            <p>History: {selectedCharacter.history[selectedCharacter.history.length - 1]}</p>
          </>
        ) : (
          <p>Click a unit icon on the map to inspect or interact.</p>
        )}
      </section>

      <section className="panel log">
        <h2>Action Feed</h2>
        <ul>
          {[...actionFeed, ...world.messages].slice(0, 16).map((line, idx) => (
            <li key={`${line}-${idx}`}>{line}</li>
          ))}
        </ul>
      </section>
    </aside>
  )
}

