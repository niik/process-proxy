import { Writable } from 'stream'
import type { ProcessProxyConnection } from './connection.js'

export class WriteStream extends Writable {
  constructor(
    private readonly writeCb: (data: Buffer) => Promise<void>,
    private readonly closeCb: () => Promise<void>,
  ) {
    super()
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
    this.writeCb(buffer).then(() => callback(), callback)
  }

  _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    this.closeCb()
      .then(() => callback(err), callback)
      .catch((closeErr) => callback(closeErr))
  }
}
