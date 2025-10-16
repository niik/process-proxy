import { AddressInfo } from 'net'
import { createProxyProcessServer, getProxyCommandPath } from '../src/index.js'
import { spawn } from 'child_process'
import crypto from 'crypto'

async function main() {
  console.log('=== Testing Secret-based Connection Validation ===\n')

  // Generate a random secret for authentication
  const expectedSecret = crypto.randomBytes(32).toString('hex')
  console.log(`Generated secret: ${expectedSecret}`)

  // Create server with secret validation
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
      validateConnection: async (secret: string) => {
        console.log(`Received secret: ${secret}`)
        const isValid = secret === expectedSecret
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

  // Test 1: Valid secret
  console.log('Test 1: Launching with VALID secret...')
  const validChild = spawn(getProxyCommandPath(), ['test'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
      PROCESS_PROXY_SECRET: expectedSecret,
    },
    stdio: 'inherit',
  })

  validChild.on('exit', (code) => {
    console.log(`Process exited with code ${code}`)

    // Test 2: Invalid secret
    setTimeout(() => {
      console.log('\nTest 2: Launching with INVALID secret...')
      const invalidChild = spawn(getProxyCommandPath(), ['test'], {
        env: {
          ...process.env,
          PROCESS_PROXY_PORT: port.toString(),
          PROCESS_PROXY_SECRET: 'wrong-secret-12345',
        },
        stdio: 'inherit',
      })

      invalidChild.on('exit', (code) => {
        console.log(`❌ Process rejected (expected), exit code: ${code}`)

        // Test 3: No secret
        setTimeout(() => {
          console.log('\nTest 3: Launching with NO secret...')
          const noSecretChild = spawn(getProxyCommandPath(), ['test'], {
            env: {
              ...process.env,
              PROCESS_PROXY_PORT: port.toString(),
              // PROCESS_PROXY_SECRET not set
            },
            stdio: 'inherit',
          })

          noSecretChild.on('exit', (code) => {
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
