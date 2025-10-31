import { spawn } from 'child_process'
import { copyFile, mkdir, readdir, rm, access } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { getTargetArchs } from './get-target-archs.mjs'

const projectDir = fileURLToPath(new URL('..', import.meta.url))
const rebuild = process.argv.includes('--rebuild')
const allArchs = process.argv.includes('--all-archs')
process.chdir(projectDir)

const pathExists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

if (await pathExists('bin')) {
  if (rebuild) {
    for (const file of await readdir('bin', { withFileTypes: true })) {
      if (file.isFile() && file.name.startsWith('process-proxy-')) {
        await rm(join('bin', file.name))
      }
    }
  }
} else {
  await mkdir('bin')
}

const archs = allArchs ? getTargetArchs() : [process.arch]

for (const arch of archs) {
  const ext = process.platform === 'win32' ? '.exe' : ''
  const filename = `process-proxy-${process.platform}-${arch}${ext}`
  const destination = join('bin', filename)

  if (!rebuild && (await pathExists(destination))) {
    console.log(
      `Binary already exists for architecture: ${arch}, skipping build.`,
    )
    continue
  }

  console.log(`Building for architecture: ${arch}`)

  await new Promise((resolve, reject) => {
    spawn(
      'node',
      [
        join('node_modules', 'node-gyp', 'bin', 'node-gyp.js'),
        'rebuild',
        '--silent',
        `--arch=${arch}`,
      ],
      {
        stdio: 'inherit',
      },
    )
      .on('close', async (code) => {
        if (code !== 0) {
          console.error(`Build failed for architecture: ${arch}`)
          process.exit(code)
        } else {
          console.log(`Build succeeded for architecture: ${arch}`)
          await copyFile(join('build', 'Release', filename), destination)
          resolve()
        }
      })
      .on('error', (err) => {
        console.error(`Error during build for architecture: ${arch}`, err)
        process.exit(1)
      })
  })
}
