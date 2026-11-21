// 逻辑边界独立于目录层级。只登记本轮已核实的边界；其他模块继续受物理层和文件无环约束。
// files 是成员归属，public 是允许跨边界读取的入口；新增私有实现必须登记，不能靠换目录绕过。
export const logicalBoundaries = [
  {
    "id": "framework-events",
    "files": [
      "src/framework/events.ts"
    ],
    "public": [
      "src/framework/events.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "framework-runtime",
    "files": [
      "src/framework/cbim-runtime.ts"
    ],
    "public": [
      "src/framework/cbim-runtime.ts"
    ],
    "dependencies": [
      "framework-events",
      "framework-office",
      "framework-cability",
      "framework-business"
    ],
    "external": []
  },
  {
    "id": "framework-skill-definition",
    "prefix": "src/framework/skills/",
    "public": [
      "src/framework/skills/index.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "framework-connectors",
    "prefix": "src/framework/connectors/",
    "public": [
      "src/framework/connectors/index.ts"
    ],
    "dependencies": [],
    "external": [
      "zod"
    ]
  },
  {
    "id": "framework-business",
    "prefix": "src/framework/business/",
    "public": [
      "src/framework/business/index.ts"
    ],
    "dependencies": [
      "framework-events",
      "framework-skill-definition"
    ],
    "external": []
  },
  {
    "id": "framework-office",
    "prefix": "src/framework/office/",
    "public": [
      "src/framework/office/index.ts",
      "src/framework/office/call.ts",
      "src/framework/office/session.ts",
      "src/framework/office/exchange.ts"
    ],
    "dependencies": [
      "framework-events",
      "framework-agent",
      "framework-cability",
      "framework-team",
      "framework-business"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "framework-cability",
    "files": [
      "src/framework/cability/organization.ts"
    ],
    "public": [
      "src/framework/cability/organization.ts"
    ],
    "dependencies": [
      "framework-events",
      "framework-agent",
      "framework-team"
    ],
    "external": []
  },
  {
    "id": "framework-skills",
    "files": [
      "src/framework/cability/skills.ts"
    ],
    "public": [
      "src/framework/cability/skills.ts"
    ],
    "dependencies": [
      "framework-skill-definition"
    ],
    "external": []
  },
  {
    "id": "framework-team",
    "files": [
      "src/framework/cability/team.ts"
    ],
    "public": [
      "src/framework/cability/team.ts"
    ],
    "dependencies": [],
    "external": [
      "zod"
    ]
  },
  {
    "id": "framework-agent",
    "prefix": "src/framework/cability/agent/",
    "public": [
      "src/framework/cability/agent/index.ts",
      "src/framework/cability/agent/questions.ts",
      "src/framework/cability/agent/identity.ts"
    ],
    "dependencies": [
      "framework-events",
      "framework-skills",
      "framework-team",
      "execution-kernel"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "execution-kernel",
    "files": [
      "src/framework/kernel/index.ts",
      "src/framework/kernel/kernel.ts"
    ],
    "public": [
      "src/framework/kernel/index.ts"
    ],
    "dependencies": [
      "framework-models",
      "framework-engines"
    ],
    "external": []
  },
  {
    "id": "framework-models",
    "prefix": "src/framework/kernel/models/",
    "public": [
      "src/framework/kernel/models/index.ts"
    ],
    "dependencies": [
      "utility-foundations"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "framework-engines",
    "prefix": "src/framework/kernel/engines/",
    "public": [
      "src/framework/kernel/engines/index.ts"
    ],
    "dependencies": [
      "framework-models",
      "io"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "debug-console",
    "files": [
      "src/core/debug/index.ts"
    ],
    "public": [
      "src/core/debug/index.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "debug-node",
    "files": [
      "src/core/debug/node.ts"
    ],
    "public": [
      "src/core/debug/node.ts"
    ],
    "dependencies": [],
    "external": [
      "node:fs/promises"
    ]
  },
  {
    "id": "plugin-management",
    "prefix": "src/resource/plugins/",
    "public": [
      "src/resource/plugins/index.ts"
    ],
    "dependencies": [
      "file-foundations",
      "utility-foundations"
    ],
    "external": [
      "zod",
      "node:fs/promises"
    ]
  },
  {
    "id": "engine-package-service",
    "prefix": "src/logic/engines/packages/",
    "public": [
      "src/logic/engines/packages/index.ts"
    ],
    "dependencies": [
      "plugin-management",
      "engine-catalog",
      "engine-artifact-contract",
      "engine-runtime-contract"
    ],
    "external": []
  },
  {
    "id": "engine-runtime-contract",
    "files": [
      "src/logic/execution/rules/engine-runtime.ts"
    ],
    "public": [
      "src/logic/execution/rules/engine-runtime.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "engine-artifact-contract",
    "files": [
      "src/logic/updates/engine-artifacts.ts"
    ],
    "public": [
      "src/logic/updates/engine-artifacts.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "engine-model-service",
    "prefix": "src/logic/engines/service/",
    "public": [
      "src/logic/engines/service/index.ts"
    ],
    "dependencies": [
      "execution-kernel",
      "engine-catalog",
      "model-rules",
      "model-service"
    ],
    "external": []
  },
  {
    "id": "engine-product-manifests",
    "files": [
      "src/engine-plugins/pi/manifest.ts",
      "src/engine-plugins/claude/manifest.ts",
      "src/engine-plugins/codex/manifest.ts",
      "src/engine-plugins/memory/manifest.ts"
    ],
    "public": [
      "src/engine-plugins/pi/manifest.ts",
      "src/engine-plugins/claude/manifest.ts",
      "src/engine-plugins/codex/manifest.ts",
      "src/engine-plugins/memory/manifest.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "engine-catalog",
    "prefix": "src/logic/engines/catalog/",
    "files": [
      "src/logic/engines/index.ts",
      "src/logic/engines/package-status.ts"
    ],
    "public": [
      "src/logic/engines/index.ts"
    ],
    "dependencies": [
      "engine-product-manifests",
      "execution-kernel",
      "model-rules",
      "io",
      "engine-artifact-contract"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "file-foundations",
    "files": [
      "src/core/io/text-files.ts"
    ],
    "public": [
      "src/core/io/text-files.ts"
    ],
    "dependencies": [],
    "external": [
      "node:fs/promises",
      "node:crypto",
      "node:path"
    ]
  },
  {
    "id": "io-digest",
    "files": [
      "src/core/io/digest.ts"
    ],
    "public": [
      "src/core/io/digest.ts"
    ],
    "dependencies": [],
    "external": [
      "node:crypto"
    ]
  },
  {
    "id": "io-node",
    "files": [
      "src/core/io/node.ts"
    ],
    "public": [
      "src/core/io/node.ts"
    ],
    "dependencies": [
      "file-foundations",
      "io-digest"
    ],
    "external": [
      "node:fs/promises",
      "node:path",
      "node:crypto"
    ]
  },
  {
    "id": "io-electron",
    "files": [
      "src/core/io/electron.ts"
    ],
    "public": [
      "src/core/io/electron.ts"
    ],
    "dependencies": [],
    "external": [
      "electron"
    ]
  },
  {
    "id": "io-compression",
    "files": [
      "src/core/io/compression.ts"
    ],
    "public": [
      "src/core/io/compression.ts"
    ],
    "dependencies": [],
    "external": [
      "node:zlib"
    ]
  },
  {
    "id": "io-serialization",
    "files": [
      "src/core/io/serialization.ts"
    ],
    "public": [
      "src/core/io/serialization.ts"
    ],
    "dependencies": [
      "io",
      "io-digest"
    ],
    "external": []
  },
  {
    "id": "kernel-lock",
    "files": [
      "src/core/io/locking.ts"
    ],
    "public": [
      "src/core/io/locking.ts"
    ],
    "dependencies": [],
    "external": [
      "node:module",
      "node:path",
      "node:fs",
      "koffi"
    ]
  },
  {
    "id": "io-json",
    "files": [
      "src/core/io/json.ts"
    ],
    "public": [
      "src/core/io/json.ts"
    ],
    "dependencies": [],
    "external": [
      "jsonc-parser"
    ]
  },
  {
    "id": "io",
    "prefix": "src/core/io/",
    "public": [
      "src/core/io/index.ts"
    ],
    "dependencies": [
      "io-json"
    ],
    "external": []
  },
  {
    "id": "update-data",
    "files": [
      "src/logic/updates/contracts.ts"
    ],
    "public": [
      "src/logic/updates/contracts.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "local-model-storage",
    "prefix": "src/resource/models/",
    "public": [
      "src/resource/models/local-profiles.ts"
    ],
    "dependencies": [
      "file-foundations",
      "utility-foundations",
      "io-electron"
    ],
    "external": [
      "node:fs/promises",
      "node:crypto",
      "zod"
    ]
  },
  {
    "id": "resource-service",
    "prefix": "src/resource/service/",
    "public": [
      "src/resource/service/index.ts"
    ],
    "dependencies": [
      "resource-contract",
      "file-foundations",
      "utility-foundations",
      "io",
      "io-digest",
      "kernel-lock"
    ],
    "external": [
      "zod",
      "node:fs/promises",
      "node:path",
      "node:crypto",
      "node:http",
      "node:net",
      "node:os"
    ]
  },
  {
    "id": "resource-contract",
    "files": [
      "src/resource/index.ts",
      "src/resource/contracts.ts"
    ],
    "public": [
      "src/resource/index.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "feedback-contract",
    "prefix": "src/logic/feedback/",
    "public": [
      "src/logic/feedback/index.ts"
    ],
    "dependencies": [],
    "external": [
      "zod"
    ]
  },
  {
    "id": "web-node",
    "files": [
      "src/core/web/node.ts",
      "src/core/web/page-reader.ts",
      "src/core/web/public-http.ts",
      "src/core/web/browser-proxy.ts"
    ],
    "public": [
      "src/core/web/node.ts"
    ],
    "dependencies": [
      "web-portable"
    ],
    "external": [
      "node:zlib",
      "robots-parser",
      "ipaddr.js",
      "node:http",
      "node:https",
      "node:dns/promises",
      "node:net",
      "node:timers/promises"
    ]
  },
  {
    "id": "web-electron",
    "files": [
      "src/core/web/electron.ts"
    ],
    "public": [
      "src/core/web/electron.ts"
    ],
    "dependencies": [
      "web-portable",
      "web-node"
    ],
    "external": [
      "electron",
      "node:crypto",
      "node:timers/promises",
      "zod"
    ]
  },
  {
    "id": "web-portable",
    "prefix": "src/core/web/",
    "public": [
      "src/core/web/index.ts"
    ],
    "dependencies": [],
    "external": [
      "zod",
      "parse5"
    ]
  },
  {
    "id": "model-service",
    "prefix": "src/logic/models/service/",
    "public": [
      "src/logic/models/service/index.ts"
    ],
    "dependencies": [
      "execution-kernel",
      "model-rules",
      "local-model-storage"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "model-rules",
    "prefix": "src/logic/models/",
    "public": [
      "src/logic/models/index.ts"
    ],
    "dependencies": [
      "io-electron"
    ],
    "external": [
      "zod"
    ]
  },
  {
    "id": "utility-foundations",
    "prefix": "src/core/utility/",
    "public": [
      "src/core/utility/index.ts"
    ],
    "dependencies": [],
    "external": []
  },
  {
    "id": "engine-tool-registry",
    "files": [
      "src/logic/execution/rules/engine-tools.ts"
    ],
    "public": [
      "src/logic/execution/rules/engine-tools.ts"
    ],
    "dependencies": [],
    "external": []
  }
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
