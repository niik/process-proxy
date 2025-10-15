import { EventEmitter } from 'events';
import { Socket } from 'net';
import { Readable, Writable } from 'stream';

// Command identifiers
const CMD_GET_ARGS = 0x01;
const CMD_READ_STDIN = 0x02;
const CMD_WRITE_STDOUT = 0x03;
const CMD_WRITE_STDERR = 0x04;
const CMD_GET_CWD = 0x05;
const CMD_GET_ENV = 0x06;
const CMD_EXIT = 0x07;
const CMD_CLOSE_STDIN = 0x09;
const CMD_CLOSE_STDOUT = 0x0A;
const CMD_CLOSE_STDERR = 0x0B;

interface QueuedCommand {
  command: number;
  payload?: Buffer;
  resolve: (value: Buffer) => void;
  reject: (error: Error) => void;
}

class StdinStream extends Readable {
  private connection: ProcessProxyConnection;
  private polling: boolean = false;
  private pollingInterval: number;
  private pollingTimer?: NodeJS.Timeout;

  constructor(connection: ProcessProxyConnection, pollingInterval: number = 100) {
    super();
    this.connection = connection;
    this.pollingInterval = pollingInterval;
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

class StdoutStream extends Writable {
  private connection: ProcessProxyConnection;

  constructor(connection: ProcessProxyConnection) {
    super();
    this.connection = connection;
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
      .sendCommand(CMD_WRITE_STDOUT, payload)
      .then(() => callback())
      .catch((error) => callback(error));
  }

  async close(): Promise<void> {
    await this.connection.sendCommand(CMD_CLOSE_STDOUT);
    this.end();
  }
}

class StderrStream extends Writable {
  private connection: ProcessProxyConnection;

  constructor(connection: ProcessProxyConnection) {
    super();
    this.connection = connection;
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
      .sendCommand(CMD_WRITE_STDERR, payload)
      .then(() => callback())
      .catch((error) => callback(error));
  }

  async close(): Promise<void> {
    await this.connection.sendCommand(CMD_CLOSE_STDERR);
    this.end();
  }
}

export class ProcessProxyConnection extends EventEmitter {
  private socket: Socket;
  private commandQueue: QueuedCommand[] = [];
  private processingQueue: boolean = false;
  private receiveBuffer: Buffer = Buffer.allocUnsafe(0);
  private currentCommand: QueuedCommand | null = null;
  private expectedResponseLength: number | null = null;

  public readonly stdin: StdinStream;
  public readonly stdout: StdoutStream;
  public readonly stderr: StderrStream;

  constructor(socket: Socket, stdinPollingInterval: number = 100) {
    super();
    this.socket = socket;
    this.stdin = new StdinStream(this, stdinPollingInterval);
    this.stdout = new StdoutStream(this);
    this.stderr = new StderrStream(this);

    this.socket.on('data', (data: Buffer) => this.handleData(data));
    this.socket.on('close', () => this.handleClose());
    this.socket.on('error', (error: Error) => this.handleError(error));
  }

  private handleData(data: Buffer): void {
    this.receiveBuffer = Buffer.concat([this.receiveBuffer, data]);
    this.processReceiveBuffer();
  }

  private processReceiveBuffer(): void {
    if (!this.currentCommand) {
      return;
    }

    // All commands now have at least a 4-byte status code
    if (this.receiveBuffer.length < 4) {
      return; // Need at least status code
    }

    // Read status code
    const statusCode = this.receiveBuffer.readInt32LE(0);

    if (statusCode !== 0) {
      // Error response - need status + error message length + error message
      if (this.receiveBuffer.length < 8) {
        return; // Need at least status + length
      }

      const errorMsgLen = this.receiveBuffer.readUInt32LE(4);
      const totalErrorLength = 4 + 4 + errorMsgLen; // status + length + message

      if (this.receiveBuffer.length < totalErrorLength) {
        return; // Need more data
      }

      const errorMsg = this.receiveBuffer.toString('utf8', 8, 8 + errorMsgLen);
      this.receiveBuffer = this.receiveBuffer.subarray(totalErrorLength);
      this.expectedResponseLength = null;

      const command = this.currentCommand;
      this.currentCommand = null;
      command.reject(new Error(`Command failed: ${errorMsg}`));

      this.processNextCommand();
      return;
    }

    // Success response - determine expected response length based on command
    if (this.expectedResponseLength === null) {
      // Start with 4 bytes for status code
      let expectedLength = 4;

      switch (this.currentCommand.command) {
        case CMD_GET_ARGS: {
          // Response: status + count (4 bytes) + each arg (4 bytes length + data)
          if (this.receiveBuffer.length < 8) {
            return; // Need at least status + count
          }
          const count = this.receiveBuffer.readUInt32LE(4);
          expectedLength += 4; // count
          let offset = 8;

          for (let i = 0; i < count; i++) {
            if (this.receiveBuffer.length < offset + 4) {
              return; // Need more data
            }
            const argLen = this.receiveBuffer.readUInt32LE(offset);
            expectedLength += 4 + argLen;
            offset += 4 + argLen;
          }

          this.expectedResponseLength = expectedLength;
          break;
        }

        case CMD_READ_STDIN: {
          // Response: status + bytes_read (4 bytes) + data
          if (this.receiveBuffer.length < 8) {
            return; // Need at least status + bytes_read
          }
          const bytesRead = this.receiveBuffer.readInt32LE(4);
          this.expectedResponseLength = 4 + 4 + Math.max(0, bytesRead);
          break;
        }

        case CMD_GET_CWD: {
          // Response: status + length (4 bytes) + string
          if (this.receiveBuffer.length < 8) {
            return; // Need at least status + length
          }
          const len = this.receiveBuffer.readUInt32LE(4);
          this.expectedResponseLength = 4 + 4 + len;
          break;
        }

        case CMD_GET_ENV: {
          // Response: status + count (4 bytes) + each env var (4 bytes length + data)
          if (this.receiveBuffer.length < 8) {
            return; // Need at least status + count
          }
          const count = this.receiveBuffer.readUInt32LE(4);
          expectedLength += 4; // count
          let offset = 8;

          for (let i = 0; i < count; i++) {
            if (this.receiveBuffer.length < offset + 4) {
              return; // Need more data
            }
            const varLen = this.receiveBuffer.readUInt32LE(offset);
            expectedLength += 4 + varLen;
            offset += 4 + varLen;
          }

          this.expectedResponseLength = expectedLength;
          break;
        }

        case CMD_WRITE_STDOUT:
        case CMD_WRITE_STDERR:
        case CMD_EXIT:
        case CMD_CLOSE_STDIN:
        case CMD_CLOSE_STDOUT:
        case CMD_CLOSE_STDERR:
          // These commands only return status code (no additional data on success)
          this.expectedResponseLength = 4;
          break;

        default:
          this.currentCommand.reject(new Error('Unknown command'));
          this.currentCommand = null;
          this.expectedResponseLength = null;
          this.processNextCommand();
          return;
      }
    }

    // Check if we have received the complete response
    if (this.receiveBuffer.length >= this.expectedResponseLength) {
      const response = this.receiveBuffer.subarray(0, this.expectedResponseLength);
      this.receiveBuffer = this.receiveBuffer.subarray(this.expectedResponseLength);
      this.expectedResponseLength = null;

      const command = this.currentCommand;
      this.currentCommand = null;
      command.resolve(response);

      this.processNextCommand();
    }
  }

  private handleClose(): void {
    if (this.currentCommand) {
      this.currentCommand.reject(new Error('Connection closed'));
      this.currentCommand = null;
    }

    for (const cmd of this.commandQueue) {
      cmd.reject(new Error('Connection closed'));
    }
    this.commandQueue = [];

    this.emit('disconnect');
  }

  private handleError(error: Error): void {
    this.emit('error', error);
  }

  public sendCommand(command: number, payload?: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      this.commandQueue.push({ command, payload, resolve, reject });
      this.processNextCommand();
    });
  }

