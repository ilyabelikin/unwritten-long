import { useMemo } from 'react'
import { axialToPixel, polygonPoints } from '../core/hex'
import type { Character, Terrain, Tile, World } from '../core/types'
import './MapView.css'

const HEX_SIZE = 18
const MAP_PADDING = 48

const terrainColor: Record<Terrain, string> = {
  sea: '#2d5f9b',
  coast: '#4e86ba',
  plains: '#7ba95f',
  hills: '#66804d',
  mountain: '#8c8a8a',
}

const vegetationOverlay = (tile: Tile): string => {
  if (tile.vegetation === 'deep_forest') return '#2f5531'
  if (tile.vegetation === 'sparse_trees') return '#4f7342'
  if (tile.vegetation === 'bush') return '#64854b'
  return 'transparent'
}

const unitIconBy = (character: Character): string => {
  if (character.role === 'player') return '/assets/units/player.svg'
  if (character.role === 'trader') return '/assets/units/caravan.svg'
  if (character.role === 'bandit') return '/assets/units/bandit.svg'
  if (character.role === 'guard') return '/assets/units/guard.svg'
  if (character.role === 'migrant') return '/assets/units/migrant.svg'
  if (character.role === 'monster') return '/assets/units/monster.svg'
  if (character.species === 'rabbit') return '/assets/units/rabbit.svg'
  if (character.species === 'deer') return '/assets/units/deer.svg'
  if (character.species === 'wolf') return '/assets/units/wolf.svg'
  if (character.species === 'bear') return '/assets/units/bear.svg'
  return '/assets/units/villager.svg'
}

const stackOffsets = (count: number): { x: number; y: number }[] => {
  if (count <= 1) return [{ x: 0, y: 0 }]
  if (count === 2) return [{ x: -10, y: 0 }, { x: 10, y: 0 }]
  const radius = 13
  const ringCount = count - 1
  const offsets: { x: number; y: number }[] = [{ x: 0, y: 0 }]
  const ring = Array.from({ length: ringCount }, (_, i) => {
    const angle = (Math.PI * 2 * i) / ringCount
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius }
  })
  return [...offsets, ...ring]
}

interface MapViewProps {
  world: World
  onTileClick: (tileId: string) => void
  onCharacterClick: (characterId: string) => void
}

export const MapView = ({ world, onTileClick, onCharacterClick }: MapViewProps) => {
  const { width, height } = useMemo(() => {
    const maxPoint = axialToPixel({ q: world.width, r: world.height }, HEX_SIZE)
    return {
      width: maxPoint.x + MAP_PADDING * 2,
      height: maxPoint.y + MAP_PADDING * 2,
    }
  }, [world.height, world.width])

  const entitiesByTile = useMemo(() => {
    const map = new Map<string, Character[]>()
    for (const character of Object.values(world.characters)) {
      if (!character.alive) continue
      if (!map.has(character.location)) map.set(character.location, [])
      map.get(character.location)!.push(character)
    }
    return map
  }, [world.characters])

  return (
    <div className="map-container">
      <svg className="map-svg" viewBox={`0 0 ${width} ${height}`}>
        <g>
          {world.tileOrder.map((tileId) => {
            const tile = world.tiles[tileId]
            const point = axialToPixel(tile.coord, HEX_SIZE)
            const x = point.x + MAP_PADDING
            const y = point.y + MAP_PADDING
            const selected = world.selectedTileId === tileId
            return (
              <g key={tile.id} onClick={() => onTileClick(tile.id)} className="tile-group">
                <polygon
                  points={polygonPoints(x, y, HEX_SIZE)}
                  fill={terrainColor[tile.terrain]}
                  stroke={selected ? '#f7ea7d' : tile.road ? '#443520' : '#1f2a33'}
                  strokeWidth={selected ? 2.4 : 1}
                />
                {tile.vegetation !== 'none' && (
                  <circle cx={x} cy={y} r={HEX_SIZE * 0.45} fill={vegetationOverlay(tile)} opacity={0.55} />
                )}
                {tile.resources.includes('iron_ore') && (
                  <rect x={x - 3} y={y - 2} width={6} height={4} fill="#7f8b99" opacity={0.9} />
                )}
                {tile.resources.includes('gold_ore') && (
                  <rect x={x - 1.8} y={y + 1} width={4} height={3} fill="#cdb44d" opacity={0.9} />
                )}
                {tile.road && <circle cx={x} cy={y} r={2.2} fill="#81633d" opacity={0.9} />}
              </g>
            )
          })}
        </g>

        <g>
          {Object.values(world.settlements).map((settlement) => {
            const center = world.tiles[settlement.tiles[0]]
            const p = axialToPixel(center.coord, HEX_SIZE)
            const x = p.x + MAP_PADDING
            const y = p.y + MAP_PADDING
            return (
              <g key={settlement.id}>
                <image
                  href={
                    settlement.tier === 'city'
                      ? '/assets/buildings/city.svg'
                      : settlement.tier === 'town'
                        ? '/assets/buildings/town.svg'
                        : settlement.tier === 'village'
                          ? '/assets/buildings/village.svg'
                          : '/assets/buildings/hamlet.svg'
                  }
                  x={x - 11}
                  y={y - 25}
                  width={22}
                  height={22}
                />
                <text x={x} y={y - 28} className="settlement-label">
                  {settlement.name}
                </text>
              </g>
            )
          })}
        </g>

        <g>
          {Array.from(entitiesByTile.entries()).map(([tileId, chars]) => {
            const tile = world.tiles[tileId]
            const center = axialToPixel(tile.coord, HEX_SIZE)
            const x = center.x + MAP_PADDING
            const y = center.y + MAP_PADDING + 6
            const offsets = stackOffsets(chars.length)
            return chars.map((char, idx) => {
              const offset = offsets[idx] ?? { x: 0, y: 0 }
              const isSelected = world.selectedCharacterId === char.id
              return (
                <g
                  key={char.id}
                  transform={`translate(${x + offset.x - 8}, ${y + offset.y - 8})`}
                  onClick={(event) => {
                    event.stopPropagation()
                    onCharacterClick(char.id)
                  }}
                  className="unit-icon"
                >
                  <rect
                    x={-1}
                    y={-1}
                    width={18}
                    height={18}
                    rx={3}
                    fill={isSelected ? '#f1e67e' : 'rgba(20,20,20,0.55)'}
                    stroke={isSelected ? '#f9f2ab' : 'rgba(255,255,255,0.18)'}
                    strokeWidth={1}
                  />
                  <image href={unitIconBy(char)} width={16} height={16} />
                </g>
              )
            })
          })}
        </g>
      </svg>
    </div>
  )
}

