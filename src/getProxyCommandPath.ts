import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { platform } from 'os';

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
