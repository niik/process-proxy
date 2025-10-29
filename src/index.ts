import { createServer, ServerOpts, Socket } from 'net'
import { ProcessProxyConnection } from './connection.js'
export { ProcessProxyConnection } from './connection.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { platform } from 'os'
import { readSocket } from './read-socket.js'

const HANDSHAKE_PROTOCOL = 'ProcessProxy 0001 '
const HANDSHAKE_PROTOCOL_LENGTH = 18
const HANDSHAKE_TOKEN_LENGTH = 128
const HANDSHAKE_LENGTH = HANDSHAKE_PROTOCOL_LENGTH + HANDSHAKE_TOKEN_LENGTH // 146 bytes
const DEFAULT_HANDSHAKE_TIMEOUT = 1000

export interface ProxyProcessServerOptions extends ServerOpts {
  /**
   * Optional callback to validate the connection token.
   * Receives the token string and should return a Promise<boolean>.
   * If false, the connection will be rejected.
   */
  validateConnection?: (token: string) => Promise<boolean>
  /**
   * Optional handshake timeout in milliseconds. Defaults to 1000ms.
   */
  handshakeTimeout?: number
}

/**
 * Creates a TCP server that listens for incoming connections from native processes.
 *
 * Each connection is validated with a handshake before being wrapped in a ProcessProxyConnection
 * instance and passed to the listener callback.
 *
 * @param listener A callback function that is invoked for each incoming connection.
 * @param options Optional server options including validateConnection callback.
 * @returns A TCP server instance.
 */
export const createProxyProcessServer = (
  listener: (conn: ProcessProxyConnection) => void,
  options?: ProxyProcessServerOptions,
) => {
  const { validateConnection, handshakeTimeout, ...serverOpts } = options || {}

  return createServer(serverOpts, (socket) => {
    ensureValidHandshake(
      socket,
      validateConnection,
      handshakeTimeout ?? DEFAULT_HANDSHAKE_TIMEOUT,
    )
      .then((token) => listener(new ProcessProxyConnection(socket, token)))
      .catch((e) => socket.end())
  })
}

const ensureValidHandshake = async (
  socket: Socket,
  validateConnection: ((token: string) => Promise<boolean>) | undefined,
  timeoutMs: number,
): Promise<string> => {
  const buffer = await readSocket(
    socket,
    HANDSHAKE_LENGTH,
    AbortSignal.timeout(timeoutMs),
  )
  // Parse protocol header (18 bytes)
  const protocolHeader = buffer
    .subarray(0, HANDSHAKE_PROTOCOL_LENGTH)
    .toString('utf-8')

  if (protocolHeader !== HANDSHAKE_PROTOCOL) {
    throw new Error('Invalid handshake protocol')
  }

  // Parse token (128 bytes) - read until first null byte
  const tokenBuffer = buffer.subarray(
    HANDSHAKE_PROTOCOL_LENGTH,
    HANDSHAKE_LENGTH,
  )
  const nullIndex = tokenBuffer.indexOf(0)
  const token =
    nullIndex === -1
      ? tokenBuffer.toString('utf8')
      : tokenBuffer.subarray(0, nullIndex).toString('utf8')

  // Validate connection if callback provided
  if (validateConnection) {
    if (!(await validateConnection(token))) {
      throw new Error('Connection validation failed')
    }
  }

  return token
}

/**
 * Returns the absolute path to the native proxy executable.
 * Automatically adds the .exe suffix on Windows.
 *
 * @returns The absolute path to the process-proxy executable
 */
export function getProxyCommandPath(): string {
  // Get the directory of this module
  const moduleUrl = import.meta.url
  const modulePath = fileURLToPath(moduleUrl)
  const moduleDir = dirname(modulePath)

  // Navigate from dist/ to the project root, then to build/Release/
  const executableName =
    platform() === 'win32' ? 'process-proxy.exe' : 'process-proxy'

  return join(moduleDir, '..', 'build', 'Release', executableName)
}
