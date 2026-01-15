# ProcessProxy - Copilot Instructions

This is a TypeScript/C hybrid npm package that enables developers to interact with native executables through TCP-based IPC. The native C executable connects to a Node.js TCP server, allowing bidirectional communication of stdin/stdout/stderr streams, environment variables, command line arguments, and process control.

## Code Standards

### Required Before Each Commit

- Run `npm run lint` to check formatting with Prettier
- Run `npm run format` to auto-fix formatting issues
- Run `npm test` to ensure all tests pass

### Development Flow

- **Build everything**: `npm run build` (builds native C executable + TypeScript)
- **Build native only**: `npm run build:native` (use `npm run build:native -- --rebuild` to force rebuild)
- **Build TypeScript only**: `npm run build:ts`
- **Run tests**: `npm test`
- **Check formatting**: `npm run lint`
- **Fix formatting**: `npm run format`

### Running Examples

- `npm run example:basic` - Basic usage example
- `npm run example:streams` - Stream handling example
- `npm run example:proxy` - Proxy example
- `npm run example:secure` - Token authentication example

## Repository Structure

- `src/` - TypeScript source code for the Node.js library
  - `index.ts` - Main entry point, exports `createProxyProcessServer` and `getProxyCommandPath`
  - `connection.ts` - `ProcessProxyConnection` class handling protocol commands
  - `read-stream.ts` - Readable stream implementation for stdin
  - `write-stream.ts` - Writable stream implementation for stdout/stderr
  - `read-socket.ts` - Socket reading utilities
- `native/` - C source code for the native executable
  - `main.c` - Cross-platform native executable (Windows/macOS/Linux)
- `test/` - Test files using Node.js built-in test runner
- `examples/` - Usage examples
- `bin/` - Pre-built native binaries for distribution
- `build/` - node-gyp build output (generated)
- `dist/` - TypeScript compilation output (generated)
- `script/` - Build and verification scripts

## Key Guidelines

1. **Node.js 22+ required** - This package requires Node 22 or later
2. **ESM only** - The package uses ES modules (`"type": "module"`)
3. **Follow the design document** - See `design.md` for architectural decisions and protocol specification
4. **Update design.md** - When making significant architectural changes, update `design.md` to reflect the new reality
5. **Cross-platform support** - Native code must work on Windows, macOS, and Linux
6. **Protocol compliance** - All TCP communication must follow the binary protocol defined in `design.md`
7. **Security considerations** - Token-based authentication is critical; see Security section in README

## Design Document Maintenance

**IMPORTANT**: When making any changes to the API or protocol (e.g., adding/modifying commands, changing handshake format, updating TypeScript interfaces, or altering response formats), agents must verify that `design.md` remains accurate and up to date. If the changes conflict with or are not reflected in the design document, update it accordingly before completing the task.

## Protocol Overview

The native executable communicates via TCP with a 146-byte handshake followed by command/response messages:

- Commands are single-byte identifiers (0x01-0x0B) with command-specific payloads
- Responses include a 4-byte status code, optional error message, or command-specific data
- See `design.md` for complete protocol specification

## Testing

Tests use Node.js built-in test runner with `tsx`:

```bash
npm test
```

Test files are in `test/*.test.ts`. When adding new functionality:

- Add corresponding tests
- Ensure tests pass on all platforms (Ubuntu, macOS, Windows)
- Test timeout is 10 seconds per test

## Native Build

The native executable is built using node-gyp:

- Source: `native/main.c`
- Configuration: `binding.gyp`
- Output naming: `process-proxy-{platform}-{arch}` (e.g., `process-proxy-darwin-arm64`)
