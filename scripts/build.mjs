import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const destination = new URL("../dist/", import.meta.url);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const manifest = JSON.parse(
  await readFile(
    new URL("../extension/manifest.json", import.meta.url),
    "utf8",
  ),
);
const envFile = new URL("../.env", import.meta.url);
if (existsSync(envFile)) process.loadEnvFile(fileURLToPath(envFile));
const backend = new URL(process.env.BACKEND_URL || "http://localhost:3000");
if (
  (backend.protocol !== "https:" &&
    !(
      backend.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(backend.hostname)
    )) ||
  backend.username ||
  backend.password ||
  backend.pathname !== "/" ||
  backend.search ||
  backend.hash
)
  throw new Error(
    "BACKEND_URL deve ser uma origem HTTPS ou localhost/127.0.0.1 HTTP.",
  );
const configuredEnvironments = process.env.BACKEND_ENVIRONMENTS ? JSON.parse(process.env.BACKEND_ENVIRONMENTS) : [
  { id: 'default', label: 'Padrão', url: backend.origin },
];
if (!Array.isArray(configuredEnvironments) || !configuredEnvironments.length || configuredEnvironments.length > 10)
  throw new Error('BACKEND_ENVIRONMENTS deve conter entre 1 e 10 ambientes.');
const environmentIds = new Set(), environmentOrigins = new Set();
function validEnvironmentIdentity(environment) {
  return environment && typeof environment.id === 'string' && /^[a-z][a-z0-9_-]{0,39}$/.test(environment.id) &&
    typeof environment.label === 'string' && environment.label.trim() && environment.label.length <= 60 && typeof environment.url === 'string';
}
const environments = configuredEnvironments.map(environment => {
  if (!validEnvironmentIdentity(environment))
    throw new Error('Ambiente inválido em BACKEND_ENVIRONMENTS.');
  const url = new URL(environment.url);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      environmentIds.has(environment.id) || environmentOrigins.has(url.origin))
    throw new Error('Ambientes devem ter IDs e origens únicos, com HTTPS ou HTTP local, sem caminho ou credenciais.');
  environmentIds.add(environment.id); environmentOrigins.add(url.origin);
  return { id: environment.id, label: environment.label.trim(), url: url.origin };
});
if (!environmentOrigins.has(backend.origin)) throw new Error('BACKEND_URL deve pertencer a BACKEND_ENVIRONMENTS.');
manifest.host_permissions = environments.map(environment => `${environment.url}/*`);

if (packageJson.version !== manifest.version) {
  throw new Error(
    "As versões de package.json e manifest.json devem ser iguais.",
  );
}

await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
await cp(new URL("../extension/", import.meta.url), destination, {
  recursive: true,
});

const compiler = spawnSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "-p",
    "tsconfig.json",
    ...(process.argv.includes("--coverage")
      ? ["--inlineSourceMap", "--inlineSources"]
      : []),
  ],
  {
    cwd: root,
    stdio: "inherit",
    windowsHide: true,
  },
);

if (compiler.error) throw compiler.error;
if (compiler.status !== 0) process.exit(compiler.status ?? 1);
await writeFile(
  new URL("config.js", destination),
  `export const DEFAULT_BACKEND_URL = ${JSON.stringify(backend.origin)};\nexport const BACKEND_ENVIRONMENTS = ${JSON.stringify(environments)};\n`,
);
await writeFile(
  new URL("manifest.json", destination),
  JSON.stringify(manifest, null, 2) + "\n",
);
console.log(`Extensão ${manifest.version} compilada em dist/.`);
