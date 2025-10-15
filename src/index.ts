import { createServer, ServerOpts } from 'net';
import { ProcessProxyConnection } from './connection.js';
export { ProcessProxyConnection } from './connection.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { platform } from 'os';

const HANDSHAKE = 'ProcessProxy 0001 f10a7b06cf0f0896';
const HANDSHAKE_LENGTH = 34;
const HANDSHAKE_TIMEOUT = 500;

/**
 * Creates a TCP server that listens for incoming connections from native processes.
 * 
 * Each connection is validated with a handshake before being wrapped in a ProcessProxyConnection
 * instance and passed to the listener callback.
 * 
 * @param listener A callback function that is invoked for each incoming connection.
 * @param options Optional server options (see Node.js net.createServer).
 * @returns A TCP server instance.
 */
export const createProxyProcessServer = (
  listener: (conn: ProcessProxyConnection) => void,
  options?: ServerOpts
) => createServer(options, (socket) => {
  let buffer = Buffer.allocUnsafe(0);
  let handshakeComplete = false;

  const timeout = setTimeout(() => {
    if (!handshakeComplete) {
      socket.destroy(new Error('Handshake timeout'));
    }
  }, HANDSHAKE_TIMEOUT);

  const onData = (data: Buffer) => {
    buffer = Buffer.concat([buffer, data]);

    if (buffer.length >= HANDSHAKE_LENGTH) {
      const handshakeData = buffer.subarray(0, HANDSHAKE_LENGTH);
      const receivedHandshake = handshakeData.toString('ascii');

      if (receivedHandshake !== HANDSHAKE) {
        socket.destroy(new Error('Invalid handshake'));
        return;
      }

      // Handshake valid
      handshakeComplete = true;
      clearTimeout(timeout);

      // Remove handshake listener
      socket.off('data', onData);

      // If there's data after the handshake, put it back
      if (buffer.length > HANDSHAKE_LENGTH) {
        const remainingData = buffer.subarray(HANDSHAKE_LENGTH);
        socket.unshift(remainingData);
      }

      // Create connection and pass to listener
      listener(new ProcessProxyConnection(socket));
    }
  };

  socket.on('data', onData);

  socket.on('close', () => {
    clearTimeout(timeout);
  });

  socket.on('error', () => {
    clearTimeout(timeout);
  });
});

/**
 * Returns the absolute path to the native proxy executable.
 * Automatically adds the .exe suffix on Windows.
 * 
 * @returns The absolute path to the process-proxy executable
 */
export function getProxyCommandPath(): string {
  // Get the directory of this module
  const moduleUrl = import.meta.url;
  const modulePath = fileURLToPath(moduleUrl);
  const moduleDir = dirname(modulePath);
  
  // Navigate from dist/ to the project root, then to build/Release/
  const executableName = platform() === 'win32' 
    ? 'process-proxy.exe' 
    : 'process-proxy';
  
  return join(moduleDir, '..', 'build', 'Release', executableName);
}
