// Run as a SessionStart hook by the smoke test: saves the session's cross-session messaging token
// to the file named in argv[2], so the test can post to the session's own inbox. The token is
// never printed.
import { writeFileSync } from 'node:fs';

writeFileSync(process.argv[2], process.env.CLAUDE_CODE_MESSAGING_TOKEN ?? '');
