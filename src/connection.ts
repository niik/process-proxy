import { EventEmitter } from 'events'
import { Socket } from 'net'
import { ReadStream } from './read-stream.js'
import { WriteStream } from './write-stream.js'
import { promisify } from 'util'
import { readSocket } from './read-socket.js'

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

const destroyIfNecessary = (...streams: (WriteStream | ReadStream)[]) => {
  streams.filter((x) => !x.destroyed).forEach((x) => x.destroy())
}

const buf = (length: number, fn: (buf: Buffer) => void) => {
  const buf = Buffer.alloc(length)
  fn(buf)
  return buf
}
const uint8 = (num: number) => buf(1, (b) => b.writeUInt8(num, 0))
const uint32 = (num: number) => buf(4, (b) => b.writeUInt32LE(num, 0))
const int32 = (num: number) => buf(4, (b) => b.writeInt32LE(num, 0))

export class ProcessProxyConnection extends EventEmitter {
  public readonly stdin: ReadStream
  public readonly stdout: WriteStream
  public readonly stderr: WriteStream

  private queue: Promise<unknown> = Promise.resolve()

  private hasSentExit: boolean = false

  public get closed(): boolean {
    return this.socket.closed
  }

  constructor(
    private readonly socket: Socket,
    public readonly token: string,
  ) {
    super()
    this.stdin = new ReadStream(
      this.readStdin.bind(this),
      this.closeStream.bind(this, CMD_CLOSE_STDIN),
    )
    this.stdout = new WriteStream(
      this.writeStream.bind(this, CMD_WRITE_STDOUT),
      this.closeStream.bind(this, CMD_CLOSE_STDOUT),
    )
    this.stderr = new WriteStream(
      this.writeStream.bind(this, CMD_WRITE_STDERR),
      this.closeStream.bind(this, CMD_CLOSE_STDERR),
    )

    this.socket.on('close', this.handleClose.bind(this))
    this.socket.on('error', this.handleError.bind(this))
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
      [],
      noop,
      // We don't care if the connection is closed because that
      // means the stream is already closed.
      { onConnectionClosed: noop },
    )
  }

  private handleClose(): void {
    destroyIfNecessary(this.stdin, this.stdout, this.stderr)
    this.emit('close')
  }

  private handleError(error: Error): void {
    this.emit('error', error)
  }

  private async read<T>(length: number, fn: (buf: Buffer) => T): Promise<T> {
    return fn(await readSocket(this.socket, length))
  }

  private readString = (length: number) =>
    this.read(length, (buf) => buf.toString('utf8'))

  private readLengthPrefixedString = () =>
    this.readUInt32LE().then(this.readString)

  private readUInt32LE = () => this.read(4, (buf) => buf.readUInt32LE(0))
  private readInt32LE = () => this.read(4, (buf) => buf.readInt32LE(0))

  private async readStdin(maxBytes: number): Promise<Buffer | null> {
    return this.sendCommand(CMD_READ_STDIN, [uint32(maxBytes)], async () => {
      const available = await this.readInt32LE()
      // -1: stdin closed, 0: no data available
      if (available <= 0) {
        return available === 0 ? Buffer.alloc(0) : null
      }

      return this.read(available, (buf) => buf)
    })
  }

  private writeStream(
    command: typeof CMD_WRITE_STDOUT | typeof CMD_WRITE_STDERR,
    data: Buffer,
  ) {
    return this.sendCommand(command, [uint32(data.length), data], () =>
      Promise.resolve(),
    )
  }

  private sendCommand<T>(
    command: Command,
    payload: Buffer[],
    readCb: () => Promise<T>,
    opts?: {
      onBeforeSend?: () => Promise<void>
      onConnectionClosed?: () => Promise<T>
    },
  ): Promise<T> {
    const send = async () => {
      await opts?.onBeforeSend?.()

      if (this.closed || this.hasSentExit) {
        if (opts?.onConnectionClosed) {
          return opts.onConnectionClosed()
        }
      }

      const packet = Buffer.concat([uint8(command), ...payload])

      await new Promise<void>((resolve, reject) =>
        this.socket.write(packet, (e) => (e ? reject(e) : resolve())),
      )

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
    return this.sendCommand(CMD_GET_ARGS, [], async () => {
      const count = await this.readUInt32LE()
      const args: string[] = []
      for (let i = 0; i < count; i++) {
        args.push(await this.readLengthPrefixedString())
      }
      return args
    })
  }

  public async getEnv(): Promise<Record<string, string>> {
    return this.sendCommand(CMD_GET_ENV, [], async () => {
      const count = await this.readUInt32LE()
      const env: Record<string, string> = {}
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
    return this.sendCommand(CMD_GET_CWD, [], () =>
      this.readLengthPrefixedString(),
    )
  }

  public async exit(code: number): Promise<void> {
    return this.sendCommand(CMD_EXIT, [int32(code)], () => Promise.resolve(), {
      onBeforeSend: () => {
        // Destroy the streams just before sending the exit command
        // to ensure that any pending writes queued before calling exit()
        // has been sent to the proxy process.
        destroyIfNecessary(this.stdin, this.stdout, this.stderr)
        return Promise.resolve()
      },
      onConnectionClosed: () => {
        return Promise.reject(new Error('Connection already closed'))
      },
    })
  }
}
