import { EventEmitter } from 'events'
import { Socket } from 'net'
import { ReadStream } from './read-stream.js'
import { WriteStream } from './write-stream.js'
import { promisify } from 'util'
import { readSocket } from './read-socket.js'
import Stream from 'stream'

// Command identifiers
const CMD_GET_ARGS = 0x01
const CMD_READ_STDIN = 0x02
const CMD_WRITE_STDOUT = 0x03
const CMD_WRITE_STDERR = 0x04
const CMD_GET_CWD = 0x05
const CMD_GET_ENV = 0x06
const CMD_EXIT = 0x07
const CMD_CLOSE_STDIN = 0x09
const CMD_CLOSE_STDOUT = 0x0a
const CMD_CLOSE_STDERR = 0x0b

type Command =
  | typeof CMD_GET_ARGS
  | typeof CMD_READ_STDIN
  | typeof CMD_WRITE_STDOUT
  | typeof CMD_WRITE_STDERR
  | typeof CMD_GET_CWD
  | typeof CMD_GET_ENV
  | typeof CMD_EXIT
  | typeof CMD_CLOSE_STDIN
  | typeof CMD_CLOSE_STDOUT
  | typeof CMD_CLOSE_STDERR

export class ProcessProxyConnection extends EventEmitter {
  public readonly stdin: ReadStream
  public readonly stdout: WriteStream
  public readonly stderr: WriteStream

  private queue: Promise<unknown> = Promise.resolve()
  private write: (data: Buffer | string) => Promise<void>

  private hasSentExit: boolean = false

  public get closed(): boolean {
    return this.socket.closed
  }

  constructor(
    private readonly socket: Socket,
    public readonly token: string,
  ) {
    super()
    this.stdin = new ReadStream(this.readStdin.bind(this))
    this.stdout = new WriteStream(this.writeStdout.bind(this))
    this.stderr = new WriteStream(this.writeStderr.bind(this))

    this.stdin.on('close', this.closeStdin.bind(this))
    this.stdout.on('close', this.closeStdout.bind(this))
    this.stderr.on('close', this.closeStderr.bind(this))

    this.socket.on('close', this.handleClose.bind(this))
    this.socket.on('error', this.handleError.bind(this))

    this.write = promisify(this.socket.write).bind(this.socket)
  }

  private closeStream(
    command:
      | typeof CMD_CLOSE_STDIN
      | typeof CMD_CLOSE_STDOUT
      | typeof CMD_CLOSE_STDERR,
  ) {
    const noop = () => Promise.resolve()
    return this.sendCommand(
      command,
      undefined,
      noop,
      // We don't care if the connection is closed because that
      // means the stream is already closed.
      { onConnectionClosed: noop },
    )
  }

  private handleClose(): void {
    this.stdin.destroy()
    this.stdout.destroy()
    this.stderr.destroy()

    this.emit('close')
  }

  private handleError(error: Error): void {
    this.emit('error', error)
  }

  private async read<T>(length: number, fn: (buf: Buffer) => T): Promise<T> {
    const buf = await readSocket(this.socket, length)
    return fn(buf)
  }

  private readString = (length: number) =>
    this.read(length, (buf) => buf.toString('utf8'))

  private readLengthPrefixedString = () =>
    this.readUInt32LE().then(this.readString)

  private readUInt32LE = () => this.read(4, (buf) => buf.readUInt32LE(0))
  private readInt32LE = () => this.read(4, (buf) => buf.readInt32LE(0))

  private async readStdin(maxBytes: number): Promise<Buffer | null> {
    const payload = Buffer.allocUnsafe(4)
    payload.writeUInt32LE(maxBytes, 0)

    const response = await this.sendCommand(
      CMD_READ_STDIN,
      payload,
      async () => {
        const available = await this.readInt32LE()
        if (available < 0) {
          // stdin closed
          return null
        } else if (available === 0) {
          // No data available
          return Buffer.alloc(0)
        } else {
          // Data available
          return this.read(available, (buf) => buf)
        }
      },
    )

    return response
  }

  private closeStdin() {
    return this.closeStream(CMD_CLOSE_STDIN)
  }

  private writeStdout(data: Buffer) {
    const payload = Buffer.allocUnsafe(4 + data.length)
    payload.writeUInt32LE(data.length, 0)
    data.copy(payload, 4)

    return this.sendCommand(CMD_WRITE_STDOUT, payload, () => Promise.resolve())
  }

  public closeStdout() {
    return this.closeStream(CMD_CLOSE_STDOUT)
  }

  private writeStderr(data: Buffer) {
    const payload = Buffer.allocUnsafe(4 + data.length)
    payload.writeUInt32LE(data.length, 0)
    data.copy(payload, 4)

    return this.sendCommand(CMD_WRITE_STDERR, payload, () => Promise.resolve())
  }

  public closeStderr() {
    return this.closeStream(CMD_CLOSE_STDERR)
  }

  private sendCommand<T>(
    command: Command,
    payload: Buffer | undefined,
    readCb: () => Promise<T>,
    opts?: {
      onConnectionClosed?: () => Promise<T>
    },
  ): Promise<T> {
    const send = async () => {
      if (this.closed || this.hasSentExit) {
        if (opts?.onConnectionClosed) {
          return opts.onConnectionClosed()
        }
      }

      // Build command packet
      const packet = Buffer.alloc(1 + (payload?.length ?? 0))
      packet.writeUInt8(command, 0)
      if (payload) {
        payload.copy(packet, 1)
      }

      await this.write(packet)

      const statusCode = await this.readInt32LE()

      if (statusCode !== 0) {
        const errorMsg = await this.readLengthPrefixedString()
        throw new Error(errorMsg || `Unknown error ${statusCode} from proxy`)
      }

      this.hasSentExit ||= command === CMD_EXIT

      return readCb()
    }

    return (this.queue = this.queue.then(send, send))
  }

  public async getArgs(): Promise<string[]> {
    return this.sendCommand(CMD_GET_ARGS, undefined, async () => {
      const count = await this.readUInt32LE()
      const args: string[] = []
      for (let i = 0; i < count; i++) {
        const arg = await this.readLengthPrefixedString()
        args.push(arg)
      }
      return args
    })
  }

  public async getEnv(): Promise<{ [key: string]: string }> {
    return this.sendCommand(CMD_GET_ENV, undefined, async () => {
      const count = await this.readUInt32LE()
      const env: { [key: string]: string } = {}
      for (let i = 0; i < count; i++) {
        const envVar = await this.readLengthPrefixedString()
        const eqIndex = envVar.indexOf('=')
        if (eqIndex !== -1) {
          const key = envVar.substring(0, eqIndex)
          const value = envVar.substring(eqIndex + 1)
          env[key] = value
        }
      }
      return env
    })
  }

  public async getCwd(): Promise<string> {
    return this.sendCommand(CMD_GET_CWD, undefined, () =>
      this.readLengthPrefixedString(),
    )
  }

  public async exit(code: number): Promise<void> {
    this.stdout.end()
    this.stderr.end()

    const payload = Buffer.allocUnsafe(4)
    payload.writeInt32LE(code, 0)
    return this.sendCommand(CMD_EXIT, payload, () => Promise.resolve())
  }
}
