// electron-builder's mac config sets identity:null (no real Developer ID
// available), which normally leaves the .app fully unsigned — on Apple
// Silicon that's a hard "damaged app" Gatekeeper block, not just a warning.
// Ad-hoc signing (identity "-") satisfies the OS's "must have some
// signature" check without needing a real cert/notarization.
const { execFileSync } = require('node:child_process')

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return
  const appPath = `${context.appOutDir}/${context.packager.appInfo.productFilename}.app`
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' })
}
