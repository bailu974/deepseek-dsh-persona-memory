import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizeConfig, today, collectSnippets, runJournal } from '../journal.js';
import { collectFromSources } from '../lib/journal-sources.mjs';

function tmpDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `dsh-journal-${tag}-`));
}

test('normalizeConfig：坏值都有兜底', () => {
  const cfg = normalizeConfig({ runAt: '99:99', maxLines: 'x', maxSnippets: 1, minSnippets: -3 });
  assert.equal(cfg.runAt, '23:50');
  assert.equal(cfg.maxLines, 5);
  assert.equal(cfg.maxSnippets, 5);
  assert.equal(cfg.minSnippets, 1);
  assert.equal(cfg.enabled, true);
});

test('normalizeConfig：runAt 补零', () => {
  assert.equal(normalizeConfig({ runAt: '9:5' }).runAt, '09:05');
  assert.equal(normalizeConfig({ runAt: '23:50' }).runAt, '23:50');
});

test('today() 支持偏移', () => {
  assert.match(today(), /^\d{4}-\d{2}-\d{2}$/);
  assert.notEqual(today(), today(-1));
});

test('collectSnippets：只收白名单会话、去掉媒体与引用', () => {
  const dir = tmpDir('logs');
  const date = '2026-01-02';
  const lines = [
    '08:00:00 INFO [Event] 群 [測試群(111)] | [阿明(222)]: 今天吃米饭',
    '08:00:01 INFO [Event] 群 [別的群(999)] | [阿华(333)]: 不该出现的群',
    '08:00:02 INFO [Event] 私聊 [主人(444)]: [图片]',
    '08:00:03 INFO [Event] 私聊 [主人(444)]: 这个挺好的',
  ].join('\n');
  fs.writeFileSync(path.join(dir, `snowluma-${date}.log`), lines, 'utf8');

  const bridgeCfg = path.join(dir, 'bridge.json');
  fs.writeFileSync(bridgeCfg, JSON.stringify({ allow: { groups: ['111'], private: ['444'] } }), 'utf8');

  const snippets = collectSnippets(
    normalizeConfig({ snowlumaLogDir: dir, bridgeConfigPath: bridgeCfg }),
    date,
  );
  assert.equal(snippets.length, 2);
  assert.ok(snippets[0].includes('今天吃米饭'));
  assert.ok(snippets.some((s) => s.includes('这个挺好的')));
  assert.ok(!snippets.some((s) => s.includes('不该出现')));
});

test('collectSnippets：没配日志目录就返回空', () => {
  assert.deepEqual(collectSnippets(normalizeConfig({}), '2026-01-02'), []);
});

test('runJournal：片段不够就跳过，不碰模型', () => {
  const dir = tmpDir('skip');
  const journalDir = path.join(dir, 'journal');
  const logs = path.join(dir, 'logs');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'snowluma-2026-01-02.log'), '', 'utf8');

  const result = runJournal(
    normalizeConfig({ snowlumaLogDir: logs, journalDir, minSnippets: 5 }),
    { date: '2026-01-02', log: () => {} },
  );
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'not-enough-snippets');
  assert.equal(fs.existsSync(journalDir) ? fs.readdirSync(journalDir).length : 0, 0);
});

test('runJournal：已写过的日期直接跳过', () => {
  const dir = tmpDir('dup');
  const journalDir = path.join(dir, 'journal');
  fs.mkdirSync(journalDir, { recursive: true });
  fs.writeFileSync(path.join(journalDir, '2026-01.md'), '# 日记 · 2026-01\n\n## 2026-01-02\n\n写过了\n', 'utf8');

  const result = runJournal(normalizeConfig({ journalDir }), { date: '2026-01-02', log: () => {} });
  assert.equal(result.wrote, false);
  assert.equal(result.reason, 'already-written');
});

test('inbox 日档：一天一个文件', () => {
  const dir = tmpDir('inbox');
  fs.writeFileSync(path.join(dir, '2026-03-04.md'), '- 今天把那个 bug 修了\n- 晚饭吃了面\n', 'utf8');
  const snippets = collectFromSources(normalizeConfig({ sources: [{ type: 'inbox', dir, label: '工作' }] }), '2026-03-04');
  assert.equal(snippets.length, 2);
  assert.ok(snippets[0].startsWith('[工作] '));
});

test('inbox 月档 + 分节', () => {
  const dir = tmpDir('inbox2');
  fs.writeFileSync(path.join(dir, '2026-03.md'), '# 三月\n\n## 2026-03-04\n\n- 只属于 3-04 的事\n\n## 2026-03-05\n\n- 不该被读到\n', 'utf8');
  const snippets = collectFromSources(normalizeConfig({ sources: [{ type: 'inbox', dir }] }), '2026-03-04');
  assert.equal(snippets.length, 1);
  assert.ok(snippets[0].includes('只属于'));
});

test('inbox markerOnly：只取 diary 标记之间', () => {
  const dir = tmpDir('inbox3');
  fs.writeFileSync(
    path.join(dir, '2026-03-04.md'),
    '- 私事不该进日记\n<!-- diary -->\n- 这条可以\n<!-- /diary -->\n- 这条也不行\n',
    'utf8',
  );
  const snippets = collectFromSources(normalizeConfig({ sources: [{ type: 'inbox', dir, markerOnly: true }] }), '2026-03-04');
  assert.equal(snippets.length, 1);
  assert.ok(snippets[0].includes('这条可以'));
});

test('多源合并：QQ 日志 + inbox 都进得去', () => {
  const root = tmpDir('multi');
  const logs = path.join(root, 'logs');
  const inbox = path.join(root, 'work');
  fs.mkdirSync(logs, { recursive: true });
  fs.mkdirSync(inbox, { recursive: true });
  fs.writeFileSync(path.join(logs, 'snowluma-2026-03-04.log'), '09:00:00 INFO [Event] 私聊 [主人(1)]: 群里的闲话\n', 'utf8');
  fs.writeFileSync(path.join(inbox, '2026-03-04.md'), '- 干活时想的一句话\n', 'utf8');
  const snippets = collectFromSources(
    normalizeConfig({
      sources: [
        { type: 'snowluma-log', dir: logs },
        { type: 'inbox', dir: inbox, label: '工作' },
      ],
    }),
    '2026-03-04',
  );
  assert.equal(snippets.length, 2);
  assert.ok(snippets.some((s) => s.includes('群里的闲话')));
  assert.ok(snippets.some((s) => s.includes('干活时想的一句话')));
});
