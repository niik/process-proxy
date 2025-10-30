import { Readable } from 'stream'

export class ReadStream extends Readable {
  public pollingInterval = 100

  constructor(
    private readonly readStdin: (maxBytes: number) => Promise<Buffer | null>,
    private readonly closeStdin: () => Promise<void>,
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

  _destroy(err: Error | null, callback: (error?: Error | null) => void): void {
    // TODO: Which error should we prioritize? The one from the destroy call or
    // the one from the closeStdin call?
    this.closeStdin()
      .then(() => callback(err))
      .catch((closeErr) => callback(closeErr))
  }
}
