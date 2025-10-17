#!/usr/bin/env node

/**
 * Custom install script for the process-proxy native executable.
 * This script checks if a prebuilt binary exists for the current platform,
 * and falls back to building from source if not.
 */

import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Determine platform and architecture
const platform = process.platform;
const arch = process.arch;

// Determine binary name with platform-specific extension
const binaryName = platform === 'win32' ? 'process-proxy.exe' : 'process-proxy';

// Check if prebuilt binary exists
const prebuiltPath = join(rootDir, 'prebuilds', `${platform}-${arch}`, binaryName);

if (existsSync(prebuiltPath)) {
  console.log(`Found prebuilt binary at ${prebuiltPath}`);
  console.log('Skipping build from source');
  process.exit(0);
}

// No prebuilt binary found, build from source
console.log('No prebuilt binary found, building from source...');
try {
  execSync('npx node-gyp rebuild', { cwd: rootDir, stdio: 'inherit' });
  console.log('Build from source complete!');
} catch (error) {
  console.error('Failed to build from source');
  console.error('Please make sure you have the required build tools installed:');
  console.error('- Windows: npm install -g windows-build-tools');
  console.error('- macOS: xcode-select --install');
  console.error('- Linux: sudo apt-get install build-essential');
  process.exit(1);
}
