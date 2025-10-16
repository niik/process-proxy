import { Readable } from 'stream'
import { type ProcessProxyConnection } from './connection.js'

export class ReadStream extends Readable {
  private polling: boolean = false
  public pollingInterval = 100
  private pollingTimer?: NodeJS.Timeout

  constructor(private readonly connection: ProcessProxyConnection) {
    super()
  }

  _read(size: number): void {
    if (!this.polling) {
      this.polling = true
      this.startPolling()
    }
  }

  private startPolling(): void {
    if (!this.polling) {
      return
    }

    this.pollingTimer = setTimeout(async () => {
      try {
        // Read up to 8KB at a time
        const data = await this.connection.readStdin(8192)

        // Handle closed stream
        if (data === null) {
          this.push(null)
          this.polling = false
          return
        }

        // Push data to the stream, if push returns false, the stream is
        // closed, so stop polling
        if (data.length > 0 && !this.push(data)) {
          return
        }

        if (this.polling) {
          this.startPolling()
        }
      } catch (error) {
        this.destroy(error as Error)
        this.polling = false
      }
    }, this.pollingInterval)
  }

  private stopPolling() {
    this.polling = false
    if (this.pollingTimer) {
      clearTimeout(this.pollingTimer)
      this.pollingTimer = undefined
    }
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.stopPolling()
    callback(error)
  }

  async close(): Promise<void> {
    this.stopPolling()
    await this.connection.closeStdin()
    this.push(null)
  }
}
