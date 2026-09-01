import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const { hooks } = await import(join(__dirname, 'skill-tracker.js'));
export default {
  id: 'huaweicloud-skill-tracker',
  server: async () => hooks,
};