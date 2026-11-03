// The executable: always runs. Kept apart from cli.ts so tests can import that
// without starting it, and with no check on the script's name, which is a
// symlink (node_modules/.bin/pomodoso-plugin) when run through npx.
import { main } from './cli.ts';

void main(process.argv.slice(2)).then((code) => process.exit(code));
