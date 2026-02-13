import './App.css'
import { useGameStore } from './game/store'
import { MapView } from './ui/MapView'
import { Hud } from './ui/Hud'

const App = () => {
  const world = useGameStore((state) => state.world)
  const actionFeed = useGameStore((state) => state.actionFeed)
  const regenerate = useGameStore((state) => state.regenerate)
  const clickTile = useGameStore((state) => state.clickTile)
  const clickCharacter = useGameStore((state) => state.clickCharacter)
  const endTurn = useGameStore((state) => state.forceEndTurn)
  const confirmRobbery = useGameStore((state) => state.confirmRobbery)

  return (
    <main className="app-shell">
      <section className="map-pane">
        <MapView world={world} onTileClick={clickTile} onCharacterClick={clickCharacter} />
      </section>
      <Hud
        world={world}
        actionFeed={actionFeed}
        onNewWorld={() => regenerate()}
        onEndTurn={endTurn}
        onConfirmRobbery={confirmRobbery}
      />
    </main>
  )
}

export default App