  private processNextCommand(): void {
    if (this.processingQueue || this.currentCommand) {
      return;
    }

    if (this.commandQueue.length === 0) {
      return;
    }

    this.processingQueue = true;
    this.currentCommand = this.commandQueue.shift()!;

    // Build command packet
    const cmdByte = Buffer.from([this.currentCommand.command]);
    const packet = this.currentCommand.payload
      ? Buffer.concat([cmdByte, this.currentCommand.payload])
      : cmdByte;

    // Send command
    this.socket.write(packet, (error) => {
      this.processingQueue = false;

      if (error) {
        const cmd = this.currentCommand!;
        this.currentCommand = null;
        cmd.reject(error);
        this.processNextCommand();
        return;
      }

      // All commands now expect a response with status code
    });
  }

  public async getArgs(): Promise<string[]> {
    const response = await this.sendCommand(CMD_GET_ARGS);
    const args: string[] = [];
    let offset = 4; // Skip status code

    const count = response.readUInt32LE(offset);
    offset += 4;

    for (let i = 0; i < count; i++) {
      const len = response.readUInt32LE(offset);
      offset += 4;
      const arg = response.toString('utf8', offset, offset + len);
      offset += len;
      args.push(arg);
    }

    return args;
  }

  public async getEnv(): Promise<{ [key: string]: string }> {
    const response = await this.sendCommand(CMD_GET_ENV);
    const env: { [key: string]: string } = {};
    let offset = 4; // Skip status code

    const count = response.readUInt32LE(offset);
    offset += 4;

    for (let i = 0; i < count; i++) {
      const len = response.readUInt32LE(offset);
      offset += 4;
      const envVar = response.toString('utf8', offset, offset + len);
      offset += len;

      const eqIndex = envVar.indexOf('=');
      if (eqIndex !== -1) {
        const key = envVar.substring(0, eqIndex);
        const value = envVar.substring(eqIndex + 1);
        env[key] = value;
      }
    }

    return env;
  }

  public async getCwd(): Promise<string> {
    const response = await this.sendCommand(CMD_GET_CWD);
    const len = response.readUInt32LE(4); // Skip status code at offset 0
    return response.toString('utf8', 8, 8 + len);
  }

  public async exit(code: number): Promise<void> {
    const payload = Buffer.allocUnsafe(4);
    payload.writeInt32LE(code, 0);
    await this.sendCommand(CMD_EXIT, payload);
  }
}
