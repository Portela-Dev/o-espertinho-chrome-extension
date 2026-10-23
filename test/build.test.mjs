import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  cp,
  mkdir,
  symlink,
  unlink,
  rm,
  readFile,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

test("build valida backend e versao e nao inclui source maps de teste na producao", async () => {
  const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
  const temp = await mkdtemp(join(tmpdir(), "espertinho-extension-build-"));
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  const modules = join(temp, "node_modules");
  let linked = false;
  try {
    await mkdir(join(temp, "scripts"));
    for (const file of ["package.json", "tsconfig.json", "extension", "src"]) {
      await cp(join(root, file), join(temp, file), { recursive: true });
    }
    await cp(join(root, "scripts/build.mjs"), join(temp, "scripts/build.mjs"));
    await symlink(join(root, "node_modules"), modules, "junction");
    linked = true;
    const build = (url, args = [], environments) =>
      spawnSync(process.execPath, ["scripts/build.mjs", ...args], {
        cwd: temp,
        env: { ...process.env, BACKEND_URL: url, BACKEND_ENVIRONMENTS: environments ? JSON.stringify(environments) : '' },
        encoding: "utf8",
        windowsHide: true,
      });
    assert.equal(build("http://remote.test").status, 1);
    assert.equal(build("http://localhost:3000", ["--coverage"]).status, 0);
    assert.match(
      await readFile(join(temp, "dist/catalog-runtime.js"), "utf8"),
      /sourceMappingURL=data:/,
    );
    assert.equal(build("https://api.test").status, 0);
    assert.doesNotMatch(
      await readFile(join(temp, "dist/catalog-runtime.js"), "utf8"),
      /sourceMappingURL/,
    );
    const manifest = JSON.parse(
      await readFile(join(temp, "dist/manifest.json"), "utf8"),
    );
    assert.deepEqual(manifest.host_permissions, ["https://api.test/*"]);
    const environments = [{id:'local',label:'Local',url:'http://localhost:3000'}, {id:'production',label:'Produção',url:'https://api.test'}];
    assert.equal(build('https://api.test', [], environments).status, 0);
    assert.deepEqual(JSON.parse(await readFile(join(temp,'dist/manifest.json'),'utf8')).host_permissions,['http://localhost:3000/*','https://api.test/*']);
    assert.match(await readFile(join(temp,'dist/config.js'),'utf8'), /BACKEND_ENVIRONMENTS/);
    for (const invalid of [[], [...environments,environments[0]], [{...environments[1],url:'http://remote.test'}], [{...environments[1],url:'https://api.test/path'}], [{...environments[1],url:'https://user:secret@api.test'}]])
      assert.equal(build('https://api.test', [], invalid).status, 1);
    const pkg = JSON.parse(await readFile(join(temp, "package.json"), "utf8"));
    pkg.version = "9.9.9";
    await writeFile(join(temp, "package.json"), JSON.stringify(pkg));
    assert.equal(build("https://api.test").status, 1);
  } finally {
    if (linked) {
      await unlink(modules);
    }
    await rm(temp, { recursive: true, force: true });
  }
});
