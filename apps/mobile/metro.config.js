const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');
const { withNativeWind } = require('nativewind/metro');

const projectRoot = __dirname;
// pnpm workspace root — packages physically live in <root>/node_modules/.pnpm/
// and are symlinked into each workspace's own node_modules. Metro's default
// config only watches `projectRoot`, so without `watchFolders` + the extra
// `nodeModulesPaths` entry below, Metro can't see files reached through those
// symlinks even though plain Node `require.resolve` follows them fine — this
// is what caused "Unable to resolve module @babel/runtime/helpers/..." on a
// real device despite the file genuinely existing on disk.
const monorepoRoot = path.resolve(projectRoot, '../..');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [monorepoRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(monorepoRoot, 'node_modules'),
    ],
    unstable_enableSymlinks: true,
    unstable_enablePackageExports: true,
    // Belt-and-braces fallback: `nodeModulesPaths`/symlink support above
    // should be enough on their own, but pnpm's .pnpm-store symlink layout
    // tripped up Metro's own resolver in practice (a real, Node-resolvable
    // file reported as "could not be found"). `extraNodeModules` is an
    // older, simpler Metro option — for any bare package name Metro can't
    // otherwise place, hand it the real directory Node's own resolver
    // (proven correct above) says the package lives in.
    extraNodeModules: new Proxy(
      {},
      {
        get: (_target, packageName) => {
          try {
            const pkgJsonPath = require.resolve(`${packageName}/package.json`, {
              paths: [projectRoot],
            });
            return path.dirname(pkgJsonPath);
          } catch {
            return path.join(monorepoRoot, 'node_modules', packageName);
          }
        },
      },
    ),
  },
});

module.exports = withNativeWind(config, { input: './global.css' });
