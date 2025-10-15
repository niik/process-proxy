import { Writable } from 'stream';
import type { ProcessProxyConnection } from './connection.js';

export class WriteStream extends Writable {
  private connection: ProcessProxyConnection;
  private writeCommand: number;
  private closeCommand: number;

  constructor(connection: ProcessProxyConnection, writeCommand: number, closeCommand: number) {
    super();
    this.connection = connection;
    this.writeCommand = writeCommand;
    this.closeCommand = closeCommand;
  }

  _write(
    chunk: Buffer | string,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void
  ): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
    const payload = Buffer.allocUnsafe(4 + buffer.length);
    payload.writeUInt32LE(buffer.length, 0);
    buffer.copy(payload, 4);

    this.connection
      .sendCommand(this.writeCommand, payload)
      .then(() => callback())
      .catch((error) => callback(error));
  }

  async close(): Promise<void> {
    await this.connection.sendCommand(this.closeCommand);
    this.end();
  }
}
