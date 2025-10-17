import { describe, it } from 'node:test'
import assert from 'node:assert'
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
})
