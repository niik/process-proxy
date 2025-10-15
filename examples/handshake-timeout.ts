import { createProxyProcessServer } from '../src/index.js'
import { createConnection } from 'net'
import { AddressInfo } from 'net'

async function main() {
  console.log('=== Testing Handshake Timeout ===\n')

  // Create server
  const server = createProxyProcessServer((connection) => {
    console.log('❌ ERROR: Connection should not have been established!')
  })

  // Start listening
  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })

  console.log(`Server listening on port ${port}`)

  // Connect but don't send handshake (will timeout)
  console.log('Connecting without sending handshake...')
  const client = createConnection(port, '127.0.0.1', () => {
    console.log('Connected to server')
    console.log('Waiting for timeout (500ms)...')
  })

  client.on('close', () => {
    console.log('\n✅ Connection closed due to handshake timeout (expected)')
    server.close()
  })

  client.on('error', (err) => {
    // Socket may emit error when destroyed
    if (err.message !== 'read ECONNRESET') {
      console.log('Connection error:', err.message)
    }
  })

  // Cleanup after test
  setTimeout(() => {
    console.log('\nTest complete')
    process.exit(0)
  }, 1500)
}

main().catch(console.error)
