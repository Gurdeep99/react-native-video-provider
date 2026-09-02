'use strict';

/**
 * Prints a banner. Wrapped so it can NEVER fail a consumer's `npm install`
 * or native build — any error is swallowed and the process always exits 0.
 *
 * Run modes:
 *   node scripts/postinstall.js            → install banner (skipped in CI /
 *                                             non-interactive shells)
 *   node scripts/postinstall.js --force    → always print (used by the
 *                                             Android build so it shows while
 *                                             compiling the app, where stdout
 *                                             is not a TTY)
 */

const force =
  process.argv.includes('--force') || process.env.AU_VIDEO_BANNER === '1';

const BANNER = String.raw`
 __   __  ______      _______  ___   __    _  _______  __   __ 
|  |_|  ||    _ |    |       ||   | |  |  | ||       ||  | |  |
|       ||   | ||    |  _____||   | |   |_| ||    ___||  |_|  |
|       ||   |_||_   | |_____ |   | |       ||   | __ |       |
|       ||    __  |  |_____  ||   | |  _    ||   ||  ||       |
| ||_|| ||   |  | |   _____| ||   | | | |   ||   |_| ||   _   |
|_|   |_||___|  |_|  |_______||___| |_|  |__||_______||__| |__|
`;

try {
  const quiet = process.env.CI || process.env.npm_config_loglevel === 'silent';
  const show = force || (!quiet && process.stdout && process.stdout.isTTY);
  if (show) {
    const color = process.stdout && process.stdout.isTTY;
    const cyan = color ? '\x1b[36m' : '';
    const dim = color ? '\x1b[2m' : '';
    const reset = color ? '\x1b[0m' : '';
    process.stdout.write(cyan + BANNER + reset + '\n');
    process.stdout.write(
      dim +
        '  react-native-video-provider — one native player, many surfaces.\n' +
        '  Docs: https://github.com/gurdeep99/react-native-video-provider#readme\n' +
        reset +
        '\n'
    );
  }
} catch {
  // Never break an install over a banner.
}

process.exit(0);
