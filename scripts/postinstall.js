'use strict';

/**
 * Prints a banner after install. Wrapped so it can NEVER fail a consumer's
 * `npm install` — any error is swallowed and the process always exits 0.
 * Skipped in CI and non-interactive shells to avoid polluting build logs.
 */

const BANNER = `
                                                                                       ++
                       +++                              +++                      +++++++++++    ++
      ++++++++++++++  ++++++++++         ++++++++++++++ +++                    +++++++ ++      +++
      ++    +++   +++ ++++++++++++       +++      +++++ ++++    +++++++   ++++ +++++++ ++      +++
      ++    +++   +++ ++++     +++       +++++++++++++  ++++ +++++ ++++ +++++  +++++++ ++      +++++++++++
      +++   +++   +++ ++++    ++++       +++    +++++++ +++++++    +++++++++    +++++++++      ++++    ++++
      ++++  +++   +++ ++++++++++         ++++++     +++ ++++++    +++++  +++           ++      +++      +++
      +++   ++    +++ ++++  +++          +++  ++++++++  ++++     ++++   +++      ++++ +++      +++      +++
                      ++++   ++++                       ++++    +++     ++      +++++ ++       +++     ++++
        +++++++               ++++                                      ++       ++++++         ++++++++++
     ++++ ++++        +         +++                       ++++        +                        +++++++++++
   +++   +++        ++++        +++++        ++++        +++        +++        ++++       ++++        +++
   ++++++++         ++           ++                       ++                             +++ +        ++
`;

try {
  const quiet = process.env.CI || process.env.npm_config_loglevel === 'silent';
  if (!quiet && process.stdout && process.stdout.isTTY) {
    const cyan = '\x1b[36m';
    const dim = '\x1b[2m';
    const reset = '\x1b[0m';
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
