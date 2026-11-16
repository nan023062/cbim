/**
 * 作用定位：Logic 证据层复核递归交付中已采集的普通文件基线，补足非结构化产物的字节验证。
 * 设计原因：复用原采集证据规则与受限文件端口；不重新采集、不生成证明、不把单文件集合称为完整业务验收。
 * 实现形式：无状态静态工具类，调用方负责原日志身份与工作区生命周期。
 */
import { fail } from '../../../core/errors';

import { verifyArtifactBaselines, type ArtifactEvidenceEvent } from '../rules/artifact-evidence';

import { artifactFileCheckSchema, type ArtifactBaselineStaged, type ArtifactFileFact, type ArtifactFileCheck } from '../rules/artifact-baseline';

export class AgentArtifactVerification
{
  /** 证据复核不持有独立状态，不允许实例化。 */
  private constructor()
  {
  }

  /** 仅复核当前仍有效的采集；历史采集失效且没有替代时拒绝，不使用当前字节补造新基线。 */
  public static async Verify(events: readonly ArtifactEvidenceEvent[], binding: ArtifactBaselineStaged['binding'], knowledgeRevision: string, normalizePath: (value: string) => string, checkFiles: (files: readonly ArtifactFileFact[], signal: AbortSignal) => Promise<ArtifactFileCheck[]>, signal: AbortSignal,): Promise<ArtifactFileFact[]>
  {
    signal.throwIfAborted();

    if (!events.some(event => event.type === 'artifact.baseline_captured' || event.type === 'tool.finished' && event.data.name === 'cbim_task_artifact_capture'))
      return [];

    const evidence = verifyArtifactBaselines(events, binding, knowledgeRevision, normalizePath);

    if (evidence.issues.some(issue => ['ARTIFACT_LOG_INVALID', 'ARTIFACT_BASELINE_INVALID', 'ARTIFACT_LIMIT'].includes(issue.code)))
      fail('ARTIFACT_EVIDENCE_INVALID', '原文件采集没有完整可信证据');

    const active = new Set(evidence.refs.filter(ref => !ref.invalidated).map(ref => ref.baselineId));

    if (!active.size)
      fail('ARTIFACT_BASELINE_STALE', '原采集已失效，不能接受历史文件证明');

    const files = new Map<string, ArtifactFileFact>();

    for (const record of evidence.records)
    {
      if (!active.has(record.baseline.baselineId))
        continue;

      for (const captured of record.baseline.files)
      {
        const file = { relativePath: captured.relativePath, byteLength: captured.byteLength, sha256: captured.sha256 };

        const key = normalizePath(file.relativePath),
          previous = files.get(key);

        if (previous && (previous.sha256 !== file.sha256 || previous.byteLength !== file.byteLength))
          fail('ARTIFACT_BASELINE_STALE', '同一文件存在不一致的当前采集证明');

        files.set(key, file);
      }
    }

    const expected = [...files.values()],
      checks = await checkFiles(expected, signal);

    signal.throwIfAborted();

    if (!Array.isArray(checks) || checks.length !== expected.length)
      fail('ARTIFACT_BASELINE_STALE', '文件复核没有返回完整结果');

    for (let index = 0; index < expected.length; index++)
    {
      const file = expected[index],
        parsed = artifactFileCheckSchema.safeParse(checks[index]);

      if (!parsed.success || parsed.data.relativePath !== file.relativePath || parsed.data.state !== 'matches' ||
        parsed.data.expected.sha256 !== file.sha256 || parsed.data.expected.byteLength !== file.byteLength ||
        parsed.data.observed?.sha256 !== file.sha256 || parsed.data.observed?.byteLength !== file.byteLength)
        fail('ARTIFACT_BASELINE_STALE', '原交付文件已变化、缺失或无法核实');
    }

    return expected;
  }
}
