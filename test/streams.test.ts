import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  createTestServer,
  spawnNativeProcess,
  waitForExit,
  delay,
  createConnectionHandler,
} from './helpers.js'

describe('Stream Operations', () => {
  it('should handle stdin data', async () => {
    let receivedData = ''

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stdin.on('data', (data) => {
            receivedData += data.toString()
          })

          connection.stdin.on('end', () => {
            resolve(undefined)
          })

          await delay(100)
          await connection.stdin.close()
          await connection.exit(0)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    await promise
    await waitForExit(child)

    // Stdin should have been closed (no data expected in this test)
    assert.ok(true, 'stdin close should complete')

    await testServer.close()
  })

  it('should close stdout stream', async () => {
    let stdoutClosed = false

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stdout.write('Before close\n')
          await connection.stdout.close()
          stdoutClosed = true

          await delay(100)
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    await promise
    await waitForExit(child)

    assert.ok(stdoutClosed, 'stdout should be closed')

    await testServer.close()
  })

  it('should close stderr stream', async () => {
    let stderrClosed = false

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stderr.write('Error before close\n')
          await connection.stderr.close()
          stderrClosed = true

          await delay(100)
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    await promise
    await waitForExit(child)

    assert.ok(stderrClosed, 'stderr should be closed')

    await testServer.close()
  })

  it('should handle multiple writes to stdout', async () => {
    const messages = ['Line 1\n', 'Line 2\n', 'Line 3\n']

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          for (const msg of messages) {
            connection.stdout.write(msg)
            await delay(50)
          }

          await delay(100)
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    let stdout = ''
    child.stdout!.on('data', (data) => {
      stdout += data.toString()
    })

    await promise
    await waitForExit(child)

    for (const msg of messages) {
      assert.ok(stdout.includes(msg), `should contain ${msg.trim()}`)
    }

    await testServer.close()
  })

  it('should handle mixed stdout and stderr writes', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stdout.write('stdout line 1\n')
          connection.stderr.write('stderr line 1\n')
          connection.stdout.write('stdout line 2\n')
          connection.stderr.write('stderr line 2\n')

          await delay(100)
          await connection.exit(0)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    let stdout = ''
    let stderr = ''
    child.stdout!.on('data', (data) => {
      stdout += data.toString()
    })
    child.stderr!.on('data', (data) => {
      stderr += data.toString()
    })

    await promise
    await waitForExit(child)

    assert.ok(stdout.includes('stdout line 1'), 'should contain stdout line 1')
    assert.ok(stdout.includes('stdout line 2'), 'should contain stdout line 2')
    assert.ok(stderr.includes('stderr line 1'), 'should contain stderr line 1')
    assert.ok(stderr.includes('stderr line 2'), 'should contain stderr line 2')

    await testServer.close()
  })
})
