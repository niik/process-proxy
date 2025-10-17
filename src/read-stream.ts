import { Readable } from 'stream'
import { type ProcessProxyConnection } from './connection.js'

export class ReadStream extends Readable {
  private streaming: boolean = false
  private polling: boolean = false
  public pollingInterval = 100
  private pollingTimer?: NodeJS.Timeout

  constructor(private readonly connection: ProcessProxyConnection) {
    super()
  }

  _read(size: number): void {
    if (!this.streaming) {
      this.streaming = true
      this.stream()
    }
  }

  private async drainStdin() {
    let read = 0
    let data: Buffer | null = null
    do {
      // Read up to 8KB at a time
      data = await this.connection.readStdin(8192)

      // Handle closed stream
      if (data === null) {
        this.push(null)
        break
      }

      read += data.length

      // Push data to the stream, if push returns false, the stream is
      // closed, so stop polling
      if (data.length > 0 && !this.push(data)) {
        break
      }
    } while (data?.length > 0 && this.streaming)

    return read
  }

  private async stream() {
    while (this.streaming) {
      let data
      do {
        // Read up to 8KB at a time
        data = await this.connection.readStdin(8192)

        // Handle closed stream
        if (data === null) {
          this.push(null)
          this.streaming = false
          return
        }

        // Push data to the stream, if push returns false, the stream is
        // closed, so stop polling
        if (data.length > 0 && !this.push(data)) {
          break
        }
      } while (data?.length > 0 && this.streaming)

      if (!this.streaming) break
      await new Promise((resolve) => setTimeout(resolve, this.pollingInterval))
    }
  }

  _destroy(error: Error | null, callback: (error: Error | null) => void): void {
    this.streaming = false
    callback(error)
  }

  async close(): Promise<void> {
    this.streaming = false
    await this.connection.closeStdin()
    this.push(null)
  }
}
