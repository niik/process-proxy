import { Socket } from 'net'

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

    socket.on('readable', tryRead)
    socket.on('close', onClose)
    socket.on('error', onError)
    signal?.addEventListener('abort', onAbort)
  })
}
