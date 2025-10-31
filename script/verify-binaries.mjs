import { access } from 'fs/promises'
import { join } from 'path'
import { getTargetArchs } from './get-target-archs.mjs'

const pathExists = (p) =>
  access(p)
    .then(() => true)
    .catch(() => false)

const platforms = ['darwin', 'win32', 'linux']
const expectedArtifacts = platforms
  .map((platform) => ({ platform, archs: getTargetArchs(platform) }))
  .flatMap(({ platform, archs }) =>
    archs.map((arch) => {
      const ext = platform === 'win32' ? '.exe' : ''
      return `process-proxy-${platform}-${arch}${ext}`
    }),
  )

const artifactStatus = await Promise.all(
  expectedArtifacts.map(async (filename) => ({
    filename,
    exists: await pathExists(join('bin', filename)),
  })),
)

for await (const { filename, exists } of artifactStatus) {
  console.log(`${filename}: ${exists ? '✅' : '❌'}`)
}

if (artifactStatus.some(({ exists }) => !exists)) {
  console.error('ERROR: Missing binaries')
  process.exit(1)
}
