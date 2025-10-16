import { Writable } from 'stream'
import type { ProcessProxyConnection } from './connection.js'

export class WriteStream extends Writable {
  private connection: ProcessProxyConnection

  constructor(
    connection: ProcessProxyConnection,
    private readonly streamKind: 'stdout' | 'stderr',
  ) {
    super()
    this.connection = connection
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)

    const p =
      this.streamKind === 'stdout'
        ? this.connection.writeStdout(buffer)
        : this.connection.writeStderr(buffer)

    p.then(() => callback()).catch((error) => callback(error))
  }

  async close(): Promise<void> {
    // TODO: does close get a callback?
    await (this.streamKind === 'stdout'
      ? this.connection.closeStdout()
      : this.connection.closeStderr())
    this.end()
  }
}
