import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const { default: plugin } = await import(join(__dirname, 'skill-tracker.js'));
export default plugin;