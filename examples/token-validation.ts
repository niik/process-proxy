import { AddressInfo } from 'net'
import { createProxyProcessServer, getProxyCommandPath } from '../src/index.js'
import { spawn } from 'child_process'
import crypto from 'crypto'

async function main() {
  console.log('=== Testing Token-based Connection Validation ===\n')

  // Generate a random token for authentication
  const expectedToken = crypto.randomBytes(32).toString('hex')
  console.log(`Generated token: ${expectedToken}`)

  // Create server with token validation
  const server = createProxyProcessServer(
    async (connection) => {
      console.log('✅ Connection validated and established!')

      const args = await connection.getArgs()
      console.log('Arguments:', args)

      connection.stdout.write('Authentication successful!\n')

      setTimeout(async () => {
        await connection.exit(0)
        server.close(() => console.log('\nServer stopped'))
      }, 500)
    },
    {
      validateConnection: async (token: string) => {
        console.log(`Received token: ${token}`)
        const isValid = token === expectedToken
        console.log(`Validation result: ${isValid ? 'VALID' : 'INVALID'}`)
        return isValid
      },
    },
  )

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })

  console.log(`Server listening on port ${port}\n`)

  // Test 1: Valid token
  console.log('Test 1: Launching with VALID token...')
  const validChild = spawn(getProxyCommandPath(), ['test'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
      PROCESS_PROXY_TOKEN: expectedToken,
    },
    stdio: 'inherit',
  })

  validChild.on('exit', (code) => {
    console.log(`Process exited with code ${code}`)

    // Test 2: Invalid token
    setTimeout(() => {
      console.log('\nTest 2: Launching with INVALID token...')
      const invalidChild = spawn(getProxyCommandPath(), ['test'], {
        env: {
          ...process.env,
          PROCESS_PROXY_PORT: port.toString(),
          PROCESS_PROXY_TOKEN: 'wrong-token-12345',
        },
        stdio: 'inherit',
      })

      invalidChild.on('exit', (code) => {
        console.log(`❌ Process rejected (expected), exit code: ${code}`)

        // Test 3: No token
        setTimeout(() => {
          console.log('\nTest 3: Launching with NO token...')
          const noTokenChild = spawn(getProxyCommandPath(), ['test'], {
            env: {
              ...process.env,
              PROCESS_PROXY_PORT: port.toString(),
              // PROCESS_PROXY_TOKEN not set
            },
            stdio: 'inherit',
          })

          noTokenChild.on('exit', (code) => {
            console.log(
              `❌ Process rejected (expected), exit code: ${code || 'disconnect'}`,
            )
            setTimeout(() => {
              server.close(() => {
                console.log('\nAll tests complete!')
                process.exit(0)
              })
            }, 100)
          })
        }, 500)
      })
    }, 500)
  })
}

main().catch(console.error)
