// 三体文明演化
// ------------------------------------------------------------
// 致敬原著：三体人在乱纪元"脱水"储存，在恒纪元"浸泡"复苏；
// 文明在恒纪元中发展，在极端灾变（烈焰、严寒、行星被吞没或抛射）中毁灭，
// 之后生命重新演化，开启下一轮文明。
// 发展时间已按比例压缩，以便在模拟时长内观察完整的兴衰。

export const STAGES = [
  { at: 0, name: '原始' },
  { at: 2, name: '石器时代' },
  { at: 5, name: '青铜时代' },
  { at: 9, name: '铁器时代' },
  { at: 14, name: '中世纪' },
  { at: 20, name: '蒸汽时代' },
  { at: 27, name: '电气时代' },
  { at: 35, name: '原子时代' },
  { at: 45, name: '信息时代' },
  { at: 60, name: '星际时代' },
];

const DESTROY = {
  hot: 420,    // 脱水的躯体也无法承受的高温（K）
  cold: 170,   // 大气开始冻结
};
const COLD_TOLERANCE = 3;  // 年：深寒持续多久后文明灭绝

export function stageOf(progress) {
  let s = STAGES[0], idx = 0;
  STAGES.forEach((st, i) => { if (progress >= st.at) { s = st; idx = i; } });
  return { ...s, index: idx, next: STAGES[idx + 1] };
}

export class Civilization {
  constructor() {
    this.number = 0;
    this.progress = 0;      // 恒纪元累计发展年数
    this.status = 'nascent'; // active 浸泡繁衍 | dehydrated 脱水 | extinct 毁灭 | nascent 等待生命重新演化
    this.coldTime = 0;
    this.best = 0;          // 历代文明最高进度
    this.history = [];      // 已毁灭文明 {number, progress, stage, cause, t}
  }

  /**
   * @returns {null | {type, text}} 发生的事件
   */
  update(t, dt, T, stableEra, planetAlive = true) {
    if (!planetAlive) {
      if (this.status !== 'extinct' && this.status !== 'gone') return this._destroy(t, '行星毁灭', 'gone');
      return null;
    }
    if (this.status === 'gone') return null;

    // 毁灭判定
    if (this.status !== 'extinct' && this.status !== 'nascent') {
      if (T > DESTROY.hot) return this._destroy(t, '烈日焚毁');
      this.coldTime = T < DESTROY.cold ? this.coldTime + dt : 0;
      if (this.coldTime > COLD_TOLERANCE) return this._destroy(t, '严寒冻灭');
    }

    switch (this.status) {
      case 'extinct':
      case 'nascent':
        // 毁灭后，待下一个恒纪元生命重新演化、新文明诞生
        if (stableEra) {
          this.number++;
          this.progress = 0;
          this.status = 'active';
          this.coldTime = 0;
          return { type: 'civ-born', text: `第 ${this.number} 号文明在恒纪元中诞生` };
        }
        return null;
      case 'active':
        if (!stableEra) {
          this.status = 'dehydrated';
          return { type: 'civ-dehydrate', text: `乱纪元降临，第 ${this.number} 号文明全体脱水` };
        }
        {
          const before = stageOf(this.progress);
          this.progress += dt;
          this.best = Math.max(this.best, this.progress);
          const after = stageOf(this.progress);
          if (after.index > before.index) {
            return { type: 'civ-stage', text: `第 ${this.number} 号文明进入${after.name}` };
          }
        }
        return null;
      case 'dehydrated':
        if (stableEra) {
          this.status = 'active';
          return { type: 'civ-rehydrate', text: `恒纪元到来，第 ${this.number} 号文明浸泡复苏` };
        }
        return null;
    }
    return null;
  }

  _destroy(t, cause, status = 'extinct') {
    const stage = stageOf(this.progress).name;
    this.history.push({ number: this.number, progress: this.progress, stage, cause, t });
    this.status = status;
    return { type: 'civ-destroyed', text: `第 ${this.number} 号文明毁灭于${cause}（${stage}）` };
  }
}
