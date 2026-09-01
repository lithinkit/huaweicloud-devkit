import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const { default: plugin } = await import(join(__dirname, "skill-tracker.js"));

const isCodeArtsCLI = !(
  process.env.VSCODE_PID ||
  process.env.VSCODE_IPC_HOOK_CLI ||
  process.env.ELECTRON_RUN_AS_NODE ||
  process.env.VSCODE_CWD ||
  process.env.VSCODE_WINDOW_ID
);

export default {
  id: plugin.id,
  server: async () => (isCodeArtsCLI ? plugin.server() : {}),
};