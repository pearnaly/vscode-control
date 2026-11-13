import { build } from 'esbuild';

const common = { bundle: true, platform: 'node', sourcemap: true, logLevel: 'info' };

// VS Code extension: CommonJS; `vscode` is provided by the extension host. node20: engines.vscode ^1.95
// allows VS Code 1.95, whose extension host runs Node 20.
await build({
  ...common,
  target: 'node20',
  entryPoints: ['extension/src/extension.ts'],
  format: 'cjs',
  outfile: 'extension/dist/extension.js',
  external: ['vscode'],
});

// MCP bridge: ESM with top-level await. The banner gives bundled CommonJS dependencies a working `require`.
await build({
  ...common,
  target: 'node22', // runs on the system Node; package.json engines: >=22.12
  entryPoints: ['bridge/src/index.ts'],
  format: 'esm',
  outfile: 'bridge/dist/index.js',
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
});
