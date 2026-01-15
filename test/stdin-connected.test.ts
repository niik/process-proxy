import { describe, it } from 'node:test'
import * as assert from 'node:assert'
import { spawn } from 'child_process'
import { getProxyCommandPath } from '../src/index.js'
import {
  createTestServer,
  createConnectionHandler,
  waitForExit,
} from './helpers.js'

describe('isStdinConnected', () => {
  it('should return true when stdin is connected via pipe', async () => {
    const { promise, handler } = createConnectionHandler<boolean>(
      async (connection, resolve) => {
        const connected = await connection.isStdinConnected()
        await connection.exit(0)
        resolve(connected)
      },
    )

    const server = await createTestServer(handler)

    const child = spawn(getProxyCommandPath(), ['test'], {
      env: {
        ...process.env,
        PROCESS_PROXY_PORT: server.port.toString(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const connected = await promise
    await waitForExit(child)
    await server.close()

    assert.strictEqual(connected, true, 'stdin should be connected when piped')
  })

  it('should return false when stdin is /dev/null', async () => {
    // Skip on Windows as /dev/null doesn't exist
    if (process.platform === 'win32') {
      return
    }

    const { promise, handler } = createConnectionHandler<boolean>(
      async (connection, resolve) => {
        const connected = await connection.isStdinConnected()
        await connection.exit(0)
        resolve(connected)
      },
    )

    const server = await createTestServer(handler)

    const child = spawn(getProxyCommandPath(), ['test'], {
      env: {
        ...process.env,
        PROCESS_PROXY_PORT: server.port.toString(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const connected = await promise
    await waitForExit(child)
    await server.close()

    assert.strictEqual(
      connected,
      false,
      'stdin should not be connected when set to ignore/dev/null',
    )
  })

  it('should return false after stdin is closed', async () => {
    const { promise, handler } = createConnectionHandler<{
      before: boolean
      after: boolean
    }>(async (connection, resolve) => {
      const before = await connection.isStdinConnected()

      // Close stdin
      connection.stdin.destroy()
      await new Promise((r) => setTimeout(r, 50))

      const after = await connection.isStdinConnected()
      await connection.exit(0)
      resolve({ before, after })
    })

    const server = await createTestServer(handler)

    const child = spawn(getProxyCommandPath(), ['test'], {
      env: {
        ...process.env,
        PROCESS_PROXY_PORT: server.port.toString(),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    const result = await promise
    await waitForExit(child)
    await server.close()

    assert.strictEqual(
      result.before,
      true,
      'stdin should be connected before close',
    )
    assert.strictEqual(
      result.after,
      false,
      'stdin should not be connected after close',
    )
  })
})
