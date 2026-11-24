import { embeddedAsset } from 'tracker:assets';
import { respond } from './http.ts';
import type { Database } from './store.ts';

export default {
  fetch(request: Request, env: { DB: Database }) {
    return respond(request, {
      mode: 'sites',
      db: env.DB,
      asset: embeddedAsset,
      // Only use this entry point behind Sites' identity-injecting dispatch.
      identity: incoming => incoming.headers.get('oai-authenticated-user-id')?.trim() || null,
    });
  },
};
