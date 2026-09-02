import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const status = execFileSync('git', ['status', '--porcelain', '--', 'dist'], {
  encoding: 'utf8',
});

assert.equal(status, '', 'dist is not synchronized with src; run pnpm build and commit the generated files.');
