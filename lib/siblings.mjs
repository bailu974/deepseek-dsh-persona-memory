// 兄弟插件清单 —— 只列「真的能装到」的包，设置页用它做推荐位。
// 早期版本这里列了一串本仓私有插件（dsh-yu-*），外人装不到，容易误导，已删掉。
// 名字要与 package.json 的 name 一致（test/siblings.test.mjs 会核对）。
export const SIBLINGS = [
  {
    pkg: 'dsh-persona-memory',
    name: '鱼的记忆',
    desc: '人格蒸馏 + 日记：原料天天攒、人格按周期定型，日记记她自己在意的那几件事。',
  },
]

/** 除自己之外的兄弟（设置页推荐用）。 */
export function otherSiblings(selfPkg) {
  const 自己 = String(selfPkg || '')
  return SIBLINGS.filter((x) => x.pkg !== 自己)
}