import { Readable } from 'stream'
import { type ProcessProxyConnection } from './connection.js'

export class ReadStream extends Readable {
  public pollingInterval = 100

  constructor(
    private readonly readStdin: (maxBytes: number) => Promise<Buffer | null>,
  ) {
    super()
  }

  _read(size: number): void {
    this.readStdin(size)
      .then(async (data) => {
        while (data && data.length === 0 && this.readableFlowing) {
          await new Promise((resolve) =>
            setTimeout(resolve, this.pollingInterval),
          )
          if (!this.readableFlowing) {
            return
          }
          data = await this.readStdin(size)
        }

        this.push(data)
      })
      .catch((err) => this.destroy(err))
  }
}
