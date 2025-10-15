import { EventEmitter } from 'events';
import { createServer, Server, Socket } from 'net';
import { ProcessProxyConnection } from './ProcessProxyConnection.js';

export class ProcessProxyServer extends EventEmitter {
  private server: Server | null = null;
  private port: number = 0;
  private connections: Set<ProcessProxyConnection> = new Set();
  private stdinPollingInterval: number;

  constructor(stdinPollingInterval: number = 100) {
    super();
    this.stdinPollingInterval = stdinPollingInterval;
  }

  public async start(port: number = 0): Promise<void> {
    if (this.server) {
      throw new Error('Server is already running');
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((socket: Socket) => {
        this.handleConnection(socket);
      });

      this.server.on('error', (error: Error) => {
        reject(error);
      });

      this.server.listen(port, '127.0.0.1', () => {
        const address = this.server!.address();
        if (address && typeof address === 'object') {
          this.port = address.port;
        }
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket): void {
    const connection = new ProcessProxyConnection(socket, this.stdinPollingInterval);
    this.connections.add(connection);

    connection.on('disconnect', () => {
      this.connections.delete(connection);
    });

    this.emit('connection', connection);
  }

  public async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    // Close all connections
    for (const connection of this.connections) {
      try {
        await connection.exit(0);
      } catch (error) {
        // Ignore errors when closing connections
      }
    }

    this.connections.clear();

    // Close server
    return new Promise((resolve) => {
      this.server!.close(() => {
        this.server = null;
        this.port = 0;
        resolve();
      });
    });
  }

  public getPort(): number {
    if (!this.server) {
      throw new Error('Server is not running');
    }
    return this.port;
  }
}
