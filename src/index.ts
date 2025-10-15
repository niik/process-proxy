import { createServer, ServerOpts } from 'net';
import { ProcessProxyConnection } from './connection.js';
export { ProcessProxyConnection } from './connection.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { platform } from 'os';

/**
 * Creates a TCP server that listens for incoming connections from native processes.
 * 
 * Each connection is wrapped in a ProcessProxyConnection instance and passed to the listener callback.
 * 
 * @param listener A callback function that is invoked for each incoming connection.
 * @param options Optional server options (see Node.js net.createServer).
 * @returns A TCP server instance.
 */
export const createProxyProcessServer = (
  listener: (conn: ProcessProxyConnection) => void,
  options?: ServerOpts
) => createServer(options, (c) => listener(new ProcessProxyConnection(c)));

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
