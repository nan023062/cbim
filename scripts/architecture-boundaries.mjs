// 逻辑边界独立于目录层级。只登记本轮已核实的边界；其他模块继续受物理层和文件无环约束。
// files 是成员归属，public 是允许跨边界读取的入口；新增私有实现必须登记，不能靠换目录绕过。
export const logicalBoundaries = [
  {id:'engine-package-service',prefix:'src/logic/engines/packages/',public:['src/logic/engines/packages/index.ts'],dependencies:['engine-catalog','engine-artifact-contract','engine-runtime-contract','file-foundations','utility-foundations'],external:['zod','node:fs/promises']},
  {id:'engine-runtime-contract',files:['src/logic/execution/rules/engine-runtime.ts'],public:['src/logic/execution/rules/engine-runtime.ts'],dependencies:[],external:[]},
  {id:'engine-artifact-contract',files:['src/logic/updates/engine-artifacts.ts'],public:['src/logic/updates/engine-artifacts.ts'],dependencies:[],external:[]},
  {id:'engine-model-service',prefix:'src/logic/engines/service/',public:['src/logic/engines/service/index.ts'],dependencies:['engine-catalog','model-rules','model-service','core-errors'],external:[]},
  {id:'engine-catalog',prefix:'src/logic/engines/',public:['src/logic/engines/index.ts'],dependencies:['model-rules','engine-artifact-contract'],external:['zod']},
  {id:'engine-bridge',files:['src/bridge/contracts/engines.ts'],public:['src/bridge/contracts/engines.ts'],dependencies:['engine-catalog'],external:[]},
  {id:'system-secret-cipher',files:['src/core/platform/electron/secrets.ts'],public:['src/core/platform/electron/secrets.ts'],dependencies:['secret-contract'],external:['electron']},
  {id:'material-data',files:['src/logic/materials/contracts.ts'],public:['src/logic/materials/contracts.ts'],dependencies:[],external:[]},
  {id:'workspace-data',files:['src/logic/workspace/contracts.ts'],public:['src/logic/workspace/contracts.ts'],dependencies:['knowledge-data'],external:[]},
  {id:'package-data',files:['src/logic/resources/packages/contracts.ts'],public:['src/logic/resources/packages/contracts.ts'],dependencies:['knowledge-data','resource-contract'],external:[]},
  {id:'update-data',files:['src/logic/updates/contracts.ts'],public:['src/logic/updates/contracts.ts'],dependencies:[],external:[]},
  {id:'resource-service',prefix:'src/logic/resources/service/',public:['src/logic/resources/service/index.ts'],dependencies:['resource-contract','core-errors','file-foundations','utility-foundations','utility-node-foundations','kernel-lock'],external:['zod','node:fs/promises','node:path','node:crypto','node:http','node:net','node:os']},
  {id:'resource-contract',files:['src/logic/resources/index.ts','src/logic/resources/contracts.ts'],public:['src/logic/resources/index.ts'],dependencies:[],external:[]},
  {id:'feedback-http',files:['src/logic/feedback/service/github-api.ts'],public:['src/logic/feedback/service/github-api.ts'],dependencies:['core-errors','utility-foundations'],external:[]},
  {id:'feedback-service',prefix:'src/logic/feedback/service/',public:['src/logic/feedback/service/index.ts'],dependencies:['feedback-contract','feedback-http','core-errors','secret-contract','file-foundations','utility-node-foundations','kernel-lock'],external:['zod','node:fs/promises','node:path','node:crypto']},
  {id:'feedback-contract',prefix:'src/logic/feedback/',public:['src/logic/feedback/index.ts'],dependencies:[],external:['zod']},
  {id:'feedback-bridge-compatibility',files:['src/bridge/contracts/github-feedback.ts'],public:['src/bridge/contracts/github-feedback.ts'],dependencies:['feedback-contract'],external:[]},
  {id:'kernel-lock',files:['src/core/platform/node/locking.ts'],public:['src/core/platform/node/locking.ts'],dependencies:['core-errors'],external:['node:module','node:path','node:fs','koffi']},
  {id:'secret-contract',files:['src/core/contracts/secrets.ts'],public:['src/core/contracts/secrets.ts'],dependencies:[],external:[]},
  {id:'web-service',prefix:'src/logic/web/service/',public:['src/logic/web/service/index.ts'],dependencies:['web-contract','web-node','web-portable','core-errors','secret-contract','file-foundations','utility-foundations'],external:['zod','node:fs/promises','node:timers/promises']},
  {id:'web-contract',prefix:'src/logic/web/',public:['src/logic/web/index.ts'],dependencies:[],external:['zod']},
  {id:'web-portable',prefix:'src/core/web/',public:['src/core/web/index.ts'],dependencies:[],external:['zod','parse5']},
  {id:'web-node',prefix:'src/core/platform/node/web/',public:['src/core/platform/node/web/index.ts'],dependencies:['web-portable'],external:['robots-parser','ipaddr.js','node:http','node:https','node:dns/promises','node:net','node:zlib','node:timers/promises']},
  {id:'web-electron',files:['src/core/platform/electron/web-reader.ts'],public:['src/core/platform/electron/web-reader.ts'],dependencies:['web-portable','web-node'],external:['electron','node:crypto','node:timers/promises','zod']},
  {id:'web-bridge-compatibility',files:['src/bridge/contracts/web.ts'],public:['src/bridge/contracts/web.ts'],dependencies:['web-contract'],external:[]},
  {
    id:'model-service',prefix:'src/logic/models/service/',public:['src/logic/models/service/index.ts'],
    dependencies:['model-rules','core-errors','file-foundations','utility-foundations'],external:['node:fs/promises','node:crypto','zod'],
  },
  {
    id:'model-rules',prefix:'src/logic/models/',public:['src/logic/models/index.ts'],
    dependencies:['secret-contract'],external:['zod'],
  },
  {
    id:'core-errors',files:['src/core/errors.ts'],public:['src/core/errors.ts'],dependencies:[],external:[],
  },
  {
    id:'model-bridge-compatibility',files:['src/bridge/contracts/models.ts'],public:['src/bridge/contracts/models.ts'],
    dependencies:['model-rules'],imports:['src/logic/execution/rules/model-errors.ts'],external:[],
  },
  {
    id:'frontend-utility',prefix:'src/view/foundations/utility/',public:['src/view/foundations/utility/index.ts'],
    dependencies:['utility-foundations'],external:[],
  },
  {
    id:'file-foundations',prefix:'src/core/platform/node/files/',public:['src/core/platform/node/files/index.ts'],
    dependencies:[],external:['node:fs/promises','node:path','node:crypto'],
  },
  {
    id:'utility-foundations',prefix:'src/core/utility/',public:['src/core/utility/index.ts'],
    dependencies:[],external:['jsonc-parser'],
  },
  {
    id:'utility-node-foundations',files:['src/core/platform/node/digest.ts'],public:['src/core/platform/node/digest.ts'],
    dependencies:[],external:['node:crypto'],
  },
  {
    id:'pure-foundation',
    files:['src/core/json.ts','src/core/platform/node/serialization.ts'],
    public:['src/core/json.ts','src/core/platform/node/serialization.ts'],
    dependencies:['utility-foundations','utility-node-foundations','core-errors'], external:[],
  },
  {
    id:'knowledge-data', files:['src/logic/knowledge/rules/types.ts'],
    public:['src/logic/knowledge/rules/types.ts'], dependencies:[], external:[],
  },
  {
    id:'project-definition', files:['src/logic/workspace/rules/project-root.ts'],
    public:['src/logic/workspace/rules/project-root.ts'], dependencies:[], external:[],
  },
  {
    id:'knowledge-read-models',
    files:['src/logic/knowledge/rules/read-models/index.ts','src/logic/knowledge/rules/read-models/snapshot.ts','src/logic/knowledge/rules/read-models/team.ts','src/logic/knowledge/rules/read-models/workspace.ts'],
    public:['src/logic/knowledge/rules/read-models/index.ts'],
    dependencies:['core-errors','pure-foundation','knowledge-data','project-definition'], external:['node:path'],
  },
  {
    id:'knowledge-query-orchestration', files:['src/logic/knowledge/rules/knowledge-queries.ts'],
    public:['src/logic/knowledge/rules/knowledge-queries.ts'],
    dependencies:['core-errors','pure-foundation','knowledge-data','knowledge-read-models'],
    external:[],
  },
  {
    id:'knowledge-refresh', files:['src/logic/knowledge/rules/knowledge-refresh.ts'],
    public:['src/logic/knowledge/rules/knowledge-refresh.ts'],
    dependencies:['core-errors','pure-foundation','knowledge-data','knowledge-read-models'],
    imports:['src/logic/knowledge/rules/knowledge-write-input.ts'], external:[],
  },
  {
    id:'request-budget-port', files:['src/logic/budget/rules/model-request-budget-storage.ts'],
    public:['src/logic/budget/rules/model-request-budget-storage.ts'], dependencies:[],
    imports:['src/logic/budget/rules/model-request-budget.ts','src/logic/budget/rules/scope-budget.ts'], external:[],
  },
  {
    id:'request-budget-service', files:['src/logic/budget/runtime/model-request-budget-service.ts'],
    public:['src/logic/budget/runtime/model-request-budget-service.ts'],
    dependencies:['core-errors','pure-foundation','request-budget-port','model-rules'],
    imports:['src/logic/budget/rules/model-request-budget.ts','src/logic/budget/rules/model-request-budget-rules.ts','src/logic/budget/rules/model-request-configuration.ts','src/logic/budget/rules/request-budget.ts','src/logic/team/rules/workspace-member-rules.ts'],external:['node:crypto'],
  },
  {
    id:'engine-tool-registry', files:['src/logic/execution/rules/engine-tools.ts'],
    public:['src/logic/execution/rules/engine-tools.ts'], dependencies:[], external:[],
  },
  {
    "id": "ipc-contract",
    "files": [
      "src/bridge/contracts/ipc-call.ts",
      "src/bridge/contracts/ipc-chat.ts",
      "src/bridge/contracts/ipc-desktop.ts",
      "src/bridge/contracts/ipc-dispatch.ts",
      "src/bridge/contracts/ipc-governance.ts",
      "src/bridge/contracts/ipc-loop.ts",
      "src/bridge/contracts/ipc-people.ts",
      "src/bridge/contracts/ipc-resources.ts",
      "src/bridge/contracts/ipc-settings.ts",
      "src/bridge/contracts/ipc-shapes.ts",
      "src/bridge/contracts/ipc-workspace.ts",
      "src/bridge/contracts/agent-history-ipc.ts",
      "src/bridge/contracts/model-actions.ts",
      "src/bridge/contracts/automation.ts",
      "src/bridge/contracts/workspace-view.ts"
    ],
    "public": [
      "src/bridge/contracts/ipc-call.ts",
      "src/bridge/contracts/ipc-chat.ts",
      "src/bridge/contracts/ipc-desktop.ts",
      "src/bridge/contracts/ipc-dispatch.ts",
      "src/bridge/contracts/ipc-governance.ts",
      "src/bridge/contracts/ipc-loop.ts",
      "src/bridge/contracts/ipc-people.ts",
      "src/bridge/contracts/ipc-resources.ts",
      "src/bridge/contracts/ipc-settings.ts",
      "src/bridge/contracts/ipc-shapes.ts",
      "src/bridge/contracts/ipc-workspace.ts",
      "src/bridge/contracts/agent-history-ipc.ts",
      "src/bridge/contracts/model-actions.ts",
      "src/bridge/contracts/automation.ts",
      "src/bridge/contracts/workspace-view.ts"
    ],
    "dependencies": [
      "knowledge-data",
      "workspace-data"
    ],
    "imports": [
      "src/logic/automation/rules/contracts.ts",
      "src/logic/team/rules/agent-runtime.ts",
      "src/bridge/contracts/models.ts",
      "src/bridge/contracts/engines.ts",
      "src/logic/execution/rules/types.ts",
      "src/bridge/contracts/github-feedback.ts",
      "src/logic/connectors/rules/repository-connection.ts",
      "src/logic/connectors/rules/repository-tools.ts",
      "src/bridge/contracts/web.ts",
      "src/logic/governance/rules/module-governance.ts",
      "src/logic/knowledge/rules/object-contract.ts",
      "src/logic/tools/rules/policy/types.ts",
      "src/logic/runtime/rules/admission.ts",
      "src/logic/runtime/rules/types.ts",
      "src/logic/evidence/rules/artifact-baseline.ts",
      "src/logic/tasks/rules/command-verification.ts",
      "src/logic/file-operations/rules/controlled-file-operation.ts",
      "src/logic/tasks/rules/dispatch-commands.ts",
      "src/logic/dispatch/rules/dispatch-storage.ts",
      "src/logic/tasks/rules/effect-observation.ts",
      "src/logic/tasks/rules/execution-report.ts",
      "src/logic/tasks/rules/graph-types.ts",
      "src/logic/tasks/rules/human-continue.ts",
      "src/logic/tasks/rules/human-decisions.ts",
      "src/logic/file-operations/rules/isolated-execution-recovery.ts",
      "src/logic/tasks/rules/member-commands.ts",
      "src/logic/tasks/rules/member-events.ts",
      "src/logic/budget/rules/model-request-budget.ts",
      "src/logic/evidence/rules/output-manifest.ts",
      "src/logic/tasks/rules/queue.ts",
      "src/logic/budget/rules/scope-budget.ts",
      "src/logic/tasks/rules/scope-continuation.ts",
      "src/logic/tasks/rules/topic-interruption.ts",
      "src/logic/tasks/rules/scope-recovery.ts",
      "src/logic/tasks/rules/scope-replan.ts",
      "src/logic/budget/rules/scope-usage.ts",
      "src/logic/tasks/rules/scope-view.ts",
      "src/logic/tasks/rules/types.ts",
      "src/logic/team/rules/owner-execution-discovery.ts",
      "src/logic/team/rules/session-history.ts",
      "src/logic/team/rules/workspace-member.ts",
      "src/logic/tools/rules/questions.ts",
      "src/logic/workspace/rules/module-ownership.ts",
      "src/bridge/contracts/agent-history.ts",
      "src/bridge/contracts/chat.ts",
      "src/bridge/contracts/desktop-updates.ts",
      "src/bridge/contracts/resources.ts"
    ],
    "external": [
      "zod"
    ]
  },
  {
    id:'agent-history-file-store', files:['src/logic/history/service/file-store.ts'],
    public:['src/logic/history/service/file-store.ts'], dependencies:['core-errors','pure-foundation','file-foundations'],
    imports:['src/logic/team/rules/session-history-storage.ts'],external:['node:fs/promises','node:path'],
  },
  {
    id:'execution-view', prefix:'src/view/execution-view/',
    public:['src/view/execution-view/team-conversations.ts','src/view/execution-view/WorkStatus.tsx','src/view/execution-view/ToolTimeline.tsx','src/view/execution-view/MarkdownMessage.tsx','src/view/execution-view/transcript.ts','src/view/execution-view/tool-labels.ts','src/view/execution-view/repairStreamingMarkdown.ts','src/view/execution-view/MessageQueue.tsx','src/view/execution-view/QuestionCard.tsx','src/view/execution-view/ComposerAttachments.tsx','src/view/execution-view/knowledge-tool-view.ts'],
    dependencies:[], imports:['src/bridge/contracts/dispatch.ts','src/bridge/contracts/execution.ts','src/bridge/contracts/models.ts','src/bridge/contracts/chat.ts','src/bridge/contracts/knowledge-transactions.ts','src/view/components/Icon.tsx','src/view/components/RepositoryScopeDetails.tsx'],
    external:['react','react-markdown','remark-gfm','rehype-highlight'],
  },
  {
    id:'test-data', prefix:'tests/data/',
    public:['tests/data/knowledge.ts','tests/data/domain-snapshot.ts'],
    dependencies:['core-errors','pure-foundation','knowledge-data'], external:['node:crypto'],
  },
];

