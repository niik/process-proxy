import { Readable } from 'stream';
import type { ProcessProxyConnection } from './connection.js';

const CMD_READ_STDIN = 0x02;
const CMD_CLOSE_STDIN = 0x09;

export class ReadStream extends Readable {
  private polling: boolean = false;
  public pollingInterval = 100;
  private pollingTimer?: NodeJS.Timeout;

  constructor(private readonly connection: ProcessProxyConnection) {
    super();
  }

  _read(size: number): void {
    if (!this.polling) {
      this.polling = true;
      this.startPolling();
    }
  }

  private startPolling(): void {
    if (!this.polling) {
      return;
    }

    this.pollingTimer = setTimeout(async () => {
      try {
        const payload = Buffer.allocUnsafe(4);
        payload.writeInt32LE(8192, 0); // Read up to 8KB at a time

        const response = await this.connection.sendCommand(CMD_READ_STDIN, payload);
        const bytesRead = response.readInt32LE(4); // Skip status code at offset 0

        if (bytesRead > 0) {
          const data = response.subarray(8, 8 + bytesRead); // Skip status (4) + bytesRead (4)
          const shouldContinue = this.push(data);
          if (shouldContinue && this.polling) {
            this.startPolling();
          }
        } else if (bytesRead < 0) {
          // stdin closed
          this.push(null);
          this.polling = false;
        } else {
          // No data available, continue polling
          if (this.polling) {
            this.startPolling();
          }
        }
      } catch (error) {
        this.destroy(error as Error);
        this.polling = false;
      }
    }, this.pollingInterval);
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.polling = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    callback(error);
  }

  async close(): Promise<void> {
    this.polling = false;
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer);
      this.pollingTimer = undefined;
    }
    await this.connection.sendCommand(CMD_CLOSE_STDIN);
    this.push(null);
  }
}
