import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { unzipSync, strFromU8 } from "fflate";

test("o pacote contém os recursos e solicita somente permissões para o executor configurável", async () => {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  for (const script of ["scripts/package.mjs"]) {
    const result = spawnSync(process.execPath, [script], {
      cwd,
      encoding: "utf8",
      windowsHide: true,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  }

  const directory = new URL("../artifacts/", import.meta.url);
  const filename = (await readdir(directory)).find((name) =>
    name.startsWith('o-espertinho-chrome-extension-') && name.endsWith(".zip"),
  );
  assert.ok(filename);
  const zip = await readFile(new URL(filename, directory));
  const files = unzipSync(zip);
  const manifest = JSON.parse(strFromU8(files["manifest.json"]));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.background.type, "module");
  assert.deepEqual(manifest.permissions, ["storage", "alarms", "scripting", "activeTab", "webRequest", "sidePanel"]);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, "popup.html?view=panel");
  assert.equal(manifest.optional_permissions,undefined);
  assert.equal(manifest.host_permissions.length, 1);
  assert.ok(!manifest.host_permissions.includes("<all_urls>"));
  assert.equal(manifest.content_scripts?.length ?? 0, 0);
  assert.match(
    manifest.content_security_policy.extension_pages,
    /script-src 'self'/,
  );
  assert.doesNotMatch(
    manifest.content_security_policy.extension_pages,
    /unsafe-eval|unsafe-inline/,
  );

  for (const path of [
    manifest.side_panel.default_path.split("?")[0],
    manifest.background.service_worker,
    "popup.js",
    "popup.css",
    "config.js",
    "contracts.js",
    "executor.js",
    "catalog-runtime.js",
    "catalog-product.js",
    "selector-picker.js",
    "picker-launcher.js",
    ...Object.values(manifest.icons),
  ]) {
    assert.ok(files[path]?.length > 0, `Arquivo necessário ausente: ${path}`);
  }
  for (const path of Object.keys(files)) {
    assert.doesNotMatch(
      path,
      /(^|\/)(node_modules|src|scripts|\.git|\.env)(\/|$)|\.(ts|pem|crx|map)$/,
    );
    assert.ok(!path.startsWith("/") && !path.split("/").includes(".."));
  }
  const checksums = await readFile(new URL("SHA256SUMS", directory), "utf8");
  assert.ok(checksums.startsWith(
    `${createHash("sha256").update(zip).digest("hex")}  ${filename}\n`,
  ));
  assert.equal((await readdir(directory)).filter(name=>name.endsWith('.zip')).length,1);
  assert.equal(checksums,createHash('sha256').update(zip).digest('hex')+'  '+filename+'\n');
  for(const path of ['ai-controller.js','ai-panel.js','offer-metadata.js','shared/openai-session.mjs','shared/analysis.mjs'])assert.ok(files[path],path);
  assert.ok(!Object.keys(files).some(path=>/local-ai|direct-ai/.test(path)));
  const popup = strFromU8(files[manifest.side_panel.default_path.split("?")[0]]);
  assert.match(popup, /src="popup\.js"/);
  assert.doesNotMatch(popup, /<script(?![^>]*\bsrc=)[^>]*>/i);
});
