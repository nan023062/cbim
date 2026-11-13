import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {BaseSequencer, type TestSpecification} from 'vitest/node';
import {balancedShards} from './ci-test-shards';
import history from './ci-test-timings.json';

/** 使用 Vitest 实际发现的完整集合分片，保留默认排序、隔离和分片内串行策略。 */
export default class CiTestSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const shard = this.ctx.config.shard;
    if (!shard) return files;
    if (shard.index < 1 || shard.index > shard.count) throw Error('Invalid shard index');
    const fileName = (file:TestSpecification) => path.relative(this.ctx.config.root,file.moduleId).replaceAll('\\','/');
    const identity = (file:TestSpecification) => `${file.project.name}:${fileName(file)}`;
    const weights:Record<string,number> = history.weightsMs;
    // 新测试仍会执行；未知耗时保守计 30 秒，历史记录没有排除测试的权限。
    const duration = (file:TestSpecification) => weights[fileName(file)] ?? history.unknownMs;
    const bins = balancedShards(files,shard.count,identity,duration), selected = bins[shard.index - 1];
    if (process.env.CI) {
      const output = path.join(this.ctx.config.root,'test-results');
      fs.mkdirSync(output,{recursive:true});
      const all = files.map(identity).sort();
      fs.writeFileSync(path.join(output,`ci-shard-plan-${shard.index}.json`),JSON.stringify({
        schema:1,index:shard.index,count:shard.count,discovered:all.length,
        discoveredDigest:createHash('sha256').update(JSON.stringify(all)).digest('hex'),
        allFiles:all,files:selected.map(identity),estimatedMs:selected.reduce((sum,file)=>sum+duration(file),0),
      },null,2));
    }
    return selected;
  }
}
