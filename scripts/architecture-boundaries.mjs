// 逻辑边界独立于目录层级。只登记本轮已核实的边界；其他模块继续受物理层和文件无环约束。
// files 是成员归属，public 是允许跨边界读取的入口；新增私有实现必须登记，不能靠换目录绕过。
export const logicalBoundaries = [
  {
    id:'file-foundations',prefix:'src/foundations/files/',public:['src/foundations/files/index.ts'],
    dependencies:[],external:['node:fs/promises','node:path','node:crypto'],
  },
  {
    id:'utility-foundations',files:['src/foundations/utility/index.ts','src/foundations/utility/json.ts','src/foundations/utility/async.ts','src/foundations/utility/strings.ts','src/foundations/utility/bytes.ts'],public:['src/foundations/utility/index.ts'],
    dependencies:[],external:['jsonc-parser'],
  },
  {
    id:'utility-node-foundations',files:['src/foundations/utility/node.ts'],public:['src/foundations/utility/node.ts'],
    dependencies:[],external:['node:crypto'],
  },
  {
    id:'web-foundations',
    files:['src/foundations/web/index.ts','src/foundations/web/contracts.ts','src/foundations/web/browser-reader.ts','src/foundations/web/page-reader.ts','src/foundations/web/public-http.ts','src/foundations/web/browser-proxy.ts','src/foundations/web/web-content.ts','src/foundations/web/electron-browser-reader.ts'],
    public:['src/foundations/web/index.ts','src/foundations/web/electron-browser-reader.ts'],
    dependencies:[],external:['zod','parse5','robots-parser','ipaddr.js','electron','node:http','node:https','node:dns/promises','node:net','node:zlib','node:timers/promises','node:crypto'],
  },
  {
    id:'pure-foundation',
    files:['src/backend/core/foundation/errors.ts','src/backend/core/foundation/json.ts','src/backend/core/foundation/serialization.ts'],
    public:['src/backend/core/foundation/errors.ts','src/backend/core/foundation/json.ts','src/backend/core/foundation/serialization.ts'],
    dependencies:['utility-foundations','utility-node-foundations'], external:[],
  },
  {
    id:'knowledge-data', files:['src/backend/core/knowledge/types.ts'],
    public:['src/backend/core/knowledge/types.ts'], dependencies:[], external:[],
  },
  {
    id:'project-definition', files:['src/backend/core/workspace/project-root.ts'],
    public:['src/backend/core/workspace/project-root.ts'], dependencies:[], external:[],
  },
  {
    id:'knowledge-read-models',
    files:['src/backend/core/knowledge/read-models/index.ts','src/backend/core/knowledge/read-models/snapshot.ts','src/backend/core/knowledge/read-models/team.ts','src/backend/core/knowledge/read-models/workspace.ts'],
    public:['src/backend/core/knowledge/read-models/index.ts'],
    dependencies:['pure-foundation','knowledge-data','project-definition'], external:['node:path'],
  },
  {
    id:'knowledge-query-orchestration', files:['src/backend/core/knowledge/knowledge-queries.ts'],
    public:['src/backend/core/knowledge/knowledge-queries.ts'],
    dependencies:['pure-foundation','knowledge-data','knowledge-read-models'],
    external:[],
  },
  {
    id:'knowledge-refresh', files:['src/backend/core/knowledge/knowledge-refresh.ts'],
    public:['src/backend/core/knowledge/knowledge-refresh.ts'],
    dependencies:['pure-foundation','knowledge-data','knowledge-read-models'],
    imports:['src/backend/core/knowledge/knowledge-write-input.ts'], external:[],
  },
  {
    id:'request-budget-port', files:['src/backend/core/budget/model-request-budget-storage.ts'],
    public:['src/backend/core/budget/model-request-budget-storage.ts'], dependencies:[],
    imports:['src/backend/core/budget/model-request-budget.ts','src/backend/core/budget/scope-budget.ts'], external:[],
  },
  {
    id:'request-budget-service', files:['src/backend/scheduler-engine/budget/model-request-budget-service.ts'],
    public:['src/backend/scheduler-engine/budget/model-request-budget-service.ts'],
    dependencies:['pure-foundation','request-budget-port'],
    imports:['src/backend/core/budget/model-request-budget.ts','src/backend/core/budget/model-request-budget-rules.ts','src/backend/core/models/ports.ts','src/backend/core/models/request-budget.ts','src/backend/core/team/workspace-member-rules.ts'],external:['node:crypto'],
  },
  {
    id:'engine-tool-registry', files:['src/backend/core/execution/engine-tools.ts'],
    public:['src/backend/core/execution/engine-tools.ts'], dependencies:[], external:[],
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
      "knowledge-data"
    ],
    "imports": [
      "src/backend/core/automation/contracts.ts",
      "src/backend/core/team/agent-runtime.ts",
      "src/bridge/contracts/models.ts",
      "src/backend/core/models/catalog.ts",
      "src/backend/core/models/config.ts",
      "src/backend/core/execution/types.ts",
      "src/backend/core/connectors/github-feedback.ts",
      "src/backend/core/connectors/repository-connection.ts",
      "src/backend/core/connectors/repository-tools.ts",
      "src/backend/core/connectors/web-tools.ts",
      "src/backend/core/governance/module-governance.ts",
      "src/backend/core/knowledge/object-contract.ts",
      "src/backend/core/tools/policy/types.ts",
      "src/backend/core/runtime/admission.ts",
      "src/backend/core/runtime/types.ts",
      "src/backend/core/evidence/artifact-baseline.ts",
      "src/backend/core/tasks/command-verification.ts",
      "src/backend/core/file-operations/controlled-file-operation.ts",
      "src/backend/core/tasks/dispatch-commands.ts",
      "src/backend/core/dispatch/dispatch-storage.ts",
      "src/backend/core/tasks/effect-observation.ts",
      "src/backend/core/tasks/execution-report.ts",
      "src/backend/core/tasks/graph-types.ts",
      "src/backend/core/tasks/human-continue.ts",
      "src/backend/core/tasks/human-decisions.ts",
      "src/backend/core/file-operations/isolated-execution-recovery.ts",
      "src/backend/core/tasks/member-commands.ts",
      "src/backend/core/tasks/member-events.ts",
      "src/backend/core/budget/model-request-budget.ts",
      "src/backend/core/evidence/output-manifest.ts",
      "src/backend/core/tasks/queue.ts",
      "src/backend/core/budget/scope-budget.ts",
      "src/backend/core/tasks/scope-continuation.ts",
      "src/backend/core/tasks/scope-recovery.ts",
      "src/backend/core/tasks/scope-replan.ts",
      "src/backend/core/budget/scope-usage.ts",
      "src/backend/core/tasks/scope-view.ts",
      "src/backend/core/tasks/types.ts",
      "src/backend/core/team/owner-execution-discovery.ts",
      "src/backend/core/team/session-history.ts",
      "src/backend/core/team/workspace-member.ts",
      "src/backend/core/tools/questions.ts",
      "src/backend/core/workspace/module-ownership.ts",
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
    id:'agent-history-file-store', files:['src/backend/main/history/file-store.ts'],
    public:['src/backend/main/history/file-store.ts'], dependencies:['pure-foundation','file-foundations'],
    imports:['src/backend/core/team/session-history-storage.ts'],external:['node:fs/promises','node:path'],
  },
  {
    id:'execution-view', prefix:'src/frontend/execution-view/',
    public:['src/frontend/execution-view/WorkStatus.tsx','src/frontend/execution-view/ToolTimeline.tsx','src/frontend/execution-view/MarkdownMessage.tsx','src/frontend/execution-view/transcript.ts','src/frontend/execution-view/tool-labels.ts','src/frontend/execution-view/repairStreamingMarkdown.ts','src/frontend/execution-view/MessageQueue.tsx','src/frontend/execution-view/QuestionCard.tsx','src/frontend/execution-view/ComposerAttachments.tsx','src/frontend/execution-view/knowledge-tool-view.ts'],
    dependencies:[], imports:['src/bridge/contracts/execution.ts','src/bridge/contracts/models.ts','src/bridge/contracts/chat.ts','src/bridge/contracts/knowledge-transactions.ts','src/frontend/components/Icon.tsx','src/frontend/components/RepositoryScopeDetails.tsx'],
    external:['react','react-markdown','remark-gfm','rehype-highlight'],
  },
  {
    id:'test-data', prefix:'tests/data/',
    public:['tests/data/knowledge.ts','tests/data/domain-snapshot.ts'],
    dependencies:['pure-foundation','knowledge-data'], external:['node:crypto'],
  },
];

/** 对已解析的真实文件边检查逻辑方向与入口；类型、重导出、别名和字面量加载一视同仁。 */
export function checkLogicalBoundaries(files, edges, externalReferences) {
  const owner = file => logicalBoundaries.find(boundary => boundary.files?.includes(file) || boundary.prefix && file.startsWith(boundary.prefix));
  const violations = [];
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
