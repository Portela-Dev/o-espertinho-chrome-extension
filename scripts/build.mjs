import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import {existsSync} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = new URL('../dist/', import.meta.url);
const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
const envFile=new URL('../.env',import.meta.url);
if(existsSync(envFile))process.loadEnvFile(fileURLToPath(envFile));
const backend=new URL(process.env.BACKEND_URL||'http://localhost:3000');
if((backend.protocol!=='https:'&&!(backend.protocol==='http:'&&['localhost','127.0.0.1'].includes(backend.hostname)))||backend.username||backend.password||backend.pathname!=='/'||backend.search||backend.hash)throw new Error('BACKEND_URL deve ser uma origem HTTPS ou localhost/127.0.0.1 HTTP.');
manifest.host_permissions=[`${backend.origin}/*`];

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
await writeFile(new URL('config.js',destination),`export const DEFAULT_BACKEND_URL = ${JSON.stringify(backend.origin)};\n`);
await writeFile(new URL('manifest.json',destination),JSON.stringify(manifest,null,2)+'\n');
console.log(`Extensão ${manifest.version} compilada em dist/.`);
