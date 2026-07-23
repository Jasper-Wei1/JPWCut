import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  commandLocator,
  remotionInvocation,
  requiredPlatformTools,
  whisperExecutableName,
} from "./platform.mjs";

test("Windows 使用 .exe Whisper 二进制且不要求 Make", () => {
  assert.equal(whisperExecutableName("win32"), "main.exe");
  assert.deepEqual(requiredPlatformTools("win32"), ["powershell.exe"]);
  assert.equal(commandLocator("win32"), "where.exe");
});

test("Unix 使用 Make 和无扩展名 Whisper 二进制", () => {
  assert.equal(whisperExecutableName("darwin"), "main");
  assert.deepEqual(requiredPlatformTools("linux"), ["make"]);
  assert.equal(commandLocator("linux"), "which");
});

test("Remotion 始终通过 Node 直接执行 CLI 入口", () => {
  const remotionDir = join("workspace", "engine");
  const invocation = remotionInvocation(remotionDir, ["ffmpeg", "-version"]);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    join(
      remotionDir,
      "node_modules",
      "@remotion",
      "cli",
      "remotion-cli.js",
    ),
    "ffmpeg",
    "-version",
  ]);
});
