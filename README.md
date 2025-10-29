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
import { createProxyProcessServer, getProxyCommandPath } from 'process-proxy'
import { spawn } from 'child_process'
import { AddressInfo } from 'net'

// Create server with connection callback (idiomatic Node.js style)
const server = createProxyProcessServer((connection) => {
  console.log('Native process connected!')

  // Get process information
  connection.getArgs().then((args) => console.log('Arguments:', args))
  connection.getEnv().then((env) => console.log('Environment:', env))
  connection.getCwd().then((cwd) => console.log('Working Directory:', cwd))

  // Write to the process stdout
  connection.stdout.write('Hello from ProcessProxy!\n')

  // Read from the process stdin
  connection.stdin.on('data', (data) => {
    console.log('Received from stdin:', data.toString())
  })

  // Handle connection close
  connection.on('close', () => {
    console.log('Process disconnected')
  })
})

// Start listening on a random port
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port)
  })
})

// Launch the native executable with the port in environment
const nativeExe = getProxyCommandPath()
const child = spawn(nativeExe, ['arg1', 'arg2'], {
  env: {
    ...process.env,
    PROCESS_PROXY_PORT: port.toString(),
  },
})

// Later, close the server
// server.close();
```

### Proxying stdin/stdout/stderr

```typescript
server.on('connection', (connection) => {
  // Pipe process stdin to our stdin
  process.stdin.pipe(connection.stdout)

  // Pipe process stdout to our stdout
  connection.stdin.pipe(process.stdout)

  // Pipe process stderr to our stderr
  // (Note: stderr is a writable stream on the connection)
  connection.stderr.on('data', (data) => {
    process.stderr.write(data)
  })
})
```

### Controlling the Process

```typescript
server.on('connection', async (connection) => {
  // Exit the process with a specific code
  await connection.exit(0)
})
```

### Closing Streams

```typescript
server.on('connection', async (connection) => {
  connection.stdin.end()
})
```

## API

### createProxyProcessServer()

Creates a TCP server that listens for incoming connections from native processes. Returns a standard Node.js `net.Server` instance.

```typescript
import { createProxyProcessServer } from 'process-proxy'
import { AddressInfo } from 'net'

// Create server with connection callback
const server = createProxyProcessServer((connection) => {
  console.log('New connection!')
  connection.getArgs().then(console.log)
})

// Start listening
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port)
  })
})

// Use standard server methods
server.on('listening', () => console.log('Server started'))
server.on('error', (err) => console.error('Server error:', err))
server.close(() => console.log('Server closed'))
```

**Parameters:**

- `listener: (connection: ProcessProxyConnection) => void` - Callback invoked for each incoming connection
- `options?: ProxyProcessServerOptions` - Optional configuration object:
  - `validateConnection?: (token: string) => Promise<boolean>` - Optional callback to validate the connection token during handshake. Receives the token from the handshake and should return a Promise resolving to `true` to accept the connection or `false` to reject it.
  - All standard Node.js `net.ServerOpts` options are also supported

**Returns:** `Server` - A standard Node.js `net.Server` instance

### getProxyCommandPath()

Returns the absolute path to the native proxy executable.

```typescript
import { getProxyCommandPath } from 'process-proxy'

const executablePath = getProxyCommandPath()
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

- `close` - Emitted when the connection is closed
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

### Built-in Token Authentication

ProcessProxy includes a built-in authentication mechanism to validate connections during the handshake phase:

1. When the native executable connects, it sends a 146-byte handshake containing:
   - Protocol header: "ProcessProxy 0001 " (18 bytes)
   - Token: 128 bytes read from the `PROCESS_PROXY_TOKEN` environment variable

2. The server validates this handshake and can optionally verify the token using a `validateConnection` callback

3. If authentication fails, the connection is immediately closed before any commands are processed

**Using Token Authentication:**

```typescript
import crypto from 'crypto'
import { createProxyProcessServer, getProxyCommandPath } from 'process-proxy'
import { spawn } from 'child_process'
import { AddressInfo } from 'net'

// Generate a random token for this session
const expectedToken = crypto.randomBytes(32).toString('hex')

// Create server with token validation
const server = createProxyProcessServer(
  (connection) => {
    // Connection is already authenticated at this point
    console.log('Authenticated connection established')
  },
  {
    // Validate the token during handshake
    validateConnection: async (token) => {
      return token === expectedToken
    },
  },
)

// Start listening
const port = await new Promise<number>((resolve) => {
  server.listen(0, '127.0.0.1', () => {
    resolve((server.address() as AddressInfo).port)
  })
})

// Launch native executable with the token
const child = spawn(getProxyCommandPath(), ['arg1', 'arg2'], {
  env: {
    ...process.env,
    PROCESS_PROXY_PORT: port.toString(),
    PROCESS_PROXY_TOKEN: expectedToken, // Token passed to native process
  },
})
```

**How it works:**

- The native executable reads `PROCESS_PROXY_TOKEN` from its environment and includes it in the handshake
- The server calls your `validateConnection` callback with the received token
- If the callback returns `false` or rejects, the connection is immediately closed
- Authentication happens before any commands are processed, preventing unauthorized access

**Additional Security Recommendations:**

1. **Always use `validateConnection`** in production environments
2. **Generate unique tokens** per session using cryptographically secure random generators
3. **Use environment variables** to pass tokens (never hardcode them)
4. **Implement additional authorization** based on your application's security requirements
5. **Monitor for suspicious connection patterns** and implement rate limiting if needed

## Platform Support

- Windows
- macOS
- Linux

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
