import { estimateGoodPrice } from '../core/sim/economy'
import { campaignRankInfo, campaignRankTitleForReputation } from '../core/sim/campaignRank'
import { SPECIES_LABEL } from '../core/data/content'
import { relationBetween } from '../core/sim/diplomacy'
import { edictLabel } from '../core/sim/edicts'
import { favorRankTitle } from '../core/sim/favor'
import type { Contract } from '../core/types'
import type { Good, World } from '../core/types'
import type { MapOverlayMode } from '../game/store'
import './Hud.css'

interface HudProps {
  world: World
  actionFeed: string[]
  lastSavedAt?: number
  mapOverlay: MapOverlayMode
  onNewWorld: () => void
  onEndTurn: () => void
  onSetMapOverlay: (overlay: MapOverlayMode) => void
  onDonateSupplies: () => void
  onSponsorTreaty: () => void
  onRequestPardon: () => void
  onRallyMilitia: () => void
  onAcceptContract: (contractId: string) => void
  onProgressContract: () => void
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

const showInventory = (inventory: Partial<Record<Good, number>>): string =>
  (Object.entries(inventory) as [Good, number][])
    .filter(([, amount]) => (amount ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 8)
    .map(([good, amount]) => `${good} ${Math.round((amount ?? 0) * 10) / 10}`)
    .join(' · ')

const showExclusivePool = (value: unknown): string => {
  if (value === 'harvest') return 'Harvest Court'
  if (value === 'warden') return 'Warden Hall'
  if (value === 'guild') return 'Guild Ledger'
  return 'Special pool'
}

export const Hud = ({
  world,
  actionFeed,
  lastSavedAt,
  mapOverlay,
  onNewWorld,
  onEndTurn,
  onSetMapOverlay,
  onDonateSupplies,
  onSponsorTreaty,
  onRequestPardon,
  onRallyMilitia,
  onAcceptContract,
  onProgressContract,
  onSaveGame,
  onLoadGame,
  onConfirmRobbery,
}: HudProps) => {
  const player = world.characters[world.playerId]
  const selectedTile = world.selectedTileId ? world.tiles[world.selectedTileId] : undefined
  const selectedCharacter = world.selectedCharacterId ? world.characters[world.selectedCharacterId] : undefined
  const selectedSettlement = selectedTile?.settlementId ? world.settlements[selectedTile.settlementId] : undefined
  const playerSettlement =
    world.tiles[player.location]?.settlementId ? world.settlements[world.tiles[player.location].settlementId!] : undefined
  const canUseCivicActions = Boolean(playerSettlement)
  const activeContract = Object.values(world.contracts).find(
    (contract) => contract.status === 'active' && contract.assignedCharacterId === world.playerId,
  )
  const availableContracts: Contract[] = playerSettlement
    ? Object.values(world.contracts)
        .filter((contract) => contract.status === 'available' && contract.settlementId === playerSettlement.id)
        .slice(0, 3)
    : []
  const kingdomIds = Object.keys(world.kingdoms)
  const activeConflicts = Object.keys(world.kingdomConflicts).filter((key) => world.kingdomConflicts[key])
  const playerCampaignRank = campaignRankInfo(player.reputation)
  const manhuntKingdomId =
    typeof player.meta.manhuntKingdomId === 'string' ? player.meta.manhuntKingdomId : undefined
  const manhuntExpiresTurn = Number(player.meta.manhuntExpiresTurn ?? -1)
  const manhuntActive =
    manhuntKingdomId && manhuntExpiresTurn >= world.turn ? world.kingdoms[manhuntKingdomId] : undefined

  return (
    <aside className="hud">
      <h1>Frontier Realms</h1>
      <section className="panel compact">
        <strong>Turn {world.turn}</strong>
        <span>
          Season: {world.season} ({world.seasonTurn}/60)
        </span>
        <span>
          HP {player.hp}/{player.maxHp} · AP {player.ap}/{player.maxAp} · Reputation {player.reputation} · Bounty{' '}
          {Number(player.meta.bounty ?? 0)}
        </span>
        <span>Campaign rank: {playerCampaignRank.title}</span>
        <span>
          Local favor:{' '}
          {playerSettlement
            ? `${world.playerKingdomFavor[playerSettlement.kingdomId] ?? 0} (${favorRankTitle(
                world.playerKingdomFavor[playerSettlement.kingdomId] ?? 0,
              )})`
            : 'n/a'}
        </span>
        {manhuntActive && <span>Law alert: {manhuntActive.name} manhunt active until turn {manhuntExpiresTurn}</span>}
        <span>Save: {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString() : 'not saved yet'}</span>
        <div className="button-row">
          <button onClick={onEndTurn}>End Turn</button>
          <button onClick={onNewWorld}>New World</button>
          <button onClick={onSaveGame}>Save</button>
          <button onClick={onLoadGame}>Load</button>
        </div>
        <div className="overlay-row">
          <label htmlFor="overlay-mode">Overlay</label>
          <select
            id="overlay-mode"
            value={mapOverlay}
            onChange={(event) => onSetMapOverlay(event.target.value as MapOverlayMode)}
          >
            <option value="terrain">Terrain</option>
            <option value="kingdom">Kingdoms</option>
            <option value="economy">Economy</option>
            <option value="danger">Danger</option>
          </select>
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
        <h2>Civic Actions</h2>
        {canUseCivicActions ? (
          <>
            <p>You are in {playerSettlement?.name}. Support locals or influence diplomacy.</p>
            <div className="button-row">
              <button onClick={onDonateSupplies}>Donate Supplies (1 AP)</button>
              <button onClick={onSponsorTreaty}>Sponsor Treaty (2 AP)</button>
              <button onClick={onRequestPardon}>Request Pardon (1 AP)</button>
              <button onClick={onRallyMilitia}>Rally Militia (2 AP)</button>
            </div>
          </>
        ) : (
          <p>Move into a settlement to donate supplies or sponsor talks.</p>
        )}
      </section>

      <section className="panel">
        <h2>Inventory</h2>
        <p>{showInventory(player.inventory) || 'Inventory is empty.'}</p>
        {activeContract?.kind === 'deliver_food' && (
          <p>
            Contract target: deliver {activeContract.requiredAmount} {activeContract.good}. Progress{' '}
            {activeContract.progress}/{activeContract.requiredAmount}
          </p>
        )}
        {activeContract?.kind === 'defend_settlement' && (
          <p>
            Contract target: defeat hostile forces {activeContract.progress}/{activeContract.requiredAmount}.
          </p>
        )}
        {activeContract?.kind === 'escort_caravan' && (
          <p>
            Contract target: escort caravan. Contact{' '}
            {activeContract.meta.playerMetCaravan ? 'made' : 'pending'} · Delivery{' '}
            {activeContract.meta.caravanDelivered ? 'complete' : 'pending'}.
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Contract Board</h2>
        {playerSettlement ? (
          <>
            <p>Issuer: {playerSettlement.name}</p>
            {activeContract ? (
              <div className="subpanel">
                <p>
                  Active: {activeContract.kind} (T{activeContract.level}) · {activeContract.progress}/
                  {activeContract.requiredAmount}
                </p>
                {typeof activeContract.meta.campaignChainId === 'string' && (
                  <p>
                    Campaign chain stage {Number(activeContract.meta.campaignStage)}/
                    {Number(activeContract.meta.campaignTotalStages)}
                  </p>
                )}
                {activeContract.meta.campaign === true && <p>Royal priority contract</p>}
                {activeContract.meta.exclusive === true && (
                  <p>
                    Exclusive: {showExclusivePool(activeContract.meta.exclusivePool)} ·{' '}
                    {String(activeContract.meta.exclusiveTitle ?? 'Special commission')}
                  </p>
                )}
                {activeContract.kind === 'escort_caravan' && (
                  <p>
                    Escort status: {activeContract.meta.playerMetCaravan ? 'contact made' : 'find caravan'} ·{' '}
                    {activeContract.meta.caravanDelivered ? 'delivered' : 'in transit'}
                  </p>
                )}
                <p>
                  Reward: +{activeContract.rewardReputation} rep · -{activeContract.rewardBountyReduction} bounty
                </p>
                <button onClick={onProgressContract}>Report / Deliver Contract Progress</button>
              </div>
            ) : availableContracts.length > 0 ? (
              <div className="contract-list">
                {availableContracts.map((contract) => (
                  (() => {
                    const minReputation = Number(contract.meta.minReputation ?? 0)
                    const reputationLocked = minReputation > 0 && player.reputation < minReputation
                    return (
                      <div key={contract.id} className="contract-card">
                        <p>
                          {contract.kind === 'deliver_food'
                            ? `Deliver ${contract.requiredAmount} ${contract.good}`
                            : contract.kind === 'hunt_bandits'
                              ? `Hunt ${contract.requiredAmount} bandit group`
                              : contract.kind === 'escort_caravan'
                                ? `Escort caravan carrying ${contract.requiredAmount} ${contract.good}`
                                : `Defend settlement from ${contract.requiredAmount} hostile groups`}
                        </p>
                        <p>Tier: {contract.level}</p>
                        {contract.meta.exclusive === true && (
                          <p>
                            Exclusive: {showExclusivePool(contract.meta.exclusivePool)} ·{' '}
                            {String(contract.meta.exclusiveTitle ?? 'Special commission')} · Min favor{' '}
                            {Number(contract.meta.minFavor ?? 0)}
                          </p>
                        )}
                        {minReputation > 0 && (
                          <p>
                            Requires rank: {campaignRankTitleForReputation(minReputation)} ({minReputation} rep)
                          </p>
                        )}
                        {typeof contract.meta.campaignChainId === 'string' && (
                          <p>
                            Stage {Number(contract.meta.campaignStage)}/{Number(contract.meta.campaignTotalStages)}
                          </p>
                        )}
                        {contract.meta.campaign === true && <p>Royal objective</p>}
                        <p>
                          Reward: +{contract.rewardReputation} rep · {Object.entries(contract.rewardGoods)
                            .map(([good, qty]) => `${qty} ${good}`)
                            .join(', ') || 'civic favor'}
                        </p>
                        <button
                          onClick={() => onAcceptContract(contract.id)}
                          disabled={contract.meta.locked === true || reputationLocked}
                        >
                          {contract.meta.locked === true
                            ? 'Locked Stage'
                            : reputationLocked
                              ? 'Need Higher Rank'
                              : 'Accept Contract'}
                        </button>
                      </div>
                    )
                  })()
                ))}
              </div>
            ) : (
              <p>No open contracts here this turn.</p>
            )}
          </>
        ) : (
          <p>Move into a settlement to view local contracts.</p>
        )}
      </section>

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
                  {selectedSettlement.meta.prosperity.toFixed(1)} · Siege:{' '}
                  {selectedSettlement.meta.siegePressure.toFixed(1)}
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
                  Diplomacy:{' '}
                  {Object.values(world.kingdoms)
                    .filter((kingdom) => kingdom.id !== selectedSettlement.kingdomId)
                    .map((kingdom) => {
                      const relation = relationBetween(world, selectedSettlement.kingdomId, kingdom.id)
                      const mood = relation >= 35 ? 'friendly' : relation <= -25 ? 'hostile' : 'neutral'
                      return `${kingdom.name} ${relation} (${mood})`
                    })
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

      <section className="panel">
        <h2>Kingdom Diplomacy</h2>
        <p>
          Active conflicts:{' '}
          {activeConflicts.length > 0
            ? activeConflicts
                .map((pair) => pair.split('|'))
                .map(([a, b]) => `${world.kingdoms[a]?.name ?? a} vs ${world.kingdoms[b]?.name ?? b}`)
                .join(' · ')
            : 'none'}
        </p>
        {kingdomIds.length > 1 ? (
          <ul className="compact-list">
            {kingdomIds.flatMap((left, idx) =>
              kingdomIds.slice(idx + 1).map((right) => {
                const relation = relationBetween(world, left, right)
                const style = relation >= 35 ? 'good' : relation <= -25 ? 'bad' : 'mid'
                return (
                  <li key={`${left}-${right}`}>
                    <span>{world.kingdoms[left].name}</span>
                    <span className={`relation ${style}`}>{relation}</span>
                    <span>{world.kingdoms[right].name}</span>
                  </li>
                )
              }),
            )}
          </ul>
        ) : (
          <p>Not enough kingdoms for diplomatic tracking.</p>
        )}
        <div className="policy-grid">
          {Object.values(world.kingdoms).map((kingdom) => (
            <div key={kingdom.id} className="policy-card">
              <strong>{kingdom.name}</strong>
              <span>
                Trade: <em>{kingdom.policy.tradeStance}</em>
              </span>
              <span>Tax: {(kingdom.policy.taxRate * 100).toFixed(0)}%</span>
              <span>Patrol: {kingdom.policy.patrolFocus.toFixed(2)}</span>
              <span>Guard rep≤{kingdom.policy.guardHostilityReputation}</span>
              <span>Guard bounty≥{kingdom.policy.guardHostilityBounty}</span>
              <span>Bounty decay: {kingdom.policy.bountyDecayPerTick}/tick</span>
              <span>Pardon factor: {kingdom.policy.pardonGoldFactor.toFixed(2)}x</span>
              <span>Court stability: {kingdom.policy.courtStability}</span>
              <span>Noble influence: {kingdom.policy.nobleInfluence}</span>
              <span>
                Edict: {edictLabel(kingdom.policy.activeEdict)}
                {kingdom.policy.activeEdict !== 'none' && kingdom.policy.edictExpiresTurn >= world.turn
                  ? ` (until ${kingdom.policy.edictExpiresTurn})`
                  : ''}
              </span>
              <span>Campaign: {world.campaignProgress[kingdom.id] ?? 0}</span>
              <span>
                Favor: {world.playerKingdomFavor[kingdom.id] ?? 0} ({favorRankTitle(world.playerKingdomFavor[kingdom.id] ?? 0)})
              </span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  )
}

