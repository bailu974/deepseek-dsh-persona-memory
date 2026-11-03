import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-ext-${tag}-`));
}

test('persona-journal 适配器：把日记变成蒸馏能扫的源', async () => {
  const home = tmpDir('home');
  const journalDir = path.join(home, 'my-journal');
  fs.mkdirSync(journalDir, { recursive: true });
  fs.writeFileSync(
    path.join(journalDir, '2026-11.md'),
    '# 日记 · 2026-11\n\n## 2026-11-01\n\n海边那片星星我差点就信了。\n最凉的是聊到一半才反应过来。\n\n## 2026-11-02\n\n今天把插件接上了多源。\n',
    'utf8',
  );
  fs.mkdirSync(path.join(home, 'persona-journal'), { recursive: true });
  fs.writeFileSync(
    path.join(home, 'persona-journal', 'config.json'),
    JSON.stringify({ journalDir }),
    'utf8',
  );

  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { syncExternalSources } = await import('../lib/external.mjs');
    const result = syncExternalSources().find((x) => x.id === 'persona-journal');
    assert.ok(result, '应该发现 persona-journal 适配器');
    assert.equal(result.active, true);
    assert.equal(result.entries, 2, '两天的日记应该切成 2 条');

    const digest = path.join(home, 'external-persona-journal', 'digest', 'persona-journal.md');
    assert.ok(fs.existsSync(digest), '应该生成 digest');
    const text = fs.readFileSync(digest, 'utf8');
    assert.ok(text.includes('2026-11-01'));
    assert.ok(text.includes('海边那片星星'));

    // voice.md 必须存在，否则蒸馏的「源读不出来」降级保护会整轮禁止定型
    const voice = path.join(home, 'external-persona-journal', 'voice.md');
    assert.ok(fs.existsSync(voice), 'voice.md 必须在');
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  }
});

test('日记目录不存在时适配器不激活', async () => {
  const home = tmpDir('empty');
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const { syncExternalSources } = await import('../lib/external.mjs');
    const result = syncExternalSources().find((x) => x.id === 'persona-journal');
    assert.equal(result.active, false);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prev;
  }
});
