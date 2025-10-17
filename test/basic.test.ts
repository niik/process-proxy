import { describe, it } from 'node:test'
import assert from 'node:assert'
import {
  createTestServer,
  spawnNativeProcess,
  waitForExit,
  delay,
  createConnectionHandler,
} from './helpers.js'

describe('Basic Connection', () => {
  it('should establish connection and receive process info', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          const args = await connection.getArgs()
          const cwd = await connection.getCwd()
          const env = await connection.getEnv()

          assert.ok(Array.isArray(args), 'args should be an array')
          assert.ok(args.length >= 2, 'should have at least 2 args')
          assert.ok(args[1] === 'arg1', 'first custom arg should be "arg1"')

          assert.ok(typeof cwd === 'string', 'cwd should be a string')
          assert.ok(cwd.length > 0, 'cwd should not be empty')

          assert.ok(typeof env === 'object', 'env should be an object')
          assert.ok(env.PROCESS_PROXY_PORT, 'should have PROCESS_PROXY_PORT')

          await connection.exit(42)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port, ['arg1', 'arg2', 'arg3'])

    await promise
    const exitCode = await waitForExit(child)
    assert.strictEqual(exitCode, 42, 'exit code should be 42')

    await testServer.close()
  })

  it('should write to stdout', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stdout.write('Hello World\n')
          connection.stdout.write('Second line\n')

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

    assert.ok(stdout.includes('Hello World'), 'should contain Hello World')
    assert.ok(stdout.includes('Second line'), 'should contain Second line')

    await testServer.close()
  })

  it('should write to stderr', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stderr.write('Error message\n')

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

    let stderr = ''
    child.stderr!.on('data', (data) => {
      stderr += data.toString()
    })

    await promise
    await waitForExit(child)

    assert.ok(stderr.includes('Error message'), 'should contain error message')

    await testServer.close()
  })

  it('should handle exit with custom code', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          await connection.exit(99)
          resolve(undefined)
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    await promise
    const exitCode = await waitForExit(child)

    assert.strictEqual(exitCode, 99, 'exit code should be 99')

    await testServer.close()
  })
})
