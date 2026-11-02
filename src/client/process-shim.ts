/** 0.3.310's browser bundle reads process.env at import time.
 * Supply only inert browser defaults; never inject the Node host environment. */
const scope = globalThis as unknown as { process?: unknown };
scope.process ??= {
  env: {},
  platform: 'browser',
  versions: {},
  argv: [],
  cwd: () => '/',
  stdout: { isTTY: false, write: () => {} },
  stderr: { isTTY: false, write: () => {} },
  on: () => {},
  emitWarning: () => {},
};
