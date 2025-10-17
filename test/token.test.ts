import { describe, it } from 'node:test'
import assert from 'node:assert'
import crypto from 'crypto'
import {
  createTestServer,
  spawnNativeProcess,
  waitForExit,
  delay,
  createConnectionHandler,
} from './helpers.js'

describe('Token Authentication', () => {
  it('should accept valid token', async () => {
    const expectedToken = crypto.randomBytes(16).toString('hex')

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          await delay(100)
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler, {
      validateConnection: async (token: string) => {
        return token === expectedToken
      },
    })

    const child = spawnNativeProcess(testServer.port, ['test'], {
      PROCESS_PROXY_TOKEN: expectedToken,
    })

    await promise
    const exitCode = await waitForExit(child)
    assert.strictEqual(exitCode, 0, 'should exit with code 0')

    await testServer.close()
  })

  it('should reject invalid token', async () => {
    const expectedToken = crypto.randomBytes(16).toString('hex')
    const wrongToken = crypto.randomBytes(16).toString('hex')

    let connectionReceived = false

    const testServer = await createTestServer(
      () => {
        connectionReceived = true
      },
      {
        validateConnection: async (token: string) => {
          return token === expectedToken
        },
      },
    )

    const child = spawnNativeProcess(testServer.port, ['test'], {
      PROCESS_PROXY_TOKEN: wrongToken,
    })

    await waitForExit(child)
    await delay(100) // Give server time to process

    assert.strictEqual(
      connectionReceived,
      false,
      'connection handler should not be called',
    )

    await testServer.close()
  })

  it('should reject missing token when validation required', async () => {
    const expectedToken = crypto.randomBytes(16).toString('hex')

    let connectionReceived = false

    const testServer = await createTestServer(
      () => {
        connectionReceived = true
      },
      {
        validateConnection: async (token: string) => {
          return token === expectedToken
        },
      },
    )

    const child = spawnNativeProcess(testServer.port, ['test'])

    await waitForExit(child)
    await delay(100) // Give server time to process

    assert.strictEqual(
      connectionReceived,
      false,
      'connection handler should not be called',
    )

    await testServer.close()
  })

  it('should expose token on connection', async () => {
    const expectedToken = 'my-test-token-12345'

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          assert.strictEqual(
            connection.token,
            expectedToken,
            'connection.token should match',
          )
          assert.strictEqual(
            typeof connection.token,
            'string',
            'token should be a string',
          )
          assert.strictEqual(
            connection.token.length,
            expectedToken.length,
            'token length should match',
          )

          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port, ['test'], {
      PROCESS_PROXY_TOKEN: expectedToken,
    })

    await promise
    await waitForExit(child)

    await testServer.close()
  })

  it('should have empty token when none provided', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          assert.strictEqual(
            connection.token,
            '',
            'token should be empty string',
          )
          assert.strictEqual(
            connection.token.length,
            0,
            'token length should be 0',
          )

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

  it('should support long tokens', async () => {
    // Generate a 64-byte token (max is 128 bytes in handshake)
    const longToken = crypto.randomBytes(64).toString('hex')

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          assert.strictEqual(
            connection.token,
            longToken,
            'long token should match',
          )
          assert.strictEqual(
            connection.token.length,
            128,
            'token length should be 128',
          )

          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port, ['test'], {
      PROCESS_PROXY_TOKEN: longToken,
    })

    await promise
    await waitForExit(child)

    await testServer.close()
  })
})
