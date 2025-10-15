# ProcessProxy

A modern npm package (requiring Node 22+) written in TypeScript that enables developers to interact with a native executable, reading its stdin, writing to its stdout, and stderr streams, reading its exit code, arguments, current directory, and environment variables.

## ⚠️ Development Status

**This project is in early development and relies heavily on automated code generation using GitHub Copilot CLI.** While the implementation follows a clear design specification, it has not been extensively tested in production environments. Users should expect:

- Potential unexpected behaviors or edge cases
- Limited cross-platform testing (primarily tested on macOS arm64)
- Possible API changes as the project matures
- Incomplete error handling for all scenarios

**Use at your own risk.** Contributions, bug reports, and testing on different platforms are highly encouraged.

## Installation

```bash
npm install process-proxy
```

## Building

This package includes a native executable that must be built before use:

```bash
npm run build
```

This will compile both the TypeScript library and the native C executable.

## Usage

### Basic Example

```typescript
import { createProxyProcessServer, getProxyCommandPath } from 'process-proxy';
import { spawn } from 'child_process';
import { AddressInfo } from 'net';

// Create server with connection callback (idiomatic Node.js style)
const server = createProxyProcessServer((connection) => {
  console.log('Native process connected!');
  
  // Get process information
  connection.getArgs().then(args => console.log('Arguments:', args));
  connection.getEnv().then(env => console.log('Environment:', env));
  connection.getCwd().then(cwd => console.log('Working Directory:', cwd));
  
  // Write to the process stdout
  connection.stdout.write('Hello from ProcessProxy!\n');
  
  // Read from the process stdin
  connection.stdin.on('data', (data) => {
    console.log('Received from stdin:', data.toString());
  });
  
  // Handle disconnection
  connection.on('disconnect', () => {
    console.log('Process disconnected');
  });
});

// Start listening on a random port
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port);
  });
});

// Launch the native executable with the port in environment
const nativeExe = getProxyCommandPath();
const child = spawn(nativeExe, ['arg1', 'arg2'], {
  env: {
    ...process.env,
    PROCESS_PROXY_PORT: port.toString()
  }
});

// Later, close the server
// server.close();
```

### Proxying stdin/stdout/stderr

```typescript
server.on('connection', (connection) => {
  // Pipe process stdin to our stdin
  process.stdin.pipe(connection.stdout);
  
  // Pipe process stdout to our stdout
  connection.stdin.pipe(process.stdout);
  
  // Pipe process stderr to our stderr
  // (Note: stderr is a writable stream on the connection)
  connection.stderr.on('data', (data) => {
    process.stderr.write(data);
  });
});
```

### Controlling the Process

```typescript
server.on('connection', async (connection) => {
  // Exit the process with a specific code
  await connection.exit(0);
});
```

### Closing Streams

```typescript
server.on('connection', async (connection) => {
  // Close individual streams
  await connection.stdin.close();
  await connection.stdout.close();
  await connection.stderr.close();
});
```

## API

### createProxyProcessServer()

Creates a TCP server that listens for incoming connections from native processes. Returns a standard Node.js `net.Server` instance.

```typescript
import { createProxyProcessServer } from 'process-proxy';
import { AddressInfo } from 'net';

// Create server with connection callback
const server = createProxyProcessServer((connection) => {
  console.log('New connection!');
  connection.getArgs().then(console.log);
});

// Start listening
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port);
  });
});

// Use standard server methods
server.on('listening', () => console.log('Server started'));
server.on('error', (err) => console.error('Server error:', err));
server.close(() => console.log('Server closed'));
```

**Parameters:**
- `listener: (connection: ProcessProxyConnection) => void` - Callback invoked for each incoming connection
- `options?: ServerOpts` - Optional Node.js server options (see `net.createServer`)

**Returns:** `Server` - A standard Node.js `net.Server` instance

### getProxyCommandPath()

Returns the absolute path to the native proxy executable.

```typescript
import { getProxyCommandPath } from 'process-proxy';

const executablePath = getProxyCommandPath();
// Returns: '/path/to/build/Release/process-proxy' (or .exe on Windows)
```

This utility function automatically:
- Resolves the correct path relative to the installed package
- Adds the `.exe` suffix on Windows
- Works regardless of where the package is installed

### ProcessProxyConnection

Represents a connection to a single instance of the native executable.

#### Properties

- `stdin: Readable` - Readable stream for the executable's stdin
- `stdout: Writable` - Writable stream for the executable's stdout
- `stderr: Writable` - Writable stream for the executable's stderr

#### Methods

- `sendCommand(command: number, payload?: Buffer): Promise<Buffer>` - Sends a raw command to the executable and returns the response
- `getArgs(): Promise<string[]>` - Retrieves the command line arguments of the executable
- `getEnv(): Promise<{ [key: string]: string }>` - Retrieves the environment variables of the executable
- `getCwd(): Promise<string>` - Retrieves the current working directory of the executable
- `exit(code: number): Promise<void>` - Exits the executable with the specified exit code

#### Events

- `disconnect` - Emitted when the connection is closed
- `error` - Emitted when an error occurs. Listener signature: `(error: Error) => void`

## Native Executable

The native executable is written in C and compiled using node-gyp. It connects to the TCP server specified by the `PROCESS_PROXY_PORT` environment variable.

### Building the Native Executable

The native executable is built automatically when running `npm run build` or `npm run build:native`.

### Usage

The native executable must be launched with the `PROCESS_PROXY_PORT` environment variable set:

```bash
PROCESS_PROXY_PORT=12345 ./build/Release/process-proxy [args...]
```

## Security

⚠️ **IMPORTANT SECURITY NOTE** ⚠️

The TCP server only listens on localhost (127.0.0.1), but this does not provide complete security. Other processes and users with access to the network stack on the host machine can potentially connect to the TCP server.

**You are responsible for implementing additional security measures** to ensure that only trusted processes can connect to the TCP server. Some suggestions:

1. **Generate a secret token** and pass it to the native executable via an environment variable
2. **Verify the token** on connection using `ProcessProxy.getEnv()` before allowing any further commands
3. **Use process isolation** techniques appropriate for your operating system
4. **Monitor connections** and disconnect unauthorized clients immediately

Example security implementation:

```typescript
import crypto from 'crypto';
import { createProxyProcessServer, getProxyCommandPath } from 'process-proxy';
import { spawn } from 'child_process';
import { AddressInfo } from 'net';

const secret = crypto.randomBytes(32).toString('hex');

const server = createProxyProcessServer(async (connection) => {
  try {
    const env = await connection.getEnv();
    
    if (env.PROCESS_PROXY_SECRET !== secret) {
      console.error('Unauthorized connection attempt!');
      await connection.exit(1);
      return;
    }
    
    // Connection is authenticated, proceed normally
    console.log('Authenticated connection established');
    
  } catch (error) {
    console.error('Error during authentication:', error);
    await connection.exit(1);
  }
});

// Start listening
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port);
  });
});

// Launch with secret
const child = spawn(getProxyCommandPath(), [], {
  env: {
    ...process.env,
    PROCESS_PROXY_PORT: port.toString(),
    PROCESS_PROXY_SECRET: secret
  }
});
```

## Platform Support

- Windows
- macOS
- Linux

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
