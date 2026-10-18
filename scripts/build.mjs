import { cp, mkdir, readFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = new URL('../dist/', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));

if (packageJson.version !== manifest.version) {
  throw new Error('As versões de package.json e manifest.json devem ser iguais.');
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL('../extension/', import.meta.url), destination, { recursive: true });

const compiler = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'], {
  cwd: root,
  stdio: 'inherit',
  windowsHide: true,
});

if (compiler.error) throw compiler.error;
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
console.log(`Extensão ${manifest.version} compilada em dist/.`);
