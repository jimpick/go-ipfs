#!/usr/bin/env node
const http = require('http')
const speedometer = require('speedometer')
const prettyBytes = require('pretty-bytes')

let cidDhtLookups = {}
let savedChunk = ''
let wantlistSize = 0

async function run () {
  console.log('Starting...')

  const options = {
    hostname: 'localhost',
    port: 5001,
    path: '/api/v0/log/tail',
    method: 'GET'
  }

  const sessions = {}
  const keysToSessions = {}
  const speedometers = {}
  let errors = []

  setInterval(render, 1000)

  while (true) {
    await fetch()
  }

  function fetch () {
    return new Promise(resolve => {
      const req = http.request(options, handler)
      req.on('error', (e) => {
        console.error(`problem with request: ${e.message}`);
      });
      req.end()

      function handler (res) {
        // console.log(`STATUS: ${res.statusCode}`);
        // console.log(`HEADERS: ${JSON.stringify(res.headers)}`);
        res.setEncoding('utf8');
        res.on('data', processChunk)
        res.on('end', () => {
          // console.log('No more data in response.');
          resolve()
        });
      }
    })
  }

  async function render () {
    const lines = []
    const now = Date.now()
    const watchSessions = []

    // Purge old speedometers
    for (const peerId in speedometer) {
      if (speedometers[peerId].last + 10000 < now) {
        delete speedometers[peerId]
      }
    }
    for (const uuid of Object.keys(sessions)) {
      watchSessions.push([sessions[uuid].id, uuid])
    }
    const sortedWatchSessions = watchSessions.sort(([id1], [id2]) => id2 - id1)
    for (const [id, uuid] of sortedWatchSessions) {
      const session = sessions[uuid]
      const {
        keys,
        firstKey,
        peers,
        done,
        incomingAdvertisedCount,
        incomingAdvertisedPeers
      } = session
      const blockCount = session.keys.size
      const receivedBlockCount = session.receivedKeys.size
      lines.push(
        `Session: ${id} ${uuid} ` +
        `Blocks: ${receivedBlockCount} of ${blockCount} ` +
        firstKey +
        (done ? ` -DONE-` : '')
      )
      lines.push(
        `  Advertised wantlist ${incomingAdvertisedCount} times to ` +
        `${incomingAdvertisedPeers.size} unique incoming peers ` +
        `(current size ${wantlistSize})`
      )
      if (session.dhtSearches) {
        dhtLines = []
        const searches = session.dhtSearches
        const keyStarts = Object.keys(searches)
          .map(key => [key, searches[key].started])
          .sort(([key1, started1], [key2, started2]) => {
            const timeDiff = started2 - started1
            if (timeDiff !== 0) return timeDiff
            return key1.localeCompare(key2)
          })
        for (const [key] of keyStarts) {
          const search = searches[key]
          if (search.started + 45000 < now) continue
          const end = search.finished || done || Date.now()
          const dots = Math.floor(Math.min(end - search.started, 40000) / 1000)
          let report = ''
          if (search.finished || done) {
            const seconds = ((end - search.started) / 1000).toFixed(1)
            report = `${seconds}s`
            if (search.found.size > 0) {
              const peers = [...search.found]
                .map(cid => cid.slice(-3))
                .sort().slice(0, 5)
              let foundPeers = peers.join(' ')
              if (peers.length < search.found.size) {
                foundPeers += '...'
              }
              
              report += ` Found ${search.found.size} - ${foundPeers}`
            }
          }
          dhtLines.push(
            `  DHT: ${key} ` + '.'.repeat(dots) + ' ' + report
          )
        }
        if (dhtLines.length > 15) dhtLines.length = 15
        for (const line of dhtLines) {
          lines.push(line)
        }
      }
      for (const peerId of Object.keys(peers)) {
        const peer = peers[peerId]
        const duplicates = peer.duplicateKeys.size
        const received = peer.receivedKeys.size - duplicates
        let state = ''
        if (received > 0 || !peer.dhtError) {
          state = `Blocks: ${received}` +
          (duplicates ? ` + ${duplicates} dup` : '')
          if (speedometers[peerId] && !done) {
            function clamp (num) { // Filter out noise
              return num > 200 ? num : 0
            }
            const inSpeed = clamp(speedometers[peerId].inMeter())
            const outSpeed = clamp(speedometers[peerId].outMeter())
            state += `, In: ${prettyBytes(inSpeed)}ps / ` +
              `Out: ${prettyBytes(outSpeed)}ps`
          }
        } else {
          state = 'Connection error'
        }
        lines.push(
          `    ${peerId} ` +
          (peer.dht ? 'DHT ' : '--- ') +
          state
        )
      }
    }
    const displayErrors = errors.slice(-5)
    lines.length = Math.min(
      lines.length,
      Math.max(process.stdout.rows - 4 - displayErrors.length, 10)
    )
    if (displayErrors.length > 0) {
      lines.push('')
      for (const line of displayErrors) {
        lines.push(line)
      }
    }
    if (lines.length === 0) {
      lines.push('Waiting...')
    }
    console.log('\u001b[2J\u001b[0;0H')
    console.log(lines.join('\n'))
  }

  function processChunk (chunk) {
    try {
      const event = JSON.parse(savedChunk + chunk)
      savedChunk = ''
      const { system } = event
      if (system === 'jimbssess') {
        // console.log(event)
        const {
          event: evt,
          sessionId,
          sessionUuid: {
            GetBlockRequest: sessionUuid
          },
          keys: keysJson
        } = event
        keys = []
        try {
          const parsedKeys = JSON.parse(keysJson)
          for (const keyObj of parsedKeys) {
            if (keyObj['/']) {
              keys.push(keyObj['/'])
            }
          }
        } catch (e) {
          // Ignore
          // console.error('Err', e.message)
          errors.push('E1: ' + e.message)
        }
        if (!sessions[sessionUuid]) {
          sessions[sessionUuid] = {
            id: sessionId,
            added: Date.now(),
            firstKey: keys[0],
            keys: new Set(),
            receivedKeys: new Set(),
            peers: {},
            dhtSearches: {},
            dhtSearchCount: 0,
            incomingAdvertisedCount: 0,
            incomingAdvertisedPeers: new Set()
          }
        }
        const session = sessions[sessionUuid]
        for (const key of keys) {
          session.keys.add(key)
          if (!keysToSessions[key]) {
            keysToSessions[key] = new Set()
          }
          keysToSessions[key].add(session)
        }
        if (evt === 'receivefrom') {
          const { peer } = event
          if (!session.peers[peer]) {
            session.peers[peer] = {
              receivedKeys: new Set(),
              duplicateKeys: new Set()
            }
          }
          const sessionPeer = session.peers[peer]
          for (const key of keys) {
            sessionPeer.receivedKeys.add(key)
            if (session.receivedKeys.has(key)) {
              sessionPeer.duplicateKeys.add(key)
            }
            session.receivedKeys.add(key)
          }
        }
      }
      if (system === 'bitswap') {
        const { event: evt } = event
        if (evt === 'jimprovfind') {
          const {
            key: {
              "/": key
            }
          } = event
          const sessions = keysToSessions[key]
          if (sessions) {
            for (const session of sessions) {
              if (session.done) continue
              session.dhtSearches[key] = {
                started: Date.now(),
                found: new Set()
              }
            }
          }
        }
        if (evt === 'jimprovfound') {
          const {
            key: {
              "/": key
            },
            provider: peer
          } = event
          const sessions = keysToSessions[key]
          if (sessions) {
            for (const session of sessions) {
              if (session.done) continue
              if (!session.peers[peer]) {
                session.peers[peer] = {
                  receivedKeys: new Set(),
                  duplicateKeys: new Set()
                }
              }
              session.peers[peer].dht = true
              session.peers[peer].dhtError = false
              if (session.dhtSearches[key]) {
                session.dhtSearches[key].found.add(peer)
              }
            }
          }
        }
        if (evt === 'jimprovconnerror') {
          const {
            key: {
              "/": key
            },
            provider: peer
          } = event
          const sessions = keysToSessions[key]
          if (sessions) {
            for (const session of sessions) {
              if (session.done) continue
              if (session.peers[peer]) {
                session.peers[peer].dhtError = true
              }
            }
          }
        }
        if (evt === 'jimbssessdone') {
          const {
            sessionUuid: {
              "GetBlockRequest": uuid
            }
          } = event
          if (sessions[uuid]) {
            sessions[uuid].done = Date.now()
          }
        }
        if (evt === 'jimbspeermanconnectaddwants') {
          const {
            initialWantsLen,
            peer
          } = event
          wantlistSize = initialWantsLen
          if (initialWantsLen > 0) {
            for (const uuid in sessions) {
              const session = sessions[uuid]
              if (session) {
                if (session.done) continue
                session.incomingAdvertisedCount += 1
                session.incomingAdvertisedPeers.add(peer)
              }
            }
          }
        }
      }
      if (system === 'bitswap_network') {
        const { event: evt } = event
        if (evt === 'jimprovfinish') {
          const {
            key: {
              "/": key
            }
          } = event
          const sessions = keysToSessions[key]
          if (sessions) {
            for (const session of sessions) {
              if (session.done) continue
              if (!session.dhtSearches) {
                session.dhtSearches = {
                  found: new Set()
                }
              }
              if (session.dhtSearches[key]) {
                session.dhtSearches[key].finished = Date.now()
              }
            }
          }
        }
      }
      if (system === 'jimnet') {
        const { peer, event: evt, proto, size } = event
        if (proto.match(/bitswap/)) {
          const now = Date.now()
          if (!speedometers[peer]) {
            speedometers[peer] = {
              inMeter: speedometer(),
              outMeter: speedometer(),
              created: now
            }
          }
          if (evt === 'in') speedometers[peer].inMeter(size)
          if (evt === 'out') speedometers[peer].outMeter(size)
          speedometers[peer].last = now
        }
      }
    } catch (e) {
      // Ignore
      // console.error('Err', e.message)
      if (e.message === 'Unexpected end of JSON input') {
        savedChunk += chunk
      } else {
        errors.push('E2: ' + e.message)
      }
    }
  }

}

run()
