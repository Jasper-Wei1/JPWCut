#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { remotionInvocation } from "./platform.mjs";

const root = resolve(import.meta.dirname, "..");
const registry = JSON.parse(
  await readFile(join(root, "模板/模板索引.json"), "utf8"),
);
const remotionDir = join(root, "引擎/remotion");

for (const template of registry.templates) {
  const output = join(root, template.preview);
  await mkdir(dirname(output), { recursive: true });
  const invocation = remotionInvocation(remotionDir, [
    "still",
    template.compositionId,
    output,
    "--frame",
    String(template.previewFrame),
    "--props",
    JSON.stringify({ dataFile: template.dataFile }),
    "--overwrite",
  ]);
  await run(invocation.command, invocation.args);
  console.log(`模板预览已生成 ${template.id}：${template.preview}`);
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: remotionDir,
      stdio: "inherit",
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} 执行失败，退出码：${code}`));
    });
  });
}
