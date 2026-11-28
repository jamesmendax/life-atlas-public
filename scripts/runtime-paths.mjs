import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
export const RUNTIME_ROOT = path.resolve(projectRoot, process.env.LIFE_ATLAS_RUNTIME || process.env.LIFE_ATLAS_BUILD_RUNTIME || '.harness/runtime');
