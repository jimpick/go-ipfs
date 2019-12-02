import {Deck, OrthographicView, COORDINATE_SYSTEM} from '@deck.gl/core'
import {ScatterplotLayer, TextLayer, LineLayer} from '@deck.gl/layers'
import convert from 'color-convert'
import PeerId from 'peer-id'
import multihashing from 'multihashing-async'

const deckNodeData = new Map()
const deckBitswapData = new Map()
let blockCount = 0

const socket = new WebSocket('ws://localhost:9123')

socket.addEventListener('open', function (event) {
  socket.send('Hello Server!')
})

socket.addEventListener('message', async function (event) {
  console.log('Message from server ', event.data)
  try {
    const data = JSON.parse(event.data)
    blockCount = data.blockCount
    if (data.nodeId) {
      if (!deckNodeData.has(data.nodeId)) {
        await addHash(data.nodeId)
      }
    }
    for (const hash of Object.keys(data.peers)) {
      if (!deckNodeData.has(hash)) {
        await addHash(hash)
      }
      if (data.nodeId) {
        deckBitswapData.set(hash, {
          fromPeerId: deckNodeData.get(hash).peerId,
          toPeerId: deckNodeData.get(data.nodeId).peerId,
          ...data.peers[hash]
        })
      }
    }

    render()

    async function addHash (hash) {
      const peer = PeerId.createFromB58String(hash)
      const dhtId = await multihashing.digest(peer.id, 'sha2-256')
      deckNodeData.set(hash, {
        hash,
        peer,
        dhtId,
        peerId: dhtId[0]
      })
    }
  } catch (e) {
  }
})

const INITIAL_VIEW_STATE = {
  target: [0, 0, 0],
  zoom: 2
}

/*
for (let i = 0; i < 256; i += 20) {
  data.push({
    peerId: i
  })
}
*/

const radius = 60.0

const deck = new Deck({
  views: new OrthographicView(),
  initialViewState: INITIAL_VIEW_STATE,
  controller: true
})

function render () {
  const data = []
  for (const d of deckNodeData) {
    data.push(d[1])
  }
  const bitswapData = []
  for (const d of deckBitswapData) {
    bitswapData.push(d[1])
  }
  const layers = [
    new ScatterplotLayer({
      id: 'peers',
      coordinateSystem: COORDINATE_SYSTEM.IDENTITY,
      data,
      getPosition: d => [
        radius * Math.sin(d.peerId / 256.0 * 2 * Math.PI),
        - radius * Math.cos(d.peerId / 256.0 * 2 * Math.PI)
      ],
      getFillColor: d => convert.hsv.rgb.raw(d.peerId / 256.0 * 360.0, 70.0, 100.0),
      getRadius: 5
    }),
    new TextLayer({
      id: 'peer labels',
      coordinateSystem: COORDINATE_SYSTEM.IDENTITY,
      data,
      getSize: 15,
      getPosition: d => [
        radius * Math.sin(d.peerId / 256.0 * 2 * Math.PI),
        - radius * Math.cos(d.peerId / 256.0 * 2 * Math.PI)
      ],
      getText: d => d.peerId.toString(16).padStart(2, '0'),
      getColor: [0, 0, 0]
    }),
    new LineLayer({
      id: 'bitswap traffic between peers',
      coordinateSystem: COORDINATE_SYSTEM.IDENTITY,
      data: bitswapData,
      getSourcePosition: d => [
        radius * Math.sin(d.fromPeerId / 256.0 * 2 * Math.PI),
        - radius * Math.cos(d.fromPeerId / 256.0 * 2 * Math.PI),
        -1
      ],
      getTargetPosition: d => [
        radius * Math.sin(d.toPeerId / 256.0 * 2 * Math.PI),
        - radius * Math.cos(d.toPeerId / 256.0 * 2 * Math.PI),
        -1
      ],
      // getWidth: 1,
      getWidth: d => 19.0 * d.received / blockCount + 1.0,
      // getColor: d => d.received ? [0, 0, 1] : [1, 0, 0]
      getColor: d => d.received ? [0, 0, 0] : [220, 220, 220]
    })
  ]
  deck.setProps({ layers })
}

render()