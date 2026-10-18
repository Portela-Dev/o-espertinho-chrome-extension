import { spawnSync } from "node:child_process";
const commands = [
  ["scripts/build.mjs", "--coverage"],
  ["--test", "test/*.test.mjs"],
];
for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
