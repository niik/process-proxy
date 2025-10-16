import { createServer, ServerOpts, Socket } from 'net'
import { ProcessProxyConnection } from './connection.js'
export { ProcessProxyConnection } from './connection.js'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { platform } from 'os'

const HANDSHAKE_PROTOCOL = 'ProcessProxy 0001 '
const HANDSHAKE_PROTOCOL_LENGTH = 18
const HANDSHAKE_NONCE_LENGTH = 128
const HANDSHAKE_LENGTH = HANDSHAKE_PROTOCOL_LENGTH + HANDSHAKE_NONCE_LENGTH // 146 bytes
const HANDSHAKE_TIMEOUT = 500

export interface ProxyProcessServerOptions extends ServerOpts {
  /**
   * Optional callback to validate the connection nonce.
   * Receives the nonce string and should return a Promise<boolean>.
   * If false, the connection will be rejected.
   */
  validateConnection?: (nonce: string) => Promise<boolean>
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
  const { validateConnection, ...serverOpts } = options || {}
  
  return createServer(serverOpts, (socket) => {
    ensureValidHandshake(socket, validateConnection)
      .then(() => listener(new ProcessProxyConnection(socket)))
      .catch(() => socket.destroy())
  })
}

const ensureValidHandshake = (
  socket: Socket,
  validateConnection?: (nonce: string) => Promise<boolean>,
) => {
  return new Promise<Socket>(async (resolve, reject) => {
    let buffer = Buffer.allocUnsafe(0)

    const timeout = setTimeout(
      () => reject(new Error('timeout')),
      HANDSHAKE_TIMEOUT,
    )
    const onError = (error: Error) => {
      reject(error)
      clearTimeout(timeout)
    }

    const onClose = () => {
      reject(new Error('closed'))
      clearTimeout(timeout)
    }

    const onData = async (data: Buffer) => {
      buffer = Buffer.concat([buffer, data])

      if (buffer.length >= HANDSHAKE_LENGTH) {
        // Parse protocol header (18 bytes)
        const protocolHeader = buffer
          .subarray(0, HANDSHAKE_PROTOCOL_LENGTH)
          .toString('ascii')

        if (protocolHeader !== HANDSHAKE_PROTOCOL) {
          reject(new Error('Invalid handshake protocol'))
          return
        }

        // Parse nonce (128 bytes) - read until first null byte
        const nonceBuffer = buffer.subarray(
          HANDSHAKE_PROTOCOL_LENGTH,
          HANDSHAKE_LENGTH,
        )
        const nullIndex = nonceBuffer.indexOf(0)
        const nonce =
          nullIndex === -1
            ? nonceBuffer.toString('utf8')
            : nonceBuffer.subarray(0, nullIndex).toString('utf8')

        // Validate connection if callback provided
        if (validateConnection) {
          try {
            const isValid = await validateConnection(nonce)
            if (!isValid) {
              reject(new Error('Connection validation failed'))
              return
            }
          } catch (error) {
            reject(error)
            return
          }
        }

        clearTimeout(timeout)
        socket.off('data', onData)
        socket.off('close', onClose)
        socket.off('error', onError)

        // If there's data after the handshake, put it back
        if (buffer.length > HANDSHAKE_LENGTH) {
          socket.unshift(buffer.subarray(HANDSHAKE_LENGTH))
        }

        resolve(socket)
      }
    }

    socket.on('data', onData)
    socket.on('close', onClose)
    socket.on('error', onError)
  })
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
