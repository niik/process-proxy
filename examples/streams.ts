import { AddressInfo } from 'net'
import { createProxyProcessServer, getProxyCommandPath } from '../src/index.js'
import { spawn } from 'child_process'

async function main() {
  // Create server with connection callback
  const server = createProxyProcessServer(async (connection) => {
    console.log('Native process connected!')

    try {
      // Test reading stdin from the process
      console.log('Testing stdin reading...')

      // Create a simple echo behavior: read from process stdin and write back to stdout
      connection.stdin.on('data', (data) => {
        console.log('Received from process stdin:', data.toString().trim())
        connection.stdout.write(`Echo: ${data.toString()}`)
      })

      connection.stdin.on('end', () => {
        console.log('Process stdin closed')
      })

      // Wait a bit then start sending data
      setTimeout(() => {
        console.log('Sending test data to stderr...')
        connection.stderr.write('This is an error message\n')

        console.log('Sending test data to stdout...')
        connection.stdout.write('Line 1\n')
        connection.stdout.write('Line 2\n')
        connection.stdout.write('Line 3\n')

        // Give time for output then exit
        setTimeout(async () => {
          console.log('Closing streams and exiting...')
          await connection.stdin.close()
          await connection.stdout.close()
          await connection.stderr.close()
          await connection.exit(0)

          setTimeout(() => {
            server.close(() => console.log('Server stopped'))
          }, 100)
        }, 1000)
      }, 500)
    } catch (error) {
      console.error('Error:', error)
    }
  })

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
  console.log(`ProcessProxy server started on port ${port}`)

  // Launch the native executable
  const nativeExe = getProxyCommandPath()

  const child = spawn(nativeExe, ['test'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
    },
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    console.log(`Native process exited with code ${code}`)
  })

  child.on('error', (error) => {
    console.error('Failed to start process:', error)
  })
}

main().catch(console.error)
