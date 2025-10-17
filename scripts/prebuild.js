#!/usr/bin/env node

/**
 * Custom prebuild script for the process-proxy native executable.
 * This script builds the native executable and copies it to the prebuilds directory.
 */

import { execSync } from 'child_process';
import { mkdirSync, copyFileSync, existsSync } from 'fs';
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

// Build the native executable
console.log('Building native executable...');
try {
  execSync('npx node-gyp rebuild', { cwd: rootDir, stdio: 'inherit' });
} catch (error) {
  console.error('Failed to build native executable');
  process.exit(1);
}

// Create prebuilds directory structure
const prebuildsDir = join(rootDir, 'prebuilds', `${platform}-${arch}`);
mkdirSync(prebuildsDir, { recursive: true });

// Copy the built executable to prebuilds
const sourcePath = join(rootDir, 'build', 'Release', binaryName);
const destPath = join(prebuildsDir, binaryName);

if (!existsSync(sourcePath)) {
  console.error(`Built executable not found at ${sourcePath}`);
  process.exit(1);
}

console.log(`Copying ${sourcePath} to ${destPath}`);
copyFileSync(sourcePath, destPath);

console.log('Prebuild complete!');
