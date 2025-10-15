# ProcessProxy

The plan is to create `ProcessProxy`, a modern npm package (requiring Node 22+) written in TypeScript that enables developers to interact with a native executable, reading its stdin, writing to its stdout, and stderr streams, reading its exit code, arguments, current directory, and environment variables.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Native executable

The native executable will be written in C and compiled using node-gyp. It will on launch attempt to connect to a TCP server running on localhost at a port specifed by the environment variable `PROCESS_PROXY_PORT`. If no such variable is set, it will exit with an error code and an error message written to its stderr.

If the connection is successful, it will immediately send a handshake to identify itself as a valid ProcessProxy client. The handshake is exactly 34 bytes of ASCII text: `ProcessProxy 0001 f10a7b06cf0f0896`. This consists of:

- Protocol name: "ProcessProxy" (12 bytes)
- Space separator (1 byte)
- Protocol version: "0001" (4 bytes)
- Space separator (1 byte)
- Magic string: "f10a7b06cf0f0896" (16 bytes)

After the handshake is sent, the executable will read commands from the TCP socket and execute them, sending the results back over the socket. If the connection fails, it will exit with an error code.

The executable will be cross-platform, supporting Windows, macOS, and Linux.

The protocol for communication between the executable and the TCP server will be a single byte command identifier followed by a per-command specific payload.

All commands return a response with the following format:

- Status code: 4-byte signed integer (0 for success, non-zero for error)
- If status code is non-zero (error):
  - Error message length: 4-byte unsigned integer
  - Error message: UTF-8 encoded string
- If status code is zero (success):
  - Command-specific response data (if any)

The commands will include:

- `0x01`: Read command line arguments
  - Payload: None
  - Response: 4-byte unsigned integer specifying the number of arguments, followed by each argument prefixed by a 4-byte unsigned integer specifying its length
- `0x02`: Read from stdin
  - Payload: 4-byte signed integer specifying the maximum number of bytes to read
  - Response: 4-byte signed integer specifying the number of bytes read, followed by the bytes read.
  - Implementation: This should be non-blocking, returning 0 bytes read if no data is available and -1 if stdin is closed.
- `0x03`: Write to stdout
  - Payload: 4-byte unsigned integer specifying the number of bytes to write, followed by the bytes to write
  - Response: None (only status code)
- `0x04`: Write to stderr
  - Payload: 4-byte unsigned integer specifying the number of bytes to write, followed by the bytes to write
  - Response: None (only status code)
- `0x05`: Read current working directory
  - Payload: None
  - Response: 4-byte unsigned integer specifying the length of the directory string, followed by the directory string. On Windows the current directory will be retrieved using GetCurrentDirectoryW. If the length is greater than MAX_PATH it will be shortened using GetShortPathNameW before being converted to UTF-8 using WideCharToMultiByte.
- `0x06`: Read environment variables
  - Payload: None
  - Response: 4-byte unsigned integer specifying the number of environment variables, followed by each variable prefixed by a 4-byte unsigned integer specifying its length
- `0x07`: Exit process
  - Payload: 4-byte signed integer specifying the exit code
  - Response: None (only status code, sent before exiting)
- `0x09`: Close stdin
  - Payload: None
  - Response: None (only status code)
- `0x0A`: Close stdout
  - Payload: None
  - Response: None (only status code)
- `0x0B`: Close stderr
  - Payload: None
  - Response: None (only status code)

## TypeScript library

The TypeScript library provides a high-level API for interacting with the native executable. It leverages Node.js's built-in `net` module for TCP server functionality and does not handle launching the native executable; that is the responsibility of the user of the library.

### createProxyProcessServer

A factory function that creates a standard Node.js `net.Server` configured to handle connections from the native executable. It accepts a callback that receives a `ProcessProxyConnection` instance for each incoming connection.

The function validates each connection by expecting a handshake within 500ms. The handshake must be exactly 34 bytes: `ProcessProxy 0001 f10a7b06cf0f0896`. Connections that don't send a valid handshake or don't send it within the timeout are immediately closed. This prevents random TCP connections from being processed.

```typescript
const server = createProxyProcessServer((connection) => {
  // Handle connection
})
```

The function is a thin wrapper around Node.js's `net.createServer()`, returning a standard `Server` instance that supports all native server methods like `listen()`, `close()`, event listeners, etc.

### ProcessProxyConnection

Represents a connection to a single instance of the native executable. Created automatically by `createProxyProcessServer` when a native process connects.

### ProcessProxyConnection

Represents a connection to a single instance of the native executable. Created automatically by `createProxyProcessServer` when a native process connects.

Methods:

- `on(event: 'close', listener: () => void)`: Registers an event listener for connection close events
- `on(event: 'error', listener: (error: Error) => void)`: Registers an event listener for error events
- `sendCommand(command: number, payload?: Buffer): Promise<Buffer>`: Sends a command to the executable and returns a promise that resolves with the response. The sendCommand will maintain an internal queue of commands to ensure that only one command is in-flight at a time.
- `getArgs(): Promise<string[]>`: Retrieves the command line arguments of the executable
- `getEnv(): Promise<{ [key: string]: string }>`: Retrieves the environment variables of the executable
- `getCwd(): Promise<string>`: Retrieves the current working directory of the executable
- `exit(code: number): Promise<void>`: Exits the executable with the specified exit code

Properties:

- `stdin`: Readable stream for the executable's stdin
- `stdout`: Writable stream for the executable's stdout
- `stderr`: Writable stream for the executable's stderr

The stdin/stdout/stderr streams are implemented using custom Stream derived classes (stdin implements stream.Readable and the others stream.Writable) which internally use the `sendCommand` method to read/write data. The streams support the close method to close the respective stream using the appropriate command.

The stdin stream will (as long as it's not paused) internally poll for stdin data using the `0x02` command and handle the response accordingly (e.g., emitting 'data' and 'close' events). The polling interval will be configurable, defaulting to 100ms.

## Security

While the TCP server will only be accessible on localhost additional security measures are necessary to prevent unauthorized access from other local processes and users with access to the network stack on the host machine. This library will initially not offer any such security measures but will note clearly in the README that the user of the library is responsible for ensuring that only trusted processes can connect to the TCP server, offering suggesstions such as generating a secret token and passing it to the native executable via an environment variable, which can then be accessed via ProcessProxy.getEnv() on connection and verified before allowing any further commands.

## Design document

As the project progresses, and the project changes in such a way that it conflicts with the contents of this design document the document should be updated to reflect the new reality. In a similar vein we should update the design document for significant architectural or implementation changes such as new commands being added. It should not however be used as a changelog document.

## Version control

As the project progresses, version control will be used to manage changes to the codebase. Commits should be atomic and descriptive, following best practices for commit messages.
