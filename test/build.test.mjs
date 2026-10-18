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
    const build = (url, args = []) =>
      spawnSync(process.execPath, ["scripts/build.mjs", ...args], {
        cwd: temp,
        env: { ...process.env, BACKEND_URL: url },
        encoding: "utf8",
        windowsHide: true,
      });
    assert.equal(build("http://remote.test").status, 1);
    assert.equal(build("http://localhost:3000", ["--coverage"]).status, 0);
    assert.match(
      await readFile(join(temp, "dist/runtime.js"), "utf8"),
      /sourceMappingURL=data:/,
    );
    assert.equal(build("https://api.test").status, 0);
    assert.doesNotMatch(
      await readFile(join(temp, "dist/runtime.js"), "utf8"),
      /sourceMappingURL/,
    );
    const manifest = JSON.parse(
      await readFile(join(temp, "dist/manifest.json"), "utf8"),
    );
    assert.deepEqual(manifest.host_permissions, ["https://api.test/*"]);
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
