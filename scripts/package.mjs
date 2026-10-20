import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("dist/manifest.json", root), "utf8"),
);
const files = {};

async function collect(directory, prefix = "") {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    const relative = `${prefix}${entry.name}`;
    const source = new URL(entry.name, directory);
    if (entry.isDirectory())
      await collect(new URL(`${entry.name}/`, directory), `${relative}/`);
    else if (entry.isFile())
      files[relative] = [
        await readFile(source),
        { mtime: new Date("2020-01-01T00:00:00Z") },
      ];
    else throw new Error(`Tipo de arquivo não permitido: ${relative}`);
  }
}

await collect(new URL("dist/", root));
const output = new URL("artifacts/", root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const filename = `o-espertinho-chrome-extension-${manifest.version}.zip`;
const zip = zipSync(files, { level: 9 });
await writeFile(new URL(filename, output), zip);
const helperFiles={};
for(const name of (await readdir(new URL('local-ai/',root))).filter(name=>name.endsWith('.mjs'))){
  helperFiles['local-ai/'+name]=[await readFile(new URL('local-ai/'+name,root)),{mtime:new Date('2020-01-01T00:00:00Z')}];
}
helperFiles['package.json']=Buffer.from(JSON.stringify({name:'o-espertinho-local-ai',private:true,type:'module',engines:{node:'>=24'},scripts:{'ai:helper':'node local-ai/start.mjs'}},null,2));
helperFiles['README.md']=await readFile(new URL('docs/AI-LOCAL.md',root));
const helperFilename=`o-espertinho-local-ai-${manifest.version}.zip`,helperZip=zipSync(helperFiles,{level:9});
await writeFile(new URL(helperFilename,output),helperZip);
await writeFile(
  new URL("SHA256SUMS", output),
  `${createHash("sha256").update(zip).digest("hex")}  ${filename}\n${createHash("sha256").update(helperZip).digest("hex")}  ${helperFilename}\n`,
);
await writeFile(
  new URL("INSTALAR.txt", output),
  await readFile(new URL("docs/INSTALAR.txt", root)),
);
console.log(`Pacote pronto: artifacts/${filename}`);
