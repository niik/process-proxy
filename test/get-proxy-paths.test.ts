import { describe, it } from 'node:test'
import assert from 'node:assert'
import { getAllProxyCommandPaths } from '../src/index.js'

const cmp = <T>(x: T, y: T): number => (x < y ? -1 : x > y ? 1 : 0)

describe('getAllProxyCommandPaths', () => {
  it('should return the expected proxy command platform and arch combinations and nothing else', () => {
    const comands = getAllProxyCommandPaths()
      .sort((x, y) => cmp(x.platform, y.platform) || cmp(x.arch, y.arch))
      .map(({ platform, arch }) => ({ platform, arch }))

    const expected = [
      { platform: 'darwin', arch: 'arm64' },
      { platform: 'darwin', arch: 'x64' },
      { platform: 'linux', arch: 'arm64' },
      { platform: 'linux', arch: 'x64' },
      { platform: 'win32', arch: 'arm64' },
      { platform: 'win32', arch: 'ia32' },
      { platform: 'win32', arch: 'x64' },
    ]

    assert.deepStrictEqual(comands, expected)
  })
})
