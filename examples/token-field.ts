import { AddressInfo } from 'net'
import { createProxyProcessServer, getProxyCommandPath } from '../src/index.js'
import { spawn } from 'child_process'

async function main() {
  console.log('=== Testing Token Field on Connection ===\n')

  const myToken = 'my-secret-token-12345'

  const server = createProxyProcessServer((connection) => {
    console.log(`✅ Connection received`)
    console.log(`Token from connection.token: "${connection.token}"`)
    console.log(`Token length: ${connection.token.length} bytes\n`)

    connection.stdout.write(`Hello! Your token was: ${connection.token}\n`)

    setTimeout(async () => {
      await connection.exit(0)
      server.close(() => console.log('Server stopped'))
    }, 500)
  })

  const port = await new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })

  console.log(`Server listening on port ${port}`)
  console.log(`Launching with token: "${myToken}"\n`)

  const child = spawn(getProxyCommandPath(), ['test'], {
    env: {
      ...process.env,
      PROCESS_PROXY_PORT: port.toString(),
      PROCESS_PROXY_TOKEN: myToken,
    },
    stdio: 'inherit',
  })

  child.on('exit', (code) => {
    console.log(`\nProcess exited with code ${code}`)
  })
}

main().catch(console.error)
