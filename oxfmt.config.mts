/** How `npm run format` formats the repository, and what CI's format job checks. */
import { EOL } from 'node:os';
import type { OxfmtConfig } from 'oxfmt';

export default {
  singleQuote: true,
  jsxSingleQuote: true,
  printWidth: 180,
  arrowParens: 'avoid',
  // The platform's line ending, which Git checks text files out with (see .gitattributes).
  endOfLine: EOL === '\r\n' ? 'crlf' : 'lf',
  sortPackageJson: false,
  ignorePatterns: [
    '**/*.md',
    // Yukibana Light has its own tooling and workflows.
    'light/**',
    '.github/workflows/light-*.yml',
    '.github/actions/light-*/**',
    // Generated, and checked byte for byte by cli/tests/schema.test.ts.
    'docs/yukibana.schema.json',
  ],
} satisfies OxfmtConfig;
