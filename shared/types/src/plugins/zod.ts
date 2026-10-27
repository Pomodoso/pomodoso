// The one place plugins import zod from, so the config below runs before any
// schema is built — zod reads `jitless` when a schema is constructed, not when
// it parses, so setting it later (e.g. in index.ts) would be too late.
//
// zod v4 compiles validators with `new Function` when it can. Extension pages
// forbid that under MV3's CSP, and the Web Store's remote-code policy is the
// reason plugins are data in the first place — so never even probe for it.

import { z } from 'zod';

z.config({ jitless: true });

export { z };
