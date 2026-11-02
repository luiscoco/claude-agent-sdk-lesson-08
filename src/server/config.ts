import type { Options } from '@anthropic-ai/claude-agent-sdk';
import { CONFIG_DIRECTORY } from './paths.js';
export function childEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NonNullable<Options['env']> {
  const names = [
    'PATH',
    'Path',
    'PATHEXT',
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'SYSTEMROOT',
    'WINDIR',
    'COMSPEC',
    'TEMP',
    'TMP',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'OS',
    'SystemDrive',
    'CLAUDE_CODE_GIT_BASH_PATH',
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'SSL_CERT_FILE',
    'NODE_EXTRA_CA_CERTS',
    'ANTHROPIC_API_KEY',
  ];
  const env: Record<string, string> = {};
  for (const name of names) if (source[name]) env[name] = source[name]!;
  return { ...env, CLAUDE_CONFIG_DIR: CONFIG_DIRECTORY };
}
