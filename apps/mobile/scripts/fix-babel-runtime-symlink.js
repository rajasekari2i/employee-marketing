#!/usr/bin/env node
/**
 * Metro (0.87.1, as used by this project's React Native version) fails to
 * resolve `@babel/runtime/helpers/*` subpaths when `apps/mobile/node_modules/
 * @babel/runtime` is a symlink into pnpm's central `.pnpm` store — even
 * though plain Node `require.resolve` follows the exact same symlink fine.
 * Every other symlinked dependency in this project resolves correctly
 * through Metro; this is specific to `@babel/runtime`, most likely an
 * interaction between Metro's resolver and that package's `package.json`
 * "exports" map. Confirmed by direct test: replacing the symlink with a
 * real directory copy (what this script does) makes the bundle build
 * succeed; leaving it as a symlink always reproduces "Unable to resolve
 * module @babel/runtime/helpers/interopRequireDefault ... could not be
 * found", even with watchFolders/nodeModulesPaths/extraNodeModules/
 * unstable_enableSymlinks/unstable_enablePackageExports all correctly
 * configured in metro.config.js.
 *
 * pnpm re-creates this symlink on every `pnpm install`, so this script runs
 * as apps/mobile's own `postinstall` to put a real copy back each time.
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', '@babel', 'runtime');

function main() {
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch {
    // Not installed (e.g. a partial/filtered install) — nothing to fix.
    return;
  }

  if (!stat.isSymbolicLink()) {
    return; // Already a real directory — a previous run of this script, or
    // a pnpm config that doesn't symlink it. Nothing to do.
  }

  const realDir = fs.realpathSync(target);
  fs.rmSync(target, { force: true });
  fs.cpSync(realDir, target, { recursive: true });

  console.log(
    `[fix-babel-runtime-symlink] Replaced symlinked @babel/runtime with a real copy (Metro resolution workaround) from ${realDir}`,
  );
}

main();
