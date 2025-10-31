import { exec, execFile, spawn } from 'child_process'
import { copyFile, mkdir, readdir, rm, access } from 'fs/promises'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { promisify } from 'util'

const projectDir = fileURLToPath(new URL('..', import.meta.url))
process.chdir(projectDir)

const pathExists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

const getTargetArchs = () => {
  if (process.platform === 'darwin') {
    return ['x64', 'arm64']
  } else if (process.platform === 'win32') {
    return ['arm64', 'x64', 'ia32']
  } else if (process.platform === 'linux') {
    return ['x64', 'arm64']
  }
}

if (await pathExists('bin')) {
  for (const file of await readdir('bin', { withFileTypes: true })) {
    if (file.isFile() && file.name.startsWith('process-proxy-')) {
      await rm(join('bin', file.name))
    }
  }
} else {
  await mkdir('bin')
}

for (const arch of getTargetArchs()) {
  console.log(`Building for architecture: ${arch}`)

  await new Promise((resolve, reject) => {
    spawn('npx', ['node-gyp', 'rebuild', '--silent', `--arch=${arch}`], {
      stdio: 'inherit',
    })
      .on('close', async (code) => {
        if (code !== 0) {
          console.error(`Build failed for architecture: ${arch}`)
          process.exit(code)
        } else {
          console.log(`Build succeeded for architecture: ${arch}`)
          const ext = process.platform === 'win32' ? '.exe' : ''
          const filename = `process-proxy-${process.platform}-${arch}${ext}`

          await copyFile(
            join('build', 'Release', filename),
            join('bin', filename),
          )
          resolve()
        }
      })
      .on('error', (err) => {
        console.error(`Error during build for architecture: ${arch}`, err)
        process.exit(1)
      })
  })
}
