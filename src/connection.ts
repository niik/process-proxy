import { EventEmitter } from 'events'
import { Socket } from 'net'
import { ReadStream } from './read-stream.js'
import { WriteStream } from './write-stream.js'
import { promisify } from 'util'
import { readSocket } from './read-socket.js'

const GET_ARGS = 0x01
const READ_STDIN = 0x02
const WRITE_STDOUT = 0x03
const WRITE_STDERR = 0x04
const GET_CWD = 0x05
const GET_ENV = 0x06
const EXIT = 0x07
const CLOSE_STDIN = 0x09
const CLOSE_STDOUT = 0x0a
const CLOSE_STDERR = 0x0b
const IS_STDIN_CONNECTED = 0x0c

type Command =
  | typeof GET_ARGS
  | typeof READ_STDIN
  | typeof WRITE_STDOUT
  | typeof WRITE_STDERR
  | typeof GET_CWD
  | typeof GET_ENV
  | typeof EXIT
  | typeof CLOSE_STDIN
  | typeof CLOSE_STDOUT
  | typeof CLOSE_STDERR
  | typeof IS_STDIN_CONNECTED

type CommandOptions<T = void> = {
  onBeforeSend?: () => Promise<void>
  onConnectionClosed?: () => Promise<T>
}

type CloseStreamCommand =
  | typeof CLOSE_STDIN
  | typeof CLOSE_STDOUT
  | typeof CLOSE_STDERR

type WriteStreamCommand = typeof WRITE_STDOUT | typeof WRITE_STDERR

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
  private write: (buf: Buffer) => Promise<void>

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
      this.closeStream.bind(this, CLOSE_STDIN),
    )
    this.stdout = new WriteStream(
      this.writeStream.bind(this, WRITE_STDOUT),
      this.closeStream.bind(this, CLOSE_STDOUT),
    )
    this.stderr = new WriteStream(
      this.writeStream.bind(this, WRITE_STDERR),
      this.closeStream.bind(this, CLOSE_STDERR),
    )

    this.socket.on('close', this.handleClose.bind(this))
    this.socket.on('error', this.handleError.bind(this))

    this.write = promisify(this.socket.write.bind(this.socket))
  }

  private closeStream(cmd: CloseStreamCommand) {
    return this.send(cmd, [], { onConnectionClosed: () => Promise.resolve() })
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
    return this.invoke(READ_STDIN, [uint32(maxBytes)], async () => {
      const available = await this.readInt32LE()
      // -1: stdin closed, 0: no data available
      if (available <= 0) {
        return available === 0 ? Buffer.alloc(0) : null
      }

      return this.read(available, (buf) => buf)
    })
  }

  private writeStream(cmd: WriteStreamCommand, data: Buffer) {
    return this.send(cmd, [uint32(data.length), data])
  }

  private send(cmd: Command, payload: Buffer[], opts?: CommandOptions) {
    return this.invoke(cmd, payload, () => Promise.resolve(), opts)
  }

  private invoke<T>(
    cmd: Command,
    payload: Buffer[],
    readCb: () => Promise<T>,
    opts?: CommandOptions<T>,
  ): Promise<T> {
    const handleInvoke = async () => {
      await opts?.onBeforeSend?.()

      if (this.closed || this.hasSentExit) {
        if (opts?.onConnectionClosed) {
          return opts.onConnectionClosed()
        }
      }

      await this.write(uint8(cmd))
      for (const p of payload) {
        await this.write(p)
      }

      const statusCode = await this.readInt32LE()

      if (statusCode !== 0) {
        const errorMsg = await this.readLengthPrefixedString()
        throw new Error(errorMsg || `Unknown error ${statusCode} from proxy`)
      }

      this.hasSentExit ||= cmd === EXIT

      return readCb()
    }

    return (this.queue = this.queue.then(handleInvoke, handleInvoke))
  }

  public async getArgs(): Promise<string[]> {
    return this.invoke(GET_ARGS, [], async () => {
      const count = await this.readUInt32LE()
      const args: string[] = []
      for (let i = 0; i < count; i++) {
        args.push(await this.readLengthPrefixedString())
      }
      return args
    })
  }

  public async getEnv(): Promise<Record<string, string>> {
    return this.invoke(GET_ENV, [], async () => {
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
    return this.invoke(GET_CWD, [], () => this.readLengthPrefixedString())
  }

  public async exit(code: number) {
    return this.send(EXIT, [int32(code)], {
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

  public async isStdinConnected(): Promise<boolean> {
    return this.invoke(IS_STDIN_CONNECTED, [], this.readInt32LE).then(Boolean)
  }
}
