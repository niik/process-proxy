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

export class ProcessProxyConnection extends EventEmitter {
  public readonly stdin: ReadStream
  public readonly stdout: WriteStream
  public readonly stderr: WriteStream

  private queue: Promise<unknown> = Promise.resolve()
  private write: (data: Buffer | string) => Promise<void>

  public get closed(): boolean {
    return this.socket.closed
  }

  constructor(
    private readonly socket: Socket,
    public readonly token: string,
  ) {
    super()
    this.stdin = new ReadStream(this)
    this.stdout = new WriteStream(this, 'stdout')
    this.stderr = new WriteStream(this, 'stderr')

    this.socket.on('close', () => this.handleClose())
    this.socket.on('error', (error: Error) => this.handleError(error))

    this.write = promisify(this.socket.write).bind(this.socket)
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

  private read(length: number) {
    return readSocket(this.socket, length)
  }

  private async readLengthPrefixedString() {
    const lenBuf = await this.read(4)
    const strLen = lenBuf.readUInt32LE(0)
    const strBuf = await this.read(strLen)
    return strBuf.toString('utf8')
  }

  private async readUInt32(): Promise<number> {
    const buf = await this.read(4)
    return buf.readUInt32LE(0)
  }

  public async readStdin(maxBytes: number): Promise<Buffer | null> {
    const payload = Buffer.allocUnsafe(4)
    payload.writeUInt32LE(maxBytes, 0)

    const response = await this.sendCommand(
      CMD_READ_STDIN,
      payload,
      async () => {
        const statusBuf = await this.read(4)
        const status = statusBuf.readInt32LE(0)
        if (status < 0) {
          // stdin closed
          return null
        } else if (status === 0) {
          // No data available
          return Buffer.alloc(0)
        } else {
          // Data available
          return this.read(status)
        }
      },
    )

    return response
  }

  public closeStdin() {
    return this.sendSimpleCommand(CMD_CLOSE_STDIN)
  }

  public writeStdout(data: Buffer) {
    const payload = Buffer.allocUnsafe(4 + data.length)
    payload.writeUInt32LE(data.length, 0)
    data.copy(payload, 4)

    return this.sendCommand(CMD_WRITE_STDOUT, payload, () => Promise.resolve())
  }

  public closeStdout() {
    return this.sendSimpleCommand(CMD_CLOSE_STDOUT)
  }

  public writeStderr(data: Buffer) {
    const payload = Buffer.allocUnsafe(4 + data.length)
    payload.writeUInt32LE(data.length, 0)
    data.copy(payload, 4)

    return this.sendCommand(CMD_WRITE_STDERR, payload, () => Promise.resolve())
  }

  public closeStderr() {
    return this.sendSimpleCommand(CMD_CLOSE_STDERR)
  }

  private sendSimpleCommand(command: number): Promise<void> {
    return this.sendCommand(command, undefined, () => Promise.resolve())
  }

  private sendCommand<T>(
    command: number,
    payload: Buffer | undefined,
    readCb: () => Promise<T>,
  ): Promise<T> {
    const p = this.queue.then(async () => {
      // Build command packet
      const packet = Buffer.alloc(1 + (payload?.length ?? 0))
      packet.writeUInt8(command, 0)
      if (payload) {
        payload.copy(packet, 1)
      }

      await this.write(packet)

      const statusCode = await this.readUInt32()

      if (statusCode !== 0) {
        const errorMsg = await this.readLengthPrefixedString()
        throw new Error(errorMsg || `Unknown error ${statusCode} from proxy`)
      }

      return readCb()
    })

    this.queue = p
    return p
  }

  public async getArgs(): Promise<string[]> {
    return this.sendCommand(CMD_GET_ARGS, undefined, async () => {
      const count = await this.readUInt32()
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
      const count = await this.readUInt32()
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
    const payload = Buffer.allocUnsafe(4)
    payload.writeUInt32LE(code, 0)
    return this.sendCommand(CMD_EXIT, payload, () => Promise.resolve())
  }
}
