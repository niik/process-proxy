import { ProcessProxyServer, getProxyCommandPath } from '../dist/index.js';
import { spawn } from 'child_process';
import crypto from 'crypto';

async function main() {
  // Generate a secret token for authentication
  const secret = crypto.randomBytes(32).toString('hex');
  console.log('Generated secret token');

  // Create and start the server
  const server = new ProcessProxyServer();
  await server.start();

  const port = server.getPort();
  console.log(`ProcessProxy server started on port ${port}`);

  // Listen for connections
  server.on('connection', async (connection) => {
    console.log('Connection attempt detected...');

    try {
      // Get environment variables to check the secret
      const env = await connection.getEnv();

      if (env.PROCESS_PROXY_SECRET !== secret) {
        console.error('❌ Unauthorized connection attempt! Invalid secret.');
        await connection.exit(1);
        return;
      }

      console.log('✅ Connection authenticated successfully');

      // Get process information
      const args = await connection.getArgs();
      const cwd = await connection.getCwd();

      console.log('Process details:');
      console.log('  Arguments:', args);
      console.log('  Working Directory:', cwd);

      // Write to the process stdout
      connection.stdout.write('Authentication successful!\n');
      connection.stdout.write('You are now connected securely.\n');

      // Exit cleanly after a short delay
      setTimeout(async () => {
        console.log('Closing connection...');
        await connection.exit(0);

        setTimeout(async () => {
          await server.stop();
          console.log('Server stopped');
        }, 100);
      }, 1000);

    } catch (error) {
      console.error('Error during authentication:', error);
      try {
        await connection.exit(1);
      } catch {
        // Ignore errors
      }
    }
  });

  // Launch the native executable with the secret
  const nativeExe = getProxyCommandPath();

  const child = spawn(nativeExe, ['secure-mode'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
      PROCESS_PROXY_SECRET: secret
    },
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    console.log(`Native process exited with code ${code}`);
  });

  child.on('error', (error) => {
    console.error('Failed to start process:', error);
  });
}

main().catch(console.error);
