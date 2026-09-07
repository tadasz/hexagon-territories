import { writeFileSync } from 'node:fs';
import { generateOpenApiSnapshot, SNAPSHOT_PATH } from './snapshot-lib.js';

/** `pnpm --filter @nature/api-schema snapshot`: regenerates packages/api-schema/openapi.json. */
const document = await generateOpenApiSnapshot();
writeFileSync(SNAPSHOT_PATH, document);
console.log(`wrote ${SNAPSHOT_PATH} (${document.length} bytes)`);
