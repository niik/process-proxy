export const getTargetArchs = (platform = process.platform) => {
  if (platform === 'darwin') {
    return ['x64', 'arm64']
  } else if (platform === 'win32') {
    return ['arm64', 'x64', 'ia32']
  } else if (platform === 'linux') {
    return ['x64', 'arm64']
  }
  throw new Error(`Unsupported platform: ${platform}`)
}
