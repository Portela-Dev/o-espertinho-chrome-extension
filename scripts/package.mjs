import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { zipSync } from 'fflate';

const root = new URL('../', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('dist/manifest.json', root), 'utf8'));
const files = {};

async function collect(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, 'en'));
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    const source = new URL(entry.name, directory);
    if (entry.isDirectory()) await collect(new URL(`${entry.name}/`, directory), `${relative}/`);
    else if (entry.isFile()) files[relative] = [await readFile(source), { mtime: new Date('2020-01-01T00:00:00Z') }];
    else throw new Error(`Tipo de arquivo não permitido: ${relative}`);
  }
}

await collect(new URL('dist/', root));
const output = new URL('artifacts/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const filename = `o-espertinho-chrome-extension-${manifest.version}.zip`;
const zip = zipSync(files, { level: 9 });
await writeFile(new URL(filename, output), zip);
await writeFile(new URL('SHA256SUMS', output), `${createHash('sha256').update(zip).digest('hex')}  ${filename}\n`);
await writeFile(new URL('INSTALAR.txt', output), await readFile(new URL('docs/INSTALAR.txt', root)));
console.log(`Pacote pronto: artifacts/${filename}`);
