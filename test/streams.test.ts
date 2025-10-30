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
            connection.exit(0)
            resolve(undefined)
          })
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)
    child.stdin.end('test\n')

    await promise
    await waitForExit(child)

    // Stdin should have been closed (no data expected in this test)
    assert.strictEqual(
      receivedData,
      'test\n',
      'stdin should have received data',
    )

    await testServer.close()
  })

  it('should close stdout stream', async () => {
    const { promise, handler } = createConnectionHandler<void>(
      (connection, resolve, reject) => {
        connection.stdout.on('close', () => {
          connection.exit(0).then(resolve, reject)
        })
        connection.stdout.on('error', reject)
        connection.stdout.end('Byebye\n')
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    const stdoutPromise = new Promise<string>((resolve) => {
      let stdout = ''
      child.stdout
        .on('data', (data) => {
          stdout += data.toString()
        })
        .on('end', () => {
          resolve(stdout)
        })
    })

    await promise
    const stdout = await stdoutPromise
    assert.strictEqual(stdout, 'Byebye\n', 'stdout should contain Byebye')

    assert.strictEqual(
      child.stdout.readableEnded,
      true,
      'stdout should be ended',
    )

    await waitForExit(child)
    await testServer.close()
  })

  it('should close stderr stream', async () => {
    let stderrClosed = false

    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        try {
          connection.stderr.write('Error before close\n')
          await new Promise((resolve) => connection.stderr.end(resolve))
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
    const messages = ['First', 'Second', 'Third']

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

  it('should return 0 bytes when no stdin data, then null after close', async () => {
    const { promise, handler } = createConnectionHandler(
      async (connection, resolve, reject) => {
        const readStdin = (connection as any).readStdin.bind(connection)

        try {
          const first = await readStdin(1024)
          assert.ok(Buffer.isBuffer(first))
          assert.strictEqual(
            first.length,
            0,
            'should read 0 bytes when no data',
          )

          connection.stdin.destroy()
          await delay(100)

          const second = await readStdin(1024)
          assert.strictEqual(
            second,
            null,
            'should return null after stdin closed',
          )

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

    await testServer.close()
  })

  it('should successfully write and receive a large payload through stdout and stderr', async () => {
    const payloadStdout = Buffer.alloc(1024 * 1024, 'A') // 1 MB of 'A'
    const payloadStderr = Buffer.alloc(1024 * 1024, 'B') // 1 MB of 'B'

    const { promise, handler } = createConnectionHandler<void>(
      async (connection, resolve, reject) => {
        try {
          connection.stdout.write(payloadStdout, (err) => {
            if (err) return reject(err)
            connection.stderr.write(payloadStderr, (err2) => {
              if (err2) return reject(err2)
              connection.exit(0).then(resolve, reject)
            })
          })
        } catch (error) {
          reject(error as Error)
        }
      },
    )

    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)

    let gotStdout = Buffer.alloc(0)
    let gotStderr = Buffer.alloc(0)
    const p1 = new Promise<void>((resolve) => {
      child.stdout.on('data', (d) => {
        gotStdout = Buffer.concat([gotStdout, d])
      })
      child.stdout.on('end', resolve)
    })
    const p2 = new Promise<void>((resolve) => {
      child.stderr.on('data', (d) => {
        gotStderr = Buffer.concat([gotStderr, d])
      })
      child.stderr.on('end', resolve)
    })

    await promise
    await Promise.all([p1, p2])
    await waitForExit(child)

    assert.strictEqual(
      gotStdout.length,
      payloadStdout.length,
      'stdout length matches',
    )
    assert.strictEqual(
      gotStderr.length,
      payloadStderr.length,
      'stderr length matches',
    )
    assert.ok(gotStdout.equals(payloadStdout), 'stdout payload matches')
    assert.ok(gotStderr.equals(payloadStderr), 'stderr payload matches')

    await testServer.close()
  })

  it('should receive an error when closing stdin twice (protocol error path)', async () => {
    let closeStdin: () => Promise<void>
    const { promise, handler } = createConnectionHandler<void>(
      async (connection, resolve, reject) => {
        try {
          const CMD_CLOSE_STDIN = 0x09
          closeStdin = (connection as any).closeStream.bind(
            connection,
            CMD_CLOSE_STDIN,
          )
          await closeStdin() // first should succeed
          let error: unknown
          try {
            await closeStdin() // second should throw
          } catch (e) {
            error = e
          }
          assert.ok(
            error instanceof Error,
            'Should throw error on second close',
          )
          assert.ok(
            (error as Error).message.length > 0,
            'Error message should not be empty',
          )
          await connection.exit(0)
          resolve()
        } catch (error) {
          reject(error as Error)
        }
      },
    )
    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)
    await promise
    await waitForExit(child)
    await testServer.close()
  })

  it('should throw when calling closeStdin after stdin.destroy()', async () => {
    let closeStdin: () => Promise<void>
    const { promise, handler } = createConnectionHandler<void>(
      async (connection, resolve, reject) => {
        try {
          const CMD_CLOSE_STDIN = 0x09
          closeStdin = (connection as any).closeStream.bind(
            connection,
            CMD_CLOSE_STDIN,
          )

          connection.stdin.destroy()
          let error: unknown
          try {
            await closeStdin()
          } catch (e) {
            error = e
          }
          assert.ok(
            error instanceof Error,
            'Should throw error after stdin destroyed',
          )
          assert.ok(
            (error as Error).message.length > 0,
            'Error message should not be empty',
          )
          await connection.exit(0)
          resolve()
        } catch (error) {
          reject(error as Error)
        }
      },
    )
    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)
    await promise
    await waitForExit(child)
    await testServer.close()
  })

  it('should allow calling destroy multiple times safely on stdin, stdout, stderr', async () => {
    const { promise, handler } = createConnectionHandler<void>(
      async (connection, resolve, reject) => {
        try {
          // stdin (ReadStream)
          assert.doesNotThrow(() => {
            connection.stdin.destroy()
            connection.stdin.destroy()
            connection.stdin.destroy()
          }, 'stdin.destroy() should be idempotent')

          // stdout (WriteStream)
          assert.doesNotThrow(() => {
            connection.stdout.destroy()
            connection.stdout.destroy()
          }, 'stdout.destroy() should be idempotent')

          // stderr (WriteStream)
          assert.doesNotThrow(() => {
            connection.stderr.destroy()
            connection.stderr.destroy()
          }, 'stderr.destroy() should be idempotent')

          await connection.exit(0)
          resolve()
        } catch (error) {
          reject(error as Error)
        }
      },
    )
    const testServer = await createTestServer(handler)
    const child = spawnNativeProcess(testServer.port)
    await promise
    await waitForExit(child)
    await testServer.close()
  })
})
