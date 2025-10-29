import { Socket } from 'net'

/**
 * Reads a specified number of bytes from a given Socket.
 *
 * Waits until the requested number of bytes ('length') have been received from
 * the socket, then resolves with a Buffer containing the received data. If the
 * socket closes before all data is received, the promise is rejected with an
 * error. Optionally, accepts an AbortSignal to cancel the operation.
 *
 * @param {Socket} socket - The socket from which to read data.
 * @param {number} length - The exact number of bytes to read from the socket.
 * @param {AbortSignal} [signal] - Optional AbortSignal to cancel the operation.
 * @returns {Promise<Buffer>} Promise that resolves with a Buffer containing
 * 'length' bytes.
 * @throws {Error} If the socket closes before all data is read or if the
 * operation is aborted.
 */
export async function readSocket(
  socket: Socket,
  length: number,
  signal?: AbortSignal,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    signal?.throwIfAborted()

    const chunks: Buffer[] = []
    let bytesReceived = 0

    const tryRead = () => {
      while (bytesReceived < length) {
        const remaining = length - bytesReceived
        const chunk = socket.read(remaining) as Buffer | null

        if (chunk === null) {
          // No data available, wait for readable event
          return
        }

        chunks.push(chunk)
        bytesReceived += chunk.length

        if (bytesReceived >= length) {
          cleanup()
          resolve(Buffer.concat(chunks))
          return
        }
      }
    }

    const onClose = () => {
      cleanup()
      reject(new Error('Socket closed before receiving all data'))
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const onAbort = () =>
      onError(signal?.reason || new Error('Operation aborted'))

    const cleanup = () => {
      socket.off('readable', tryRead)
      socket.off('close', onClose)
      socket.off('error', onError)
      signal?.removeEventListener('abort', onAbort)
    }

    socket.on('close', onClose)
    socket.on('error', onError)
    socket.on('readable', tryRead)
    signal?.addEventListener('abort', onAbort)
  })
}
