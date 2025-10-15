import { ProcessProxyServer } from '../dist/index.js';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Create and start the server
  const server = new ProcessProxyServer();
  await server.start();

  const port = server.getPort();
  console.log(`ProcessProxy server started on port ${port}`);

  // Listen for connections
  server.on('connection', async (connection) => {
    console.log('Native process connected!');

    try {
      // Get process information
      const args = await connection.getArgs();
      const env = await connection.getEnv();
      const cwd = await connection.getCwd();

      console.log('Arguments:', args);
      console.log('Working Directory:', cwd);
      console.log('Environment variables count:', Object.keys(env).length);
      console.log('PROCESS_PROXY_PORT from env:', env.PROCESS_PROXY_PORT);

      // Write to the process stdout
      connection.stdout.write('Hello from ProcessProxy!\n');
      connection.stdout.write('This is a test message.\n');

      // Wait a bit then exit
      setTimeout(async () => {
        console.log('Exiting process...');
        await connection.exit(42);
        
        // Stop server after a short delay
        setTimeout(async () => {
          await server.stop();
          console.log('Server stopped');
        }, 100);
      }, 1000);

    } catch (error) {
      console.error('Error:', error);
    }
  });

  // Launch the native executable with the port in environment
  const nativeExe = join(__dirname, '..', 'build', 'Release', 'process-proxy-native');
  console.log(`Launching native executable: ${nativeExe}`);
  
  const child = spawn(nativeExe, ['arg1', 'arg2', 'arg3'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString()
    },
    stdio: 'inherit'
  });

  child.on('exit', (code) => {
    console.log(`Native process exited with code ${code}`);
  });
}

main().catch(console.error);
