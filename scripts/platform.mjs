import { join } from "node:path";

export const isWindows = (platform = process.platform) => platform === "win32";

export const whisperExecutableName = (platform = process.platform) =>
  isWindows(platform) ? "main.exe" : "main";

export const whisperDirectory = (root) =>
  join(root, ".jpw-cache", "whisper.cpp");

export const remotionCliPath = (remotionDir) =>
  join(remotionDir, "node_modules", "@remotion", "cli", "remotion-cli.js");

// Running the JavaScript entry point directly avoids .cmd execution differences.
export const remotionInvocation = (remotionDir, args) => ({
  command: process.execPath,
  args: [remotionCliPath(remotionDir), ...args],
});

export const requiredPlatformTools = (platform = process.platform) =>
  isWindows(platform) ? ["powershell.exe"] : ["make"];

export const commandLocator = (platform = process.platform) =>
  isWindows(platform) ? "where.exe" : "which";