/** 对已解析的真实文件边检查逻辑方向与入口；类型、重导出、别名和字面量加载一视同仁。 */
export function checkLogicalBoundaries(files, edges, externalReferences) {
  const owner = file => logicalBoundaries.find(boundary => boundary.files?.includes(file) || boundary.prefix && file.startsWith(boundary.prefix));
  const violations = [];
  // 新 Core 必须登记模块、公开入口与外部依赖；不能在未归属文件中偷渡 Node 或业务实现。
  for(const file of files)if(file.startsWith('src/core/')&&!owner(file))violations.push({file,rule:'unregistered-core-module',boundary:'core'});
  for (const edge of edges) {
    const from = owner(edge.from), to = owner(edge.to);
    if (from?.id === to?.id) continue;
    if (to && !to.public.includes(edge.to)) violations.push({...edge,rule:'private-entry',boundary:to.id});
    if (from && !from.dependencies.includes(to?.id) && !from.imports?.includes(edge.to)) {
      violations.push({...edge,rule:'logical-direction',boundary:from.id});
    }
  }
  // 稳定读模型也不能经 SDK、Node 文件操作或外部包逃出边界；未解析引用仍由主检查器拒绝。
  for (const reference of externalReferences) {
    const boundary = owner(reference.file);
    if (boundary && !boundary.external.includes(reference.spec)) violations.push({...reference,rule:'external-dependency',boundary:boundary.id});
  }
  return {violations,coverage:logicalBoundaries.map(boundary => ({
    id:boundary.id, files:files.filter(file => owner(file)?.id === boundary.id).length,
  }))};
}
