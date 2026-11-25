import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findPlaywright, launchBrowser, SetupError } from '../core/browser.mjs';

const ENV = 'VD_PLAYWRIGHT_FROM';
const readyDir = process.env[ENV];

function withEnv(value, fn) {
  const prev = process.env[ENV];
  if (value === undefined) delete process.env[ENV]; else process.env[ENV] = value;
  try { return fn(); } finally {
    if (prev === undefined) delete process.env[ENV]; else process.env[ENV] = prev;
  }
}

test('findPlaywright throws SetupError with hint when the dir is empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vd-empty-'));
  try {
    withEnv(dir, () => {
      assert.throws(() => findPlaywright(), (e) => {
        assert.ok(e instanceof SetupError);
        assert.ok(e.hint.includes('VD_PLAYWRIGHT_FROM'));
        return true;
      });
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('findPlaywright resolves a dir that has playwright-core',
  { skip: readyDir ? false : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core' },
  () => {
    const p = findPlaywright();
    assert.ok(existsSync(p), p);
  });

test('launchBrowser opens a data: page and closes',
  { skip: readyDir ? false : 'set VD_PLAYWRIGHT_FROM to a dir with node_modules/playwright-core' },
  async () => {
    const browser = await launchBrowser();
    try {
      const page = await browser.newPage();
      await page.goto('data:text/html,<p>x</p>');
      assert.equal(await page.textContent('p'), 'x');
    } finally { await browser.close(); }
  });
