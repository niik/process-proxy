import { createServer, ServerOpts, Socket } from 'net'
import { ProcessProxyConnection } from './connection.js'
export { ProcessProxyConnection } from './connection.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { readSocket } from './read-socket.js'
import { getTargetArchs } from '../script/get-target-archs.mjs'

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
 * Returns the absolute path to the native proxy executable suitable
 * for the current platform and architecture.
 *
 * @returns The absolute path to the process-proxy executable
 */
export function getProxyCommandPath(
  platform = process.platform,
  arch = process.arch,
): string {
  const moduleUrl = import.meta.url
  const modulePath = fileURLToPath(moduleUrl)
  const moduleDir = dirname(modulePath)

  const baseName = `process-proxy-${platform}-${arch}`
  const executableName = platform === 'win32' ? `${baseName}.exe` : baseName

  return join(moduleDir, '..', 'bin', executableName)
}

export type ProxyCommandDetails = {
  platform: string
  arch: string
  path: string
}

export const getAllProxyCommandPaths = (): ProxyCommandDetails[] => {
  const platforms = ['darwin', 'win32', 'linux'] as const

  return platforms.flatMap((platform) =>
    getTargetArchs(platform).map((arch) => {
      const path = getProxyCommandPath(platform, arch)
      return { platform, arch, path }
    }),
  )
}
