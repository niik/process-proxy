import { AddressInfo, Server } from 'net'
import {
  spawn,
  ChildProcess,
  ChildProcessWithoutNullStreams,
} from 'child_process'
import { createProxyProcessServer, getProxyCommandPath } from '../src/index.js'
import type { ProcessProxyConnection } from '../src/connection.js'

export interface TestServer {
  server: Server
  port: number
  close: () => Promise<void>
}

/**
 * Creates a test server and waits for it to start listening
 */
export async function createTestServer(
  listener: (conn: ProcessProxyConnection) => void,
  options?: Parameters<typeof createProxyProcessServer>[1],
): Promise<TestServer> {
  const server = createProxyProcessServer(listener, options)

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })

  return {
    server,
    port,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve())
      }),
  }
}

/**
 * Spawns a native process with the given port and environment
 */
export function spawnNativeProcess(
  port: number,
  args: string[] = ['test'],
  env: Record<string, string> = {},
): ChildProcessWithoutNullStreams {
  return spawn(getProxyCommandPath(), args, {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
      ...env,
    },
    stdio: 'pipe', // Use pipe instead of inherit for testing
  })
}

/**
 * Waits for a child process to exit
 */
export async function waitForExit(
  child: ChildProcess,
): Promise<NodeJS.Signals | number | null> {
  if (child.exitCode !== null) {
    return child.exitCode
  }

  if (child.signalCode !== null) {
    return child.signalCode
  }

  return new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? null))
  })
}

/**
 * Waits for a specified amount of time
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Collects all output from a stream
 */
export async function collectOutput(
  stream: NodeJS.ReadableStream,
): Promise<string> {
  const chunks: Buffer[] = []
  return new Promise((resolve, reject) => {
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    stream.on('end', () => resolve(Buffer.concat(chunks).toString()))
    stream.on('error', reject)
  })
}

/**
 * Creates a connection handler that resolves after running assertions
 */
export function createConnectionHandler<T>(
  handler: (
    connection: ProcessProxyConnection,
    resolve: (value: T) => void,
    reject: (error: Error) => void,
  ) => void | Promise<void>,
): {
  promise: Promise<T>
  handler: (connection: ProcessProxyConnection) => void
} {
  let resolvePromise: (value: T) => void
  let rejectPromise: (error: Error) => void

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })

  const connectionHandler = (connection: ProcessProxyConnection) => {
    Promise.resolve(handler(connection, resolvePromise!, rejectPromise!)).catch(
      rejectPromise!,
    )
  }

  return { promise, handler: connectionHandler }
}
