// Example of a ProcessProxy that proxies any command and parameters given to
// the proxy executable to the actual command.
//
// To test this example, you can run:
//   npx tsx examples/proxy.ts
//
// Then in another terminal, run a command like:
//   ./Build/Release/

import { AddressInfo } from 'net'
import {
  createProxyProcessServer,
  getProxyCommandPath,
  ProcessProxyConnection,
} from '../src/index.js'
import { spawn } from 'child_process'
import { Writable } from 'stream'

const waitForWritableFinished = (stream: Writable) => {
  return new Promise<void>((resolve) => {
    if (stream.writableFinished) {
      resolve()
    } else {
      stream.once('finish', () => resolve())
    }
  })
}

const exitWithError = (
  connection: ProcessProxyConnection,
  message: string,
  exitCode = 1,
) => {
  return new Promise<void>((resolve, reject) => {
    connection.stderr.end(`${message}\n`, () => {
      connection.exit(exitCode).then(resolve, reject)
    })
  })
}

async function main() {
  const server = createProxyProcessServer(
    async (connection) => {
      const argv = await connection.getArgs()
      const env = await connection.getEnv()
      const cwd = await connection.getCwd()

      delete env.PROCESS_PROXY_PORT
      const cmd = argv.at(1)
      const args = argv.slice(2)

      const id = `${cmd}${args.length ? ' ' + args.join(' ') : ''}`

      if (!cmd) {
        console.error(`${id}: ERROR: No command provided to proxy`)
        await exitWithError(
          connection,
          `Error: No command provided to proxy\nUsage: ${argv[0]} <command> [args...]`,
        )
        return
      }

      connection.on('close', () => {
        if (child.connected) {
          console.log(`${id}: connection closed`)
          child.kill()
        }
        // TODO: Also ensure child process is killed?
      })

      const shortenedPath = process.env.HOME
        ? cwd.replace(process.env.HOME, '~')
        : cwd

      console.log(`${shortenedPath} $ ${cmd} ${args.join(' ')}`)

      const child = spawn(cmd, args, { env, cwd })
        .on('spawn', () => {
          // Pipe data between the native process and copilot
          connection.stdin.pipe(child.stdin)
          child.stdout.pipe(connection.stdout)
          child.stderr.pipe(connection.stderr)

          child.on('close', async (code, signal) => {
            // Ensure all data is flushed to the copilot before exiting
            // the connection
            await Promise.all([
              waitForWritableFinished(connection.stdout),
              waitForWritableFinished(connection.stderr),
            ])

            if (code !== 0) {
              console.log(`${id}: exiting proxy with code ${code}`)
            }
            await connection.exit(code ?? 0)
          })
        })
        .on('error', async (err) => {
          console.error(`${id}: Failed to start child:`, err)
          await exitWithError(
            connection,
            `Error: Failed to start command: ${err.message}`,
          )
        })
    },
    {
      validateConnection: process.env.PROCESS_PROXY_TOKEN
        ? async (token) => token === process.env.PROCESS_PROXY_TOKEN
        : undefined,
    },
  )

  const envPort = parseInt(process.env.PROCESS_PROXY_PORT ?? '0')
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(isNaN(envPort) ? 0 : envPort, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port)
    })
  })
  console.log(`ProcessProxy server started on port ${port}`)
}

main().catch(console.error)
