import { describe, it } from 'node:test'
import assert from 'node:assert'
import net from 'node:net'
import {
  createTestServer,
  spawnNativeProcess,
  waitForExit,
  createConnectionHandler,
} from './helpers.js'

describe('Handshake', () => {
  it('should accept valid handshake with token', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port, ['test'], {
      PROCESS_PROXY_TOKEN: 'test-token',
    })

    await promise
    await waitForExit(child)

    await testServer.close()
  })

  it('should accept valid handshake without token', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port, ['test'])

    await promise
    await waitForExit(child)

    await testServer.close()
  })

  it('should reject connection if handshake not sent within timeout', async () => {
    let connectionReceived = false

    const testServer = await createTestServer(
      () => {
        connectionReceived = true
      },
      { handshakeTimeout: 50 },
    )

    const client = new net.Socket()

    await new Promise<void>((resolve, reject) => {
      client.connect(testServer.port, '127.0.0.1', resolve)
      client.on('error', reject)
    })

    // Wait longer than the custom 50ms handshake timeout
    await new Promise((r) => setTimeout(r, 120))

    // Server should have closed the socket
    assert.ok(client.destroyed || !client.readable, 'socket should be closed')
    assert.strictEqual(
      connectionReceived,
      false,
      'connection handler should not be called on timeout',
    )

    client.destroy()
    await testServer.close()
  })

  it('should reject connection with invalid protocol header', async () => {
    let connectionReceived = false

    const testServer = await createTestServer(() => {
      connectionReceived = true
    })

    const client = new net.Socket()

    await new Promise<void>((resolve, reject) => {
      client.connect(testServer.port, '127.0.0.1', resolve)
      client.on('error', reject)
    })

    // Send a full-length handshake with an invalid 18-byte header
    const invalidHandshake = Buffer.alloc(146) // zeros => header will not match
    client.write(invalidHandshake)

    // Give the server a short time to process and close the socket
    await new Promise((r) => setTimeout(r, 100))

    // Server should have closed the socket and not invoked the connection handler
    assert.ok(client.destroyed || !client.readable, 'socket should be closed')
    assert.strictEqual(
      connectionReceived,
      false,
      'connection handler should not be called on invalid header',
    )

    client.destroy()
    await testServer.close()
  })
})
