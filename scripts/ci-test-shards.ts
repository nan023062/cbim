/** 按历史耗时的最长任务优先分配；权重只影响位置，不能筛掉未知或新增测试。 */
export function balancedShards<T>(items: readonly T[], count: number, key: (item:T)=>string, duration: (item:T)=>number): T[][] {
  if (!Number.isInteger(count) || count < 1) throw Error('Invalid shard count');
  const seen = new Set<string>();
  const weighted = items.map(item => {
    const id = key(item), weight = duration(item);
    if (!id || seen.has(id)) throw Error('Duplicate or missing test identity: ' + id);
    if (!Number.isFinite(weight) || weight <= 0) throw Error('Invalid test duration: ' + id);
    seen.add(id);
    return {item,id,weight};
  }).sort((a,b) => b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const bins = Array.from({length:count}, () => ({weight:0,items:[] as T[]}));
  for (const entry of weighted) {
    const target = bins.reduce((best, bin) => bin.weight < best.weight ? bin : best);
    target.items.push(entry.item);
    target.weight += entry.weight;
  }
  return bins.map(bin => bin.items);
}
