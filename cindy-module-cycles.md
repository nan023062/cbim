# Cindy 兄弟模块循环依赖清单

版本 3b8fc9b。扫描 apps、packages、scripts、tools 下筛选后的 10,702 个 JS/TS 文件，含类型引用。工作区包名只解析至包目录。725 次本地路径或别名引用未解析到扫描文件。

直接互引每对列一次。组内所有有向边逐条列出，每条附一条经验证的最短闭合路径和一个源码位置。同一组可能有许多路径组合。模块名相对该组父目录。

## 分组索引

| 组 | 父目录 | 成员 | 直接互引对 | 有向循环边 |
|---|---|---:|---:|---:|
| M01 | apps/desktop/src/main | 76 | 140 | 576 |
| M02 | apps/mobile/src | 17 | 28 | 107 |
| M03 | apps/desktop/src/renderer/components | 17 | 11 | 58 |
| M04 | apps/desktop/src/renderer/features | 13 | 12 | 43 |
| M05 | apps/desktop/src/renderer | 12 | 22 | 66 |
| M06 | packages/maker-core/src | 4 | 3 | 9 |
| M07 | packages/maker-core/src/agents | 4 | 3 | 6 |
| M08 | . | 3 | 2 | 5 |
| M09 | apps/desktop/src/renderer/features/skillhub | 3 | 2 | 5 |
| M10 | apps/desktop/src/renderer/features/cc-agent | 3 | 3 | 6 |
| M11 | apps/desktop/src/renderer/features/right-sidebar | 3 | 1 | 4 |
| M12 | apps/desktop/src/main | 3 | 2 | 5 |
| M13 | packages/browser-control-runtime/src | 2 | 1 | 2 |
| M14 | apps/desktop/src/main/localDb | 2 | 1 | 2 |
| M15 | apps/desktop/src/renderer/features | 2 | 1 | 2 |
| M16 | apps/desktop/src/renderer/features/cc-agent/workdir-browse | 2 | 1 | 2 |
| M17 | apps/desktop/src/renderer/features/scheduler | 2 | 1 | 2 |
| M18 | packages/lizi-mcps/src/lsp | 2 | 1 | 2 |
| M19 | apps/desktop/src/main/im | 2 | 1 | 2 |

## M01 · apps/desktop/src/main · 76 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | agent-app-update |
| 2 | agent-binaries |
| 3 | agent-island |
| 4 | app-settings |
| 5 | appearance |
| 6 | bot-import |
| 7 | browser-extension |
| 8 | cindy-brain |
| 9 | cindy-evaluate |
| 10 | cindy-files |
| 11 | cindy-make |
| 12 | cindy-media |
| 13 | cindy-proxy-media |
| 14 | commands |
| 15 | companion-cloud |
| 16 | computer-permission-guide |
| 17 | device-link |
| 18 | device-sync-keys |
| 19 | doc-tools |
| 20 | embedders |
| 21 | embedding-host |
| 22 | file-browser |
| 23 | git-context |
| 24 | git-review |
| 25 | git-snapshot |
| 26 | github-issue |
| 27 | goal-host |
| 28 | hook-control |
| 29 | im |
| 30 | input-handoff |
| 31 | learn-host |
| 32 | local-agent |
| 33 | local-model-runtime |
| 34 | local-themes |
| 35 | localDb |
| 36 | log-upload |
| 37 | machines |
| 38 | maker-host |
| 39 | maker-ipc |
| 40 | maker-orchestration |
| 41 | mcp-apps |
| 42 | mcp-integrations |
| 43 | menubar |
| 44 | model-access |
| 45 | performance-trace |
| 46 | plugin-contributions |
| 47 | plugin-market |
| 48 | plugin-oauth |
| 49 | plugin-publisher |
| 50 | plugin-usage |
| 51 | provider-group |
| 52 | provider-import |
| 53 | quota-overview |
| 54 | remote-agent |
| 55 | remote-desktop |
| 56 | remote-desktop-viewer |
| 57 | remote-ssh |
| 58 | reviewer |
| 59 | right-sidebar-window |
| 60 | scheduler-host |
| 61 | secrets |
| 62 | session-import |
| 63 | session-share |
| 64 | session-title-rename |
| 65 | skillhub |
| 66 | subscription-accounts |
| 67 | task-management |
| 68 | task-migration |
| 69 | terminal |
| 70 | turn-change-set |
| 71 | usage |
| 72 | utility-model |
| 73 | vision-bridge |
| 74 | voice-conversation |
| 75 | voice-input |
| 76 | worktree |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| agent-app-update | device-link | [apps/desktop/src/main/agent-app-update/index.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-app-update/index.ts#L21) | [apps/desktop/src/main/device-link/sharedTaskDispatch.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/sharedTaskDispatch.ts#L5) |
| agent-app-update | maker-ipc | [apps/desktop/src/main/agent-app-update/callerAuthority.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-app-update/callerAuthority.ts#L3) | [apps/desktop/src/main/maker-ipc/pluginCompanionHost.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/pluginCompanionHost.ts#L12) |
| agent-island | localDb | [apps/desktop/src/main/agent-island/companionIdentity.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/companionIdentity.ts#L11) | [apps/desktop/src/main/localDb/agentIslandSessionPatch.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/agentIslandSessionPatch.ts#L19) |
| agent-island | quota-overview | [apps/desktop/src/main/agent-island/quota.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/quota.ts#L18) | [apps/desktop/src/main/quota-overview/panelController.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L20) |
| agent-island | scheduler-host | [apps/desktop/src/main/agent-island/archiveConfirmation.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/archiveConfirmation.ts#L6) | [apps/desktop/src/main/scheduler-host/index.desktop.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L19) |
| app-settings | maker-ipc | [apps/desktop/src/main/app-settings/connections.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/connections.ts#L10) | [apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts#L1) |
| appearance | local-themes | [apps/desktop/src/main/appearance/themes.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/appearance/themes.ts#L5) | [apps/desktop/src/main/local-themes/packages.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/packages.ts#L7) |
| bot-import | localDb | [apps/desktop/src/main/bot-import/host.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/host.ts#L3) | [apps/desktop/src/main/localDb/ipc/registerAll.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/registerAll.ts#L2) |
| bot-import | maker-host | [apps/desktop/src/main/bot-import/probeAuthorization.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/probeAuthorization.ts#L3) | [apps/desktop/src/main/maker-host/index.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L17) |
| bot-import | maker-ipc | [apps/desktop/src/main/bot-import/connectionProvider.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/connectionProvider.ts#L1) | [apps/desktop/src/main/maker-ipc/botV2Migration.ts:94](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botV2Migration.ts#L94) |
| cindy-brain | cindy-evaluate | [apps/desktop/src/main/cindy-brain/cindySlot.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindySlot.ts#L1) | [apps/desktop/src/main/cindy-evaluate/models.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/models.ts#L1) |
| cindy-brain | cindy-media | [apps/desktop/src/main/cindy-brain/cindySlot.ts:87](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindySlot.ts#L87) | [apps/desktop/src/main/cindy-media/customVideoProtocol.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/customVideoProtocol.ts#L2) |
| cindy-brain | device-link | [apps/desktop/src/main/cindy-brain/cardRemoteResource.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cardRemoteResource.ts#L9) | [apps/desktop/src/main/device-link/dispatch.desktop.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L38) |
| cindy-brain | git-context | [apps/desktop/src/main/cindy-brain/index.ts:748](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L748) | [apps/desktop/src/main/git-context/githubSetupIpc.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubSetupIpc.ts#L18) |
| cindy-brain | localDb | [apps/desktop/src/main/cindy-brain/cardStoreDb.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cardStoreDb.ts#L16) | [apps/desktop/src/main/localDb/ipc/sessions.ts:725](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/sessions.ts#L725) |
| cindy-brain | maker-host | [apps/desktop/src/main/cindy-brain/cindyPrefsStore.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindyPrefsStore.ts#L17) | [apps/desktop/src/main/maker-host/auth-adapters.ts:137](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auth-adapters.ts#L137) |
| cindy-brain | maker-ipc | [apps/desktop/src/main/cindy-brain/ghostGrantConfirmBridge.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/ghostGrantConfirmBridge.ts#L22) | [apps/desktop/src/main/maker-ipc/botAuthorizationHost.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botAuthorizationHost.ts#L25) |
| cindy-brain | mcp-apps | [apps/desktop/src/main/cindy-brain/GhostManager.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/GhostManager.ts#L2) | [apps/desktop/src/main/mcp-apps/appearance.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/appearance.ts#L5) |
| cindy-brain | mcp-integrations | [apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts#L48) | [apps/desktop/src/main/mcp-integrations/browser-backend/proxy-auth.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/browser-backend/proxy-auth.ts#L7) |
| cindy-brain | model-access | [apps/desktop/src/main/cindy-brain/cindyGatewayReadiness.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindyGatewayReadiness.ts#L9) | [apps/desktop/src/main/model-access/index.ts:61](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/index.ts#L61) |
| cindy-brain | plugin-market | [apps/desktop/src/main/cindy-brain/builtinSeedStoreInstall.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/builtinSeedStoreInstall.ts#L5) | [apps/desktop/src/main/plugin-market/agentTools.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-market/agentTools.ts#L1) |
| cindy-brain | plugin-oauth | [apps/desktop/src/main/cindy-brain/ghostOauthAccounts.ts:1031](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/ghostOauthAccounts.ts#L1031) | [apps/desktop/src/main/plugin-oauth/cards.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/cards.ts#L16) |
| cindy-brain | plugin-publisher | [apps/desktop/src/main/cindy-brain/connectionAudienceResolver.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/connectionAudienceResolver.ts#L24) | [apps/desktop/src/main/plugin-publisher/host.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-publisher/host.ts#L15) |
| cindy-brain | plugin-usage | [apps/desktop/src/main/cindy-brain/index.ts:660](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L660) | [apps/desktop/src/main/plugin-usage/ipc.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-usage/ipc.ts#L7) |
| cindy-brain | terminal | [apps/desktop/src/main/cindy-brain/index.ts:745](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L745) | [apps/desktop/src/main/terminal/terminalToolAccess.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/terminal/terminalToolAccess.ts#L5) |
| cindy-evaluate | maker-host | [apps/desktop/src/main/cindy-evaluate/models.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/models.ts#L4) | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L1) |
| cindy-files | local-themes | [apps/desktop/src/main/cindy-files/register.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-files/register.ts#L6) | [apps/desktop/src/main/local-themes/agent.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/agent.ts#L9) |
| cindy-make | commands | [apps/desktop/src/main/cindy-make/doctorCommand.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/doctorCommand.ts#L6) | [apps/desktop/src/main/commands/builtins.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L22) |
| cindy-make | localDb | [apps/desktop/src/main/cindy-make/historyRuntime.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/historyRuntime.ts#L6) | [apps/desktop/src/main/localDb/index.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/index.ts#L31) |
| cindy-make | maker-host | [apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts#L11) | [apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts#L20) |
| cindy-make | maker-ipc | [apps/desktop/src/main/cindy-make/stateBroadcast.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/stateBroadcast.ts#L3) | [apps/desktop/src/main/maker-ipc/cindyMakeSessionStart.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/cindyMakeSessionStart.ts#L2) |
| cindy-media | device-link | [apps/desktop/src/main/cindy-media/clientWallpaperLock.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/clientWallpaperLock.ts#L3) | [apps/desktop/src/main/device-link/mediaFetch.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/mediaFetch.ts#L33) |
| cindy-media | file-browser | [apps/desktop/src/main/cindy-media/toolProcessMediaCore.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/toolProcessMediaCore.ts#L6) | [apps/desktop/src/main/file-browser/html-preview-ipc.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/html-preview-ipc.ts#L13) |
| cindy-media | hook-control | [apps/desktop/src/main/cindy-media/hookOutbox.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/hookOutbox.ts#L8) | [apps/desktop/src/main/hook-control/dispatcher.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/dispatcher.ts#L37) |
| cindy-media | im | [apps/desktop/src/main/cindy-media/pluginMessageAttachments.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/pluginMessageAttachments.ts#L12) | [apps/desktop/src/main/im/host.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/host.ts#L41) |
| cindy-media | localDb | [apps/desktop/src/main/cindy-media/attachmentGrantGate.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/attachmentGrantGate.ts#L19) | [apps/desktop/src/main/localDb/ipc/botAvatarSelection.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botAvatarSelection.ts#L3) |
| cindy-media | maker-host | [apps/desktop/src/main/cindy-media/invocationService.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/invocationService.ts#L25) | [apps/desktop/src/main/maker-host/attachmentPreservation.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/attachmentPreservation.ts#L1) |
| cindy-media | maker-ipc | [apps/desktop/src/main/cindy-media/mediaDownloadApproval.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/mediaDownloadApproval.ts#L4) | [apps/desktop/src/main/maker-ipc/botCreationDraft.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botCreationDraft.ts#L5) |
| cindy-media | model-access | [apps/desktop/src/main/cindy-media/invocationService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/invocationService.ts#L1) | [apps/desktop/src/main/model-access/mediaModels.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/mediaModels.ts#L20) |
| commands | maker-ipc | [apps/desktop/src/main/commands/builtins.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L17) | [apps/desktop/src/main/maker-ipc/register.ts:337](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L337) |
| companion-cloud | localDb | [apps/desktop/src/main/companion-cloud/avatarCacheHost.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/avatarCacheHost.ts#L12) | [apps/desktop/src/main/localDb/ipc/botRemoteResourceProjection.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteResourceProjection.ts#L12) |
| companion-cloud | maker-ipc | [apps/desktop/src/main/companion-cloud/host.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/host.ts#L23) | [apps/desktop/src/main/maker-ipc/botDirectMessageService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botDirectMessageService.ts#L1) |
| companion-cloud | scheduler-host | [apps/desktop/src/main/companion-cloud/projectHost.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/projectHost.ts#L22) | [apps/desktop/src/main/scheduler-host/index.desktop.ts:58](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L58) |
| computer-permission-guide | maker-ipc | [apps/desktop/src/main/computer-permission-guide/window.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/computer-permission-guide/window.ts#L25) | [apps/desktop/src/main/maker-ipc/register.ts:437](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L437) |
| device-link | file-browser | [apps/desktop/src/main/device-link/mediaFetch.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/mediaFetch.ts#L35) | [apps/desktop/src/main/file-browser/device-op.ts:73](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/device-op.ts#L73) |
| device-link | localDb | [apps/desktop/src/main/device-link/agentNetSharing.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/agentNetSharing.ts#L27) | [apps/desktop/src/main/localDb/agentHandoffPendingQueries.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/agentHandoffPendingQueries.ts#L2) |
| device-link | maker-host | [apps/desktop/src/main/device-link/agentNetOfficial.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/agentNetOfficial.ts#L12) | [apps/desktop/src/main/maker-host/index.ts:98](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L98) |
| device-link | maker-ipc | [apps/desktop/src/main/device-link/dispatch.desktop.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L33) | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L4) |
| device-link | mcp-apps | [apps/desktop/src/main/device-link/sharedTaskMessageOrigin.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/sharedTaskMessageOrigin.ts#L3) | [apps/desktop/src/main/mcp-apps/hostUi.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L8) |
| device-link | plugin-oauth | [apps/desktop/src/main/device-link/dispatch.desktop.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L15) | [apps/desktop/src/main/plugin-oauth/identityStore.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/identityStore.ts#L12) |
| device-link | provider-group | [apps/desktop/src/main/device-link/providerShareAvailability.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareAvailability.ts#L5) | [apps/desktop/src/main/provider-group/continuityRuntime.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/continuityRuntime.ts#L7) |
| device-link | quota-overview | [apps/desktop/src/main/device-link/dispatch.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L2) | [apps/desktop/src/main/quota-overview/desktopWidgets.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/desktopWidgets.ts#L22) |
| device-link | remote-agent | [apps/desktop/src/main/device-link/providerShareAvailabilityUsage.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareAvailabilityUsage.ts#L7) | [apps/desktop/src/main/remote-agent/controller/deviceCatalog.ts:124](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/controller/deviceCatalog.ts#L124) |
| device-link | remote-desktop | [apps/desktop/src/main/device-link/directLink.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/directLink.ts#L5) | [apps/desktop/src/main/remote-desktop/awayGuardService.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/awayGuardService.ts#L19) |
| device-link | remote-ssh | [apps/desktop/src/main/device-link/selfHostedRelayDeploy.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/selfHostedRelayDeploy.ts#L23) | [apps/desktop/src/main/remote-ssh/index.ts:138](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/index.ts#L138) |
| device-link | subscription-accounts | [apps/desktop/src/main/device-link/providerShareQuota.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareQuota.ts#L21) | [apps/desktop/src/main/subscription-accounts/ipc.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/ipc.ts#L4) |
| device-link | task-migration | [apps/desktop/src/main/device-link/dispatch.desktop.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L8) | [apps/desktop/src/main/task-migration/service.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L33) |
| device-link | usage | [apps/desktop/src/main/device-link/providerShareQuota.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareQuota.ts#L28) | [apps/desktop/src/main/usage/claudeAccountUsage.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/claudeAccountUsage.ts#L22) |
| device-link | voice-input | [apps/desktop/src/main/device-link/dispatch.desktop.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L27) | [apps/desktop/src/main/voice-input/dictionarySyncDriver.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/dictionarySyncDriver.ts#L23) |
| embedders | localDb | [apps/desktop/src/main/embedders/chat-history-embedder.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedders/chat-history-embedder.ts#L23) | [apps/desktop/src/main/localDb/chatHistorySearch.ts:55](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/chatHistorySearch.ts#L55) |
| embedding-host | localDb | [apps/desktop/src/main/embedding-host/EmbeddingService.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedding-host/EmbeddingService.ts#L28) | [apps/desktop/src/main/localDb/chatHistorySearch.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/chatHistorySearch.ts#L50) |
| git-context | localDb | [apps/desktop/src/main/git-context/githubReadHost.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubReadHost.ts#L4) | [apps/desktop/src/main/localDb/ipc/messages.ts:62](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L62) |
| git-context | scheduler-host | [apps/desktop/src/main/git-context/githubPrEvents.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubPrEvents.ts#L1) | [apps/desktop/src/main/scheduler-host/script-capability-broker.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/script-capability-broker.ts#L1) |
| git-review | turn-change-set | [apps/desktop/src/main/git-review/device-op.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/device-op.ts#L53) | [apps/desktop/src/main/turn-change-set/store.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L24) |
| git-snapshot | localDb | [apps/desktop/src/main/git-snapshot/savepointCleanup.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-snapshot/savepointCleanup.ts#L19) | [apps/desktop/src/main/localDb/ipc/bots.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/bots.ts#L50) |
| github-issue | maker-ipc | [apps/desktop/src/main/github-issue/issueConfirmBridge.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/issueConfirmBridge.ts#L25) | [apps/desktop/src/main/maker-ipc/my-issues.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/my-issues.ts#L18) |
| goal-host | maker-ipc | [apps/desktop/src/main/goal-host/controller.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/controller.ts#L22) | [apps/desktop/src/main/maker-ipc/goal.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/goal.ts#L25) |
| hook-control | im | [apps/desktop/src/main/hook-control/defaultRouteFollow.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/defaultRouteFollow.ts#L6) | [apps/desktop/src/main/im/index.ts:88](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/index.ts#L88) |
| hook-control | localDb | [apps/desktop/src/main/hook-control/defaultRouteFollow.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/defaultRouteFollow.ts#L4) | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:226](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L226) |
| hook-control | maker-ipc | [apps/desktop/src/main/hook-control/backgroundResults.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/backgroundResults.ts#L7) | [apps/desktop/src/main/maker-ipc/ghostErrandRunner.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/ghostErrandRunner.ts#L32) |
| hook-control | mcp-integrations | [apps/desktop/src/main/hook-control/projectCatalog.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/projectCatalog.ts#L24) | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:101](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L101) |
| im | localDb | [apps/desktop/src/main/im/binding.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/binding.ts#L37) | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:160](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L160) |
| im | maker-host | [apps/desktop/src/main/im/defaultSessionSettings.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/defaultSessionSettings.ts#L26) | [apps/desktop/src/main/maker-host/index.ts:293](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L293) |
| im | maker-ipc | [apps/desktop/src/main/im/dingtalk/interaction.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/dingtalk/interaction.ts#L5) | [apps/desktop/src/main/maker-ipc/botImAuthorization.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botImAuthorization.ts#L14) |
| im | mcp-integrations | [apps/desktop/src/main/im/shared/turnRunner.ts:87](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L87) | [apps/desktop/src/main/mcp-integrations/feishuTransportRouting.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/feishuTransportRouting.ts#L7) |
| im | remote-agent | [apps/desktop/src/main/im/remoteProviderRoute.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/remoteProviderRoute.ts#L4) | [apps/desktop/src/main/remote-agent/wire.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/wire.ts#L35) |
| im | scheduler-host | [apps/desktop/src/main/im/shared/turnRunner.ts:139](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L139) | [apps/desktop/src/main/scheduler-host/index.desktop.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L50) |
| input-handoff | maker-host | [apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts#L9) | [apps/desktop/src/main/maker-host/runtimeConfigsCore.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/runtimeConfigsCore.ts#L37) |
| input-handoff | maker-ipc | [apps/desktop/src/main/input-handoff/service.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/service.ts#L11) | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L12) |
| input-handoff | remote-desktop | [apps/desktop/src/main/input-handoff/macDriver.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/macDriver.ts#L7) | [apps/desktop/src/main/remote-desktop/index.ts:47](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/index.ts#L47) |
| learn-host | maker-ipc | [apps/desktop/src/main/learn-host/controller.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/controller.ts#L38) | [apps/desktop/src/main/maker-ipc/makerSendTransaction.ts:75](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/makerSendTransaction.ts#L75) |
| local-agent | maker-host | [apps/desktop/src/main/local-agent/service.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/service.ts#L12) | [apps/desktop/src/main/maker-host/index.ts:275](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L275) |
| local-agent | maker-ipc | [apps/desktop/src/main/local-agent/runtime.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/runtime.ts#L23) | [apps/desktop/src/main/maker-ipc/register.ts:1235](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L1235) |
| local-agent | provider-group | [apps/desktop/src/main/local-agent/groupRoute.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/groupRoute.ts#L4) | [apps/desktop/src/main/provider-group/runtime.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/runtime.ts#L10) |
| local-model-runtime | maker-host | [apps/desktop/src/main/local-model-runtime/ipc.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/ipc.ts#L1) | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:117](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L117) |
| local-model-runtime | maker-ipc | [apps/desktop/src/main/local-model-runtime/ipc.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/ipc.ts#L10) | [apps/desktop/src/main/maker-ipc/providerHandlers.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/providerHandlers.ts#L53) |
| localDb | maker-host | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L1) | [apps/desktop/src/main/maker-host/cc-remote-mcp.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/cc-remote-mcp.ts#L31) |
| localDb | maker-ipc | [apps/desktop/src/main/localDb/botProfileDeletionStore.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/botProfileDeletionStore.ts#L1) | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.desktop.ts#L2) |
| localDb | mcp-apps | [apps/desktop/src/main/localDb/ipc/messages.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L35) | [apps/desktop/src/main/mcp-apps/ipc.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/ipc.ts#L29) |
| localDb | session-import | [apps/desktop/src/main/localDb/ipc/messages.ts:59](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L59) | [apps/desktop/src/main/session-import/executor.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/executor.ts#L20) |
| localDb | session-share | [apps/desktop/src/main/localDb/ipc/session-share.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/session-share.ts#L24) | [apps/desktop/src/main/session-share/sessionShareExport.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L36) |
| localDb | task-management | [apps/desktop/src/main/localDb/client/WorkerThreadTransport.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/client/WorkerThreadTransport.ts#L12) | [apps/desktop/src/main/task-management/service.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/service.ts#L3) |
| localDb | turn-change-set | [apps/desktop/src/main/localDb/dbSlimmingMaintenance.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/dbSlimmingMaintenance.ts#L12) | [apps/desktop/src/main/turn-change-set/store.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L26) |
| localDb | usage | [apps/desktop/src/main/localDb/dailyModelUsage.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/dailyModelUsage.ts#L14) | [apps/desktop/src/main/usage/accountCurrencyStore.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/accountCurrencyStore.ts#L25) |
| localDb | voice-conversation | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:164](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L164) | [apps/desktop/src/main/voice-conversation/dialogue.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/dialogue.ts#L3) |
| localDb | worktree | [apps/desktop/src/main/localDb/ipc/createUserSession.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/createUserSession.ts#L18) | [apps/desktop/src/main/worktree/WorktreeManager.ts:66](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/WorktreeManager.ts#L66) |
| log-upload | maker-host | [apps/desktop/src/main/log-upload/index.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/log-upload/index.ts#L38) | [apps/desktop/src/main/maker-host/pi-package-diagnostic.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/pi-package-diagnostic.ts#L2) |
| log-upload | performance-trace | [apps/desktop/src/main/log-upload/index.ts:65](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/log-upload/index.ts#L65) | [apps/desktop/src/main/performance-trace/index.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/performance-trace/index.ts#L22) |
| maker-host | maker-ipc | [apps/desktop/src/main/maker-host/index.ts:108](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L108) | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:66](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L66) |
| maker-host | maker-orchestration | [apps/desktop/src/main/maker-host/claude-transcript-relocation.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/claude-transcript-relocation.ts#L33) | [apps/desktop/src/main/maker-orchestration/fork.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L30) |
| maker-host | mcp-integrations | [apps/desktop/src/main/maker-host/botMcpCatalog.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/botMcpCatalog.ts#L3) | [apps/desktop/src/main/mcp-integrations/android.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/android.ts#L28) |
| maker-host | model-access | [apps/desktop/src/main/maker-host/codex-proxy-host.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/codex-proxy-host.desktop.ts#L2) | [apps/desktop/src/main/model-access/byokRuntime.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/byokRuntime.ts#L9) |
| maker-host | provider-group | [apps/desktop/src/main/maker-host/index.ts:159](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L159) | [apps/desktop/src/main/provider-group/bindings.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/bindings.ts#L19) |
| maker-host | remote-agent | [apps/desktop/src/main/maker-host/index.ts:272](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L272) | [apps/desktop/src/main/remote-agent/attachmentPreservation.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/attachmentPreservation.ts#L6) |
| maker-host | remote-ssh | [apps/desktop/src/main/maker-host/index.ts:210](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L210) | [apps/desktop/src/main/remote-ssh/claude-env.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/claude-env.ts#L30) |
| maker-host | scheduler-host | [apps/desktop/src/main/maker-host/piPackageStoreCore.ts:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/piPackageStoreCore.ts#L52) | [apps/desktop/src/main/scheduler-host/index.desktop.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L18) |
| maker-host | skillhub | [apps/desktop/src/main/maker-host/built-in-skills.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/built-in-skills.ts#L16) | [apps/desktop/src/main/skillhub/activationPreferences.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/skillhub/activationPreferences.ts#L1) |
| maker-host | subscription-accounts | [apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts#L9) | [apps/desktop/src/main/subscription-accounts/ipc.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/ipc.ts#L29) |
| maker-host | usage | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L6) | [apps/desktop/src/main/usage/accountReferencePrice.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/accountReferencePrice.ts#L3) |
| maker-host | utility-model | [apps/desktop/src/main/maker-host/auto-review-model-router.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auto-review-model-router.ts#L7) | [apps/desktop/src/main/utility-model/auxiliaryModelSettingsStoreCore.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/auxiliaryModelSettingsStoreCore.ts#L30) |
| maker-host | vision-bridge | [apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts#L39) | [apps/desktop/src/main/vision-bridge/piVisionBridgeEnvCore.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/vision-bridge/piVisionBridgeEnvCore.ts#L20) |
| maker-host | voice-conversation | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:72](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L72) | [apps/desktop/src/main/voice-conversation/index.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/index.ts#L10) |
| maker-host | worktree | [apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts#L31) | [apps/desktop/src/main/worktree/index.ts:173](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/index.ts#L173) |
| maker-ipc | maker-orchestration | [apps/desktop/src/main/maker-ipc/fork.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/fork.ts#L19) | [apps/desktop/src/main/maker-orchestration/fork.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L37) |
| maker-ipc | mcp-apps | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L11) | [apps/desktop/src/main/mcp-apps/messageSender.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/messageSender.ts#L4) |
| maker-ipc | mcp-integrations | [apps/desktop/src/main/maker-ipc/androidHandlers.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/androidHandlers.ts#L19) | [apps/desktop/src/main/mcp-integrations/codexHttpBridge.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/codexHttpBridge.ts#L33) |
| maker-ipc | plugin-oauth | [apps/desktop/src/main/maker-ipc/botAuthorizationService.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botAuthorizationService.ts#L3) | [apps/desktop/src/main/plugin-oauth/cards.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/cards.ts#L17) |
| maker-ipc | provider-group | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L10) | [apps/desktop/src/main/provider-group/failurePolicy.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/failurePolicy.ts#L25) |
| maker-ipc | remote-agent | [apps/desktop/src/main/maker-ipc/appDefaultModelControl.ts:125](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/appDefaultModelControl.ts#L125) | [apps/desktop/src/main/remote-agent/host/runHost.ts:85](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/runHost.ts#L85) |
| maker-ipc | reviewer | [apps/desktop/src/main/maker-ipc/normalizeAttachments.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/normalizeAttachments.ts#L36) | [apps/desktop/src/main/reviewer/reviewSessionPolicy.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewSessionPolicy.ts#L1) |
| maker-ipc | scheduler-host | [apps/desktop/src/main/maker-ipc/botProjectMode.ts:43](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botProjectMode.ts#L43) | [apps/desktop/src/main/scheduler-host/index.desktop.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L41) |
| maker-ipc | session-title-rename | [apps/desktop/src/main/maker-ipc/register.ts:398](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L398) | [apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts#L11) |
| maker-ipc | turn-change-set | [apps/desktop/src/main/maker-ipc/register.ts:1023](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L1023) | [apps/desktop/src/main/turn-change-set/store.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L31) |
| maker-ipc | usage | [apps/desktop/src/main/maker-ipc/piUsageReceipts.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/piUsageReceipts.ts#L4) | [apps/desktop/src/main/usage/gatewayMediaBilling.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/gatewayMediaBilling.ts#L18) |
| maker-orchestration | remote-agent | [apps/desktop/src/main/maker-orchestration/fork.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L19) | [apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts#L5) |
| mcp-apps | mcp-integrations | [apps/desktop/src/main/mcp-apps/hostUi.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L5) | [apps/desktop/src/main/mcp-integrations/codexEnvironment.desktop.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/codexEnvironment.desktop.ts#L4) |
| mcp-integrations | remote-ssh | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:270](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L270) | [apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts:43](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts#L43) |
| mcp-integrations | scheduler-host | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:104](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L104) | [apps/desktop/src/main/scheduler-host/runner.ts:114](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/runner.ts#L114) |
| mcp-integrations | session-share | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L50) | [apps/desktop/src/main/session-share/sessionShareTools.desktop.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareTools.desktop.ts#L4) |
| mcp-integrations | terminal | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L11) | [apps/desktop/src/main/terminal/terminalToolAccess.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/terminal/terminalToolAccess.ts#L4) |
| menubar | quota-overview | [apps/desktop/src/main/menubar/service.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/menubar/service.ts#L18) | [apps/desktop/src/main/quota-overview/panelController.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L36) |
| model-access | secrets | [apps/desktop/src/main/model-access/gatewayConnection.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/gatewayConnection.ts#L3) | [apps/desktop/src/main/secrets/providerSecretStore.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/secrets/providerSecretStore.ts#L7) |
| model-access | usage | [apps/desktop/src/main/model-access/index.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/index.ts#L7) | [apps/desktop/src/main/usage/claudeAccountUsage.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/claudeAccountUsage.ts#L1) |
| plugin-market | plugin-publisher | [apps/desktop/src/main/plugin-market/localSharing.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-market/localSharing.ts#L20) | [apps/desktop/src/main/plugin-publisher/host.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-publisher/host.ts#L19) |
| provider-group | remote-agent | [apps/desktop/src/main/provider-group/continuityRuntime.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/continuityRuntime.ts#L1) | [apps/desktop/src/main/remote-agent/controller/service.ts:58](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/controller/service.ts#L58) |
| provider-group | subscription-accounts | [apps/desktop/src/main/provider-group/runtime.ts:40](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/runtime.ts#L40) | [apps/desktop/src/main/subscription-accounts/legacyQuota.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/legacyQuota.ts#L2) |
| remote-agent | usage | [apps/desktop/src/main/remote-agent/host/guestUsage.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/guestUsage.ts#L9) | [apps/desktop/src/main/usage/providerPartyUsageStore.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/providerPartyUsageStore.ts#L25) |
| scheduler-host | worktree | [apps/desktop/src/main/scheduler-host/restore-target.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/restore-target.desktop.ts#L2) | [apps/desktop/src/main/worktree/gitExec.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/gitExec.ts#L20) |
| subscription-accounts | usage | [apps/desktop/src/main/subscription-accounts/runtime.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/runtime.ts#L53) | [apps/desktop/src/main/usage/codexDefaultAccountHome.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/codexDefaultAccountHome.ts#L19) |
| task-migration | worktree | [apps/desktop/src/main/task-migration/portableEntries.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/portableEntries.ts#L2) | [apps/desktop/src/main/worktree/recoveryArchiveTask.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/recoveryArchiveTask.ts#L3) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| agent-app-update | device-link | 1 → 17 → 1 | [apps/desktop/src/main/agent-app-update/index.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-app-update/index.ts#L21) |
| agent-app-update | localDb | 1 → 35 → 17 → 1 | [apps/desktop/src/main/agent-app-update/index.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-app-update/index.ts#L22) |
| agent-app-update | maker-ipc | 1 → 39 → 1 | [apps/desktop/src/main/agent-app-update/callerAuthority.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-app-update/callerAuthority.ts#L3) |
| agent-binaries | cindy-make | 2 → 11 → 38 → 2 | [apps/desktop/src/main/agent-binaries/background-update.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-binaries/background-update.ts#L2) |
| agent-binaries | device-link | 2 → 17 → 38 → 2 | [apps/desktop/src/main/agent-binaries/download-cache.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-binaries/download-cache.ts#L6) |
| agent-binaries | git-context | 2 → 23 → 38 → 2 | [apps/desktop/src/main/agent-binaries/pi-self-update.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-binaries/pi-self-update.ts#L13) |
| agent-island | cindy-media | 3 → 12 → 28 → 3 | [apps/desktop/src/main/agent-island/companionIdentity.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/companionIdentity.ts#L10) |
| agent-island | device-link | 3 → 17 → 35 → 3 | [apps/desktop/src/main/agent-island/archiveConfirmation.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/archiveConfirmation.ts#L4) |
| agent-island | im | 3 → 29 → 28 → 3 | [apps/desktop/src/main/agent-island/service.ts:97](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/service.ts#L97) |
| agent-island | localDb | 3 → 35 → 3 | [apps/desktop/src/main/agent-island/companionIdentity.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/companionIdentity.ts#L11) |
| agent-island | menubar | 3 → 43 → 53 → 3 | [apps/desktop/src/main/agent-island/quota.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/quota.ts#L17) |
| agent-island | quota-overview | 3 → 53 → 3 | [apps/desktop/src/main/agent-island/quota.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/quota.ts#L18) |
| agent-island | scheduler-host | 3 → 60 → 3 | [apps/desktop/src/main/agent-island/archiveConfirmation.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/archiveConfirmation.ts#L6) |
| agent-island | worktree | 3 → 76 → 35 → 3 | [apps/desktop/src/main/agent-island/archiveConfirmation.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/agent-island/archiveConfirmation.ts#L5) |
| app-settings | cindy-media | 4 → 12 → 8 → 4 | [apps/desktop/src/main/app-settings/models.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/models.ts#L8) |
| app-settings | maker-host | 4 → 38 → 8 → 4 | [apps/desktop/src/main/app-settings/connections.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/connections.ts#L11) |
| app-settings | maker-ipc | 4 → 39 → 4 | [apps/desktop/src/main/app-settings/connections.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/connections.ts#L10) |
| app-settings | model-access | 4 → 44 → 8 → 4 | [apps/desktop/src/main/app-settings/models.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/models.ts#L7) |
| app-settings | subscription-accounts | 4 → 66 → 17 → 8 → 4 | [apps/desktop/src/main/app-settings/models.ts:122](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/models.ts#L122) |
| app-settings | task-management | 4 → 67 → 17 → 8 → 4 | [apps/desktop/src/main/app-settings/sections.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/app-settings/sections.ts#L14) |
| appearance | cindy-media | 5 → 12 → 8 → 5 | [apps/desktop/src/main/appearance/resources.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/appearance/resources.ts#L2) |
| appearance | local-themes | 5 → 34 → 5 | [apps/desktop/src/main/appearance/themes.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/appearance/themes.ts#L5) |
| appearance | maker-host | 5 → 38 → 8 → 5 | [apps/desktop/src/main/appearance/service.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/appearance/service.ts#L4) |
| bot-import | cindy-media | 6 → 12 → 35 → 6 | [apps/desktop/src/main/bot-import/memoryFiles.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/memoryFiles.ts#L3) |
| bot-import | device-link | 6 → 17 → 35 → 6 | [apps/desktop/src/main/bot-import/registration.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/registration.ts#L3) |
| bot-import | im | 6 → 29 → 35 → 6 | [apps/desktop/src/main/bot-import/imBotConnections.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/imBotConnections.ts#L7) |
| bot-import | localDb | 6 → 35 → 6 | [apps/desktop/src/main/bot-import/host.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/host.ts#L3) |
| bot-import | maker-host | 6 → 38 → 6 | [apps/desktop/src/main/bot-import/probeAuthorization.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/probeAuthorization.ts#L3) |
| bot-import | maker-ipc | 6 → 39 → 6 | [apps/desktop/src/main/bot-import/connectionProvider.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/connectionProvider.ts#L1) |
| bot-import | scheduler-host | 6 → 60 → 35 → 6 | [apps/desktop/src/main/bot-import/process.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/process.ts#L3) |
| bot-import | secrets | 6 → 61 → 44 → 38 → 6 | [apps/desktop/src/main/bot-import/runtime.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/bot-import/runtime.ts#L5) |
| browser-extension | device-link | 7 → 17 → 8 → 7 | [apps/desktop/src/main/browser-extension/native-binding.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/browser-extension/native-binding.ts#L19) |
| cindy-brain | app-settings | 8 → 4 → 12 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L17) |
| cindy-brain | appearance | 8 → 5 → 12 → 8 | [apps/desktop/src/main/cindy-brain/pluginAppearanceResources.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/pluginAppearanceResources.ts#L2) |
| cindy-brain | browser-extension | 8 → 7 → 17 → 8 | [apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts#L35) |
| cindy-brain | cindy-evaluate | 8 → 9 → 8 | [apps/desktop/src/main/cindy-brain/cindySlot.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindySlot.ts#L1) |
| cindy-brain | cindy-media | 8 → 12 → 8 | [apps/desktop/src/main/cindy-brain/cindySlot.ts:87](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindySlot.ts#L87) |
| cindy-brain | cindy-proxy-media | 8 → 13 → 12 → 8 | [apps/desktop/src/main/cindy-brain/byokImageChannel.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/byokImageChannel.ts#L22) |
| cindy-brain | device-link | 8 → 17 → 8 | [apps/desktop/src/main/cindy-brain/cardRemoteResource.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cardRemoteResource.ts#L9) |
| cindy-brain | device-sync-keys | 8 → 18 → 17 → 8 | [apps/desktop/src/main/cindy-brain/deviceSyncSlot.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/deviceSyncSlot.ts#L11) |
| cindy-brain | embedding-host | 8 → 21 → 35 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:6138](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L6138) |
| cindy-brain | git-context | 8 → 23 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:748](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L748) |
| cindy-brain | im | 8 → 29 → 12 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:750](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L750) |
| cindy-brain | localDb | 8 → 35 → 8 | [apps/desktop/src/main/cindy-brain/cardStoreDb.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cardStoreDb.ts#L16) |
| cindy-brain | maker-host | 8 → 38 → 8 | [apps/desktop/src/main/cindy-brain/cindyPrefsStore.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindyPrefsStore.ts#L17) |
| cindy-brain | maker-ipc | 8 → 39 → 8 | [apps/desktop/src/main/cindy-brain/ghostGrantConfirmBridge.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/ghostGrantConfirmBridge.ts#L22) |
| cindy-brain | mcp-apps | 8 → 41 → 8 | [apps/desktop/src/main/cindy-brain/GhostManager.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/GhostManager.ts#L2) |
| cindy-brain | mcp-integrations | 8 → 42 → 8 | [apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/browserExtensionSlot.ts#L48) |
| cindy-brain | model-access | 8 → 44 → 8 | [apps/desktop/src/main/cindy-brain/cindyGatewayReadiness.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindyGatewayReadiness.ts#L9) |
| cindy-brain | plugin-market | 8 → 47 → 8 | [apps/desktop/src/main/cindy-brain/builtinSeedStoreInstall.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/builtinSeedStoreInstall.ts#L5) |
| cindy-brain | plugin-oauth | 8 → 48 → 8 | [apps/desktop/src/main/cindy-brain/ghostOauthAccounts.ts:1031](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/ghostOauthAccounts.ts#L1031) |
| cindy-brain | plugin-publisher | 8 → 49 → 8 | [apps/desktop/src/main/cindy-brain/connectionAudienceResolver.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/connectionAudienceResolver.ts#L24) |
| cindy-brain | plugin-usage | 8 → 50 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:660](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L660) |
| cindy-brain | remote-desktop-viewer | 8 → 56 → 17 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:556](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L556) |
| cindy-brain | secrets | 8 → 61 → 44 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:715](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L715) |
| cindy-brain | skillhub | 8 → 65 → 17 → 8 | [apps/desktop/src/main/cindy-brain/skillSlot.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/skillSlot.ts#L29) |
| cindy-brain | terminal | 8 → 69 → 8 | [apps/desktop/src/main/cindy-brain/index.ts:745](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/index.ts#L745) |
| cindy-brain | utility-model | 8 → 72 → 38 → 8 | [apps/desktop/src/main/cindy-brain/cindySlot.ts:90](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-brain/cindySlot.ts#L90) |
| cindy-evaluate | cindy-brain | 9 → 8 → 9 | [apps/desktop/src/main/cindy-evaluate/models.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/models.ts#L1) |
| cindy-evaluate | maker-host | 9 → 38 → 9 | [apps/desktop/src/main/cindy-evaluate/models.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/models.ts#L4) |
| cindy-evaluate | model-access | 9 → 44 → 8 → 9 | [apps/desktop/src/main/cindy-evaluate/service.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/service.ts#L5) |
| cindy-evaluate | usage | 9 → 71 → 38 → 9 | [apps/desktop/src/main/cindy-evaluate/service.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-evaluate/service.ts#L10) |
| cindy-files | cindy-brain | 10 → 8 → 5 → 34 → 10 | [apps/desktop/src/main/cindy-files/reader.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-files/reader.ts#L10) |
| cindy-files | local-themes | 10 → 34 → 10 | [apps/desktop/src/main/cindy-files/register.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-files/register.ts#L6) |
| cindy-make | cindy-brain | 11 → 8 → 35 → 11 | [apps/desktop/src/main/cindy-make/completion.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/completion.ts#L9) |
| cindy-make | cindy-media | 11 → 12 → 35 → 11 | [apps/desktop/src/main/cindy-make/toolsDirectory.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/toolsDirectory.ts#L5) |
| cindy-make | commands | 11 → 14 → 11 | [apps/desktop/src/main/cindy-make/doctorCommand.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/doctorCommand.ts#L6) |
| cindy-make | device-link | 11 → 17 → 35 → 11 | [apps/desktop/src/main/cindy-make/doctorCommand.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/doctorCommand.ts#L5) |
| cindy-make | git-context | 11 → 23 → 35 → 11 | [apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts#L10) |
| cindy-make | localDb | 11 → 35 → 11 | [apps/desktop/src/main/cindy-make/historyRuntime.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/historyRuntime.ts#L6) |
| cindy-make | maker-host | 11 → 38 → 11 | [apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts#L11) |
| cindy-make | maker-ipc | 11 → 39 → 11 | [apps/desktop/src/main/cindy-make/stateBroadcast.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/stateBroadcast.ts#L3) |
| cindy-make | secrets | 11 → 61 → 44 → 38 → 11 | [apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/personalRemoteRuntime.ts#L12) |
| cindy-make | terminal | 11 → 69 → 42 → 2 → 11 | [apps/desktop/src/main/cindy-make/personalBuild.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-make/personalBuild.ts#L16) |
| cindy-media | cindy-brain | 12 → 8 → 12 | [apps/desktop/src/main/cindy-media/customVideoProtocol.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/customVideoProtocol.ts#L2) |
| cindy-media | device-link | 12 → 17 → 12 | [apps/desktop/src/main/cindy-media/clientWallpaperLock.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/clientWallpaperLock.ts#L3) |
| cindy-media | file-browser | 12 → 22 → 12 | [apps/desktop/src/main/cindy-media/toolProcessMediaCore.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/toolProcessMediaCore.ts#L6) |
| cindy-media | hook-control | 12 → 28 → 12 | [apps/desktop/src/main/cindy-media/hookOutbox.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/hookOutbox.ts#L8) |
| cindy-media | im | 12 → 29 → 12 | [apps/desktop/src/main/cindy-media/pluginMessageAttachments.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/pluginMessageAttachments.ts#L12) |
| cindy-media | localDb | 12 → 35 → 12 | [apps/desktop/src/main/cindy-media/attachmentGrantGate.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/attachmentGrantGate.ts#L19) |
| cindy-media | maker-host | 12 → 38 → 12 | [apps/desktop/src/main/cindy-media/invocationService.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/invocationService.ts#L25) |
| cindy-media | maker-ipc | 12 → 39 → 12 | [apps/desktop/src/main/cindy-media/mediaDownloadApproval.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/mediaDownloadApproval.ts#L4) |
| cindy-media | model-access | 12 → 44 → 12 | [apps/desktop/src/main/cindy-media/invocationService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/invocationService.ts#L1) |
| cindy-media | usage | 12 → 71 → 17 → 12 | [apps/desktop/src/main/cindy-media/invocationService.ts:1563](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-media/invocationService.ts#L1563) |
| cindy-proxy-media | cindy-media | 13 → 12 → 8 → 13 | [apps/desktop/src/main/cindy-proxy-media/api/gatewayImageClient.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-proxy-media/api/gatewayImageClient.ts#L14) |
| cindy-proxy-media | utility-model | 13 → 72 → 38 → 8 → 13 | [apps/desktop/src/main/cindy-proxy-media/service.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/cindy-proxy-media/service.ts#L4) |
| commands | cindy-make | 14 → 11 → 14 | [apps/desktop/src/main/commands/builtins.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L22) |
| commands | device-link | 14 → 17 → 39 → 14 | [apps/desktop/src/main/commands/remoteCmdIpc.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/remoteCmdIpc.ts#L25) |
| commands | goal-host | 14 → 27 → 39 → 14 | [apps/desktop/src/main/commands/builtins.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L32) |
| commands | learn-host | 14 → 31 → 39 → 14 | [apps/desktop/src/main/commands/builtins.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L33) |
| commands | maker-host | 14 → 38 → 11 → 14 | [apps/desktop/src/main/commands/builtins.ts:398](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L398) |
| commands | maker-ipc | 14 → 39 → 14 | [apps/desktop/src/main/commands/builtins.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/commands/builtins.ts#L17) |
| companion-cloud | cindy-media | 15 → 12 → 28 → 15 | [apps/desktop/src/main/companion-cloud/avatarCacheHost.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/avatarCacheHost.ts#L6) |
| companion-cloud | device-link | 15 → 17 → 35 → 15 | [apps/desktop/src/main/companion-cloud/avatarCacheHost.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/avatarCacheHost.ts#L10) |
| companion-cloud | git-snapshot | 15 → 25 → 35 → 15 | [apps/desktop/src/main/companion-cloud/projectHost.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/projectHost.ts#L11) |
| companion-cloud | im | 15 → 29 → 28 → 15 | [apps/desktop/src/main/companion-cloud/avatarCacheHost.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/avatarCacheHost.ts#L13) |
| companion-cloud | localDb | 15 → 35 → 15 | [apps/desktop/src/main/companion-cloud/avatarCacheHost.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/avatarCacheHost.ts#L12) |
| companion-cloud | maker-host | 15 → 38 → 35 → 15 | [apps/desktop/src/main/companion-cloud/host.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/host.ts#L24) |
| companion-cloud | maker-ipc | 15 → 39 → 15 | [apps/desktop/src/main/companion-cloud/host.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/host.ts#L23) |
| companion-cloud | scheduler-host | 15 → 60 → 15 | [apps/desktop/src/main/companion-cloud/projectHost.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/projectHost.ts#L22) |
| companion-cloud | session-share | 15 → 63 → 35 → 15 | [apps/desktop/src/main/companion-cloud/replyArtifacts.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/companion-cloud/replyArtifacts.ts#L12) |
| computer-permission-guide | maker-ipc | 16 → 39 → 16 | [apps/desktop/src/main/computer-permission-guide/window.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/computer-permission-guide/window.ts#L25) |
| computer-permission-guide | mcp-integrations | 16 → 42 → 39 → 16 | [apps/desktop/src/main/computer-permission-guide/switch-target.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/computer-permission-guide/switch-target.ts#L8) |
| device-link | agent-app-update | 17 → 1 → 17 | [apps/desktop/src/main/device-link/sharedTaskDispatch.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/sharedTaskDispatch.ts#L5) |
| device-link | cindy-brain | 17 → 8 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L38) |
| device-link | cindy-media | 17 → 12 → 17 | [apps/desktop/src/main/device-link/mediaFetch.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/mediaFetch.ts#L33) |
| device-link | file-browser | 17 → 22 → 17 | [apps/desktop/src/main/device-link/mediaFetch.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/mediaFetch.ts#L35) |
| device-link | localDb | 17 → 35 → 17 | [apps/desktop/src/main/device-link/agentNetSharing.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/agentNetSharing.ts#L27) |
| device-link | maker-host | 17 → 38 → 17 | [apps/desktop/src/main/device-link/agentNetOfficial.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/agentNetOfficial.ts#L12) |
| device-link | maker-ipc | 17 → 39 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L33) |
| device-link | mcp-apps | 17 → 41 → 17 | [apps/desktop/src/main/device-link/sharedTaskMessageOrigin.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/sharedTaskMessageOrigin.ts#L3) |
| device-link | menubar | 17 → 43 → 38 → 17 | [apps/desktop/src/main/device-link/providerShareQuota.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareQuota.ts#L17) |
| device-link | performance-trace | 17 → 45 → 36 → 38 → 17 | [apps/desktop/src/main/device-link/invoke-registry.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/invoke-registry.ts#L17) |
| device-link | plugin-oauth | 17 → 48 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L15) |
| device-link | provider-group | 17 → 51 → 17 | [apps/desktop/src/main/device-link/providerShareAvailability.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareAvailability.ts#L5) |
| device-link | quota-overview | 17 → 53 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L2) |
| device-link | remote-agent | 17 → 54 → 17 | [apps/desktop/src/main/device-link/providerShareAvailabilityUsage.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareAvailabilityUsage.ts#L7) |
| device-link | remote-desktop | 17 → 55 → 17 | [apps/desktop/src/main/device-link/directLink.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/directLink.ts#L5) |
| device-link | remote-ssh | 17 → 57 → 17 | [apps/desktop/src/main/device-link/selfHostedRelayDeploy.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/selfHostedRelayDeploy.ts#L23) |
| device-link | reviewer | 17 → 58 → 12 → 17 | [apps/desktop/src/main/device-link/ipc.ts:56](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/ipc.ts#L56) |
| device-link | subscription-accounts | 17 → 66 → 17 | [apps/desktop/src/main/device-link/providerShareQuota.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareQuota.ts#L21) |
| device-link | task-migration | 17 → 68 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L8) |
| device-link | usage | 17 → 71 → 17 | [apps/desktop/src/main/device-link/providerShareQuota.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/providerShareQuota.ts#L28) |
| device-link | voice-input | 17 → 75 → 17 | [apps/desktop/src/main/device-link/dispatch.desktop.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-link/dispatch.desktop.ts#L27) |
| device-sync-keys | device-link | 18 → 17 → 8 → 18 | [apps/desktop/src/main/device-sync-keys/keyStore.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/device-sync-keys/keyStore.ts#L16) |
| doc-tools | reviewer | 19 → 58 → 39 → 42 → 19 | [apps/desktop/src/main/doc-tools/pdfInspector.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/doc-tools/pdfInspector.ts#L21) |
| embedders | embedding-host | 20 → 21 → 35 → 20 | [apps/desktop/src/main/embedders/chat-history-embedder.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedders/chat-history-embedder.ts#L21) |
| embedders | localDb | 20 → 35 → 20 | [apps/desktop/src/main/embedders/chat-history-embedder.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedders/chat-history-embedder.ts#L23) |
| embedding-host | localDb | 21 → 35 → 21 | [apps/desktop/src/main/embedding-host/EmbeddingService.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedding-host/EmbeddingService.ts#L28) |
| embedding-host | maker-host | 21 → 38 → 8 → 21 | [apps/desktop/src/main/embedding-host/EmbeddingService.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedding-host/EmbeddingService.ts#L32) |
| embedding-host | usage | 21 → 71 → 35 → 21 | [apps/desktop/src/main/embedding-host/index.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/embedding-host/index.ts#L1) |
| file-browser | cindy-brain | 22 → 8 → 12 → 22 | [apps/desktop/src/main/file-browser/chat-download.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/chat-download.ts#L19) |
| file-browser | cindy-media | 22 → 12 → 22 | [apps/desktop/src/main/file-browser/html-preview-ipc.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/html-preview-ipc.ts#L13) |
| file-browser | device-link | 22 → 17 → 22 | [apps/desktop/src/main/file-browser/device-op.ts:73](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/device-op.ts#L73) |
| file-browser | localDb | 22 → 35 → 12 → 22 | [apps/desktop/src/main/file-browser/device-op.ts:66](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/device-op.ts#L66) |
| file-browser | maker-host | 22 → 38 → 12 → 22 | [apps/desktop/src/main/file-browser/device-op.ts:82](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/device-op.ts#L82) |
| file-browser | remote-ssh | 22 → 57 → 17 → 22 | [apps/desktop/src/main/file-browser/index.ts:49](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/index.ts#L49) |
| file-browser | task-migration | 22 → 68 → 12 → 22 | [apps/desktop/src/main/file-browser/chat-download.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/file-browser/chat-download.ts#L20) |
| git-context | cindy-brain | 23 → 8 → 23 | [apps/desktop/src/main/git-context/githubSetupIpc.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubSetupIpc.ts#L18) |
| git-context | device-link | 23 → 17 → 8 → 23 | [apps/desktop/src/main/git-context/ipc.ts:60](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/ipc.ts#L60) |
| git-context | localDb | 23 → 35 → 23 | [apps/desktop/src/main/git-context/githubReadHost.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubReadHost.ts#L4) |
| git-context | maker-host | 23 → 38 → 2 → 23 | [apps/desktop/src/main/git-context/githubReadHost.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubReadHost.ts#L6) |
| git-context | remote-ssh | 23 → 57 → 35 → 23 | [apps/desktop/src/main/git-context/ipc.ts:59](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/ipc.ts#L59) |
| git-context | scheduler-host | 23 → 60 → 23 | [apps/desktop/src/main/git-context/githubPrEvents.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubPrEvents.ts#L1) |
| git-context | secrets | 23 → 61 → 44 → 8 → 23 | [apps/desktop/src/main/git-context/githubSetupIpc.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/githubSetupIpc.ts#L10) |
| git-context | worktree | 23 → 76 → 35 → 23 | [apps/desktop/src/main/git-context/ipc.ts:62](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-context/ipc.ts#L62) |
| git-review | file-browser | 24 → 22 → 8 → 39 → 24 | [apps/desktop/src/main/git-review/sshReviewBackend.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/sshReviewBackend.ts#L16) |
| git-review | git-context | 24 → 23 → 8 → 39 → 24 | [apps/desktop/src/main/git-review/scopeResolver.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/scopeResolver.ts#L14) |
| git-review | git-snapshot | 24 → 25 → 35 → 39 → 24 | [apps/desktop/src/main/git-review/ipc.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/ipc.ts#L13) |
| git-review | localDb | 24 → 35 → 39 → 24 | [apps/desktop/src/main/git-review/scopeResolver.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/scopeResolver.ts#L15) |
| git-review | remote-ssh | 24 → 57 → 17 → 39 → 24 | [apps/desktop/src/main/git-review/sshReviewBackend.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/sshReviewBackend.ts#L17) |
| git-review | turn-change-set | 24 → 70 → 24 | [apps/desktop/src/main/git-review/device-op.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/device-op.ts#L53) |
| git-review | worktree | 24 → 76 → 17 → 39 → 24 | [apps/desktop/src/main/git-review/scopeResolver.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-review/scopeResolver.ts#L17) |
| git-snapshot | localDb | 25 → 35 → 25 | [apps/desktop/src/main/git-snapshot/savepointCleanup.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-snapshot/savepointCleanup.ts#L19) |
| git-snapshot | worktree | 25 → 76 → 35 → 25 | [apps/desktop/src/main/git-snapshot/codexFileRestoreExecutor.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/git-snapshot/codexFileRestoreExecutor.ts#L15) |
| github-issue | cindy-brain | 26 → 8 → 39 → 26 | [apps/desktop/src/main/github-issue/cindyGithubGhostDeps.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/cindyGithubGhostDeps.ts#L12) |
| github-issue | git-context | 26 → 23 → 8 → 39 → 26 | [apps/desktop/src/main/github-issue/myIssuesRuntime.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/myIssuesRuntime.ts#L27) |
| github-issue | learn-host | 26 → 31 → 39 → 26 | [apps/desktop/src/main/github-issue/githubIssueSubmitService.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/githubIssueSubmitService.ts#L24) |
| github-issue | log-upload | 26 → 36 → 38 → 39 → 26 | [apps/desktop/src/main/github-issue/index.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/index.ts#L29) |
| github-issue | maker-host | 26 → 38 → 39 → 26 | [apps/desktop/src/main/github-issue/myIssuesRuntime.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/myIssuesRuntime.ts#L29) |
| github-issue | maker-ipc | 26 → 39 → 26 | [apps/desktop/src/main/github-issue/issueConfirmBridge.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/issueConfirmBridge.ts#L25) |
| github-issue | secrets | 26 → 61 → 44 → 8 → 39 → 26 | [apps/desktop/src/main/github-issue/cindyGithubGhostDeps.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/github-issue/cindyGithubGhostDeps.ts#L15) |
| goal-host | device-link | 27 → 17 → 39 → 27 | [apps/desktop/src/main/goal-host/index.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/index.ts#L23) |
| goal-host | localDb | 27 → 35 → 28 → 27 | [apps/desktop/src/main/goal-host/inactiveNote.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/inactiveNote.ts#L19) |
| goal-host | maker-host | 27 → 38 → 29 → 27 | [apps/desktop/src/main/goal-host/index.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/index.ts#L25) |
| goal-host | maker-ipc | 27 → 39 → 27 | [apps/desktop/src/main/goal-host/controller.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/controller.ts#L22) |
| goal-host | usage | 27 → 71 → 39 → 27 | [apps/desktop/src/main/goal-host/index.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/goal-host/index.ts#L31) |
| hook-control | agent-island | 28 → 3 → 12 → 28 | [apps/desktop/src/main/hook-control/ipc.ts:143](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/ipc.ts#L143) |
| hook-control | cindy-media | 28 → 12 → 28 | [apps/desktop/src/main/hook-control/dispatcher.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/dispatcher.ts#L37) |
| hook-control | companion-cloud | 28 → 15 → 12 → 28 | [apps/desktop/src/main/hook-control/xCompanion.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/xCompanion.ts#L1) |
| hook-control | goal-host | 28 → 27 → 35 → 28 | [apps/desktop/src/main/hook-control/session-runner.ts:88](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/session-runner.ts#L88) |
| hook-control | im | 28 → 29 → 28 | [apps/desktop/src/main/hook-control/defaultRouteFollow.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/defaultRouteFollow.ts#L6) |
| hook-control | localDb | 28 → 35 → 28 | [apps/desktop/src/main/hook-control/defaultRouteFollow.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/defaultRouteFollow.ts#L4) |
| hook-control | maker-host | 28 → 38 → 12 → 28 | [apps/desktop/src/main/hook-control/ipc.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/ipc.ts#L32) |
| hook-control | maker-ipc | 28 → 39 → 28 | [apps/desktop/src/main/hook-control/backgroundResults.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/backgroundResults.ts#L7) |
| hook-control | mcp-integrations | 28 → 42 → 28 | [apps/desktop/src/main/hook-control/projectCatalog.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/projectCatalog.ts#L24) |
| hook-control | scheduler-host | 28 → 60 → 29 → 28 | [apps/desktop/src/main/hook-control/backgroundResults.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/backgroundResults.ts#L6) |
| hook-control | turn-change-set | 28 → 70 → 35 → 28 | [apps/desktop/src/main/hook-control/session-runner.ts:74](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/session-runner.ts#L74) |
| hook-control | utility-model | 28 → 72 → 38 → 12 → 28 | [apps/desktop/src/main/hook-control/modelProviderName.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/modelProviderName.ts#L16) |
| hook-control | worktree | 28 → 76 → 35 → 28 | [apps/desktop/src/main/hook-control/ipc.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/hook-control/ipc.ts#L35) |
| im | cindy-media | 29 → 12 → 29 | [apps/desktop/src/main/im/host.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/host.ts#L41) |
| im | device-link | 29 → 17 → 8 → 29 | [apps/desktop/src/main/im/remoteProviderRoute.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/remoteProviderRoute.ts#L17) |
| im | goal-host | 29 → 27 → 35 → 29 | [apps/desktop/src/main/im/shared/turnRunner.ts:138](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L138) |
| im | hook-control | 29 → 28 → 29 | [apps/desktop/src/main/im/index.ts:88](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/index.ts#L88) |
| im | localDb | 29 → 35 → 29 | [apps/desktop/src/main/im/binding.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/binding.ts#L37) |
| im | maker-host | 29 → 38 → 29 | [apps/desktop/src/main/im/defaultSessionSettings.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/defaultSessionSettings.ts#L26) |
| im | maker-ipc | 29 → 39 → 29 | [apps/desktop/src/main/im/dingtalk/interaction.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/dingtalk/interaction.ts#L5) |
| im | mcp-integrations | 29 → 42 → 29 | [apps/desktop/src/main/im/shared/turnRunner.ts:87](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L87) |
| im | remote-agent | 29 → 54 → 29 | [apps/desktop/src/main/im/remoteProviderRoute.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/remoteProviderRoute.ts#L4) |
| im | scheduler-host | 29 → 60 → 29 | [apps/desktop/src/main/im/shared/turnRunner.ts:139](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L139) |
| im | secrets | 29 → 61 → 44 → 8 → 29 | [apps/desktop/src/main/im/shared/apiKey.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/apiKey.ts#L13) |
| im | turn-change-set | 29 → 70 → 35 → 29 | [apps/desktop/src/main/im/shared/turnRunner.ts:128](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/turnRunner.ts#L128) |
| im | utility-model | 29 → 72 → 38 → 29 | [apps/desktop/src/main/im/shared/ambientReplyJudge.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/ambientReplyJudge.ts#L19) |
| input-handoff | cindy-brain | 30 → 8 → 38 → 30 | [apps/desktop/src/main/input-handoff/askpass/githubRecovery.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecovery.ts#L6) |
| input-handoff | cindy-media | 30 → 12 → 38 → 30 | [apps/desktop/src/main/input-handoff/pictureRef.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/pictureRef.ts#L5) |
| input-handoff | git-context | 30 → 23 → 38 → 30 | [apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts#L7) |
| input-handoff | localDb | 30 → 35 → 38 → 30 | [apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts#L6) |
| input-handoff | maker-host | 30 → 38 → 30 | [apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts#L9) |
| input-handoff | maker-ipc | 30 → 39 → 30 | [apps/desktop/src/main/input-handoff/service.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/service.ts#L11) |
| input-handoff | remote-desktop | 30 → 55 → 30 | [apps/desktop/src/main/input-handoff/macDriver.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/macDriver.ts#L7) |
| input-handoff | secrets | 30 → 61 → 44 → 38 → 30 | [apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-handoff/askpass/githubRecoveryHost.ts#L10) |
| learn-host | device-link | 31 → 17 → 39 → 31 | [apps/desktop/src/main/learn-host/registerIpc.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/registerIpc.ts#L12) |
| learn-host | localDb | 31 → 35 → 39 → 31 | [apps/desktop/src/main/learn-host/captureInvocation.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/captureInvocation.ts#L5) |
| learn-host | maker-host | 31 → 38 → 39 → 31 | [apps/desktop/src/main/learn-host/apply.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/apply.ts#L26) |
| learn-host | maker-ipc | 31 → 39 → 31 | [apps/desktop/src/main/learn-host/controller.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/controller.ts#L38) |
| learn-host | scheduler-host | 31 → 60 → 39 → 31 | [apps/desktop/src/main/learn-host/index.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/index.ts#L36) |
| learn-host | skillhub | 31 → 65 → 17 → 39 → 31 | [apps/desktop/src/main/learn-host/apply.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/learn-host/apply.ts#L23) |
| local-agent | cindy-make | 32 → 11 → 38 → 32 | [apps/desktop/src/main/local-agent/service.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/service.ts#L24) |
| local-agent | device-link | 32 → 17 → 38 → 32 | [apps/desktop/src/main/local-agent/remoteCatalog.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/remoteCatalog.ts#L4) |
| local-agent | maker-host | 32 → 38 → 32 | [apps/desktop/src/main/local-agent/service.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/service.ts#L12) |
| local-agent | maker-ipc | 32 → 39 → 32 | [apps/desktop/src/main/local-agent/runtime.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/runtime.ts#L23) |
| local-agent | provider-group | 32 → 51 → 32 | [apps/desktop/src/main/local-agent/groupRoute.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/groupRoute.ts#L4) |
| local-agent | remote-agent | 32 → 54 → 38 → 32 | [apps/desktop/src/main/local-agent/remoteCatalog.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-agent/remoteCatalog.ts#L3) |
| local-model-runtime | device-link | 33 → 17 → 38 → 33 | [apps/desktop/src/main/local-model-runtime/llamaCppService.ts:47](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/llamaCppService.ts#L47) |
| local-model-runtime | maker-host | 33 → 38 → 33 | [apps/desktop/src/main/local-model-runtime/ipc.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/ipc.ts#L1) |
| local-model-runtime | maker-ipc | 33 → 39 → 33 | [apps/desktop/src/main/local-model-runtime/ipc.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/ipc.ts#L10) |
| local-model-runtime | reviewer | 33 → 58 → 39 → 33 | [apps/desktop/src/main/local-model-runtime/llamaCppService.ts:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/llamaCppService.ts#L52) |
| local-model-runtime | scheduler-host | 33 → 60 → 38 → 33 | [apps/desktop/src/main/local-model-runtime/llamaCppService.ts:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-model-runtime/llamaCppService.ts#L46) |
| local-themes | app-settings | 34 → 4 → 38 → 42 → 34 | [apps/desktop/src/main/local-themes/agent.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/agent.ts#L7) |
| local-themes | appearance | 34 → 5 → 34 | [apps/desktop/src/main/local-themes/packages.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/packages.ts#L7) |
| local-themes | cindy-brain | 34 → 8 → 5 → 34 | [apps/desktop/src/main/local-themes/agent.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/agent.ts#L8) |
| local-themes | cindy-files | 34 → 10 → 34 | [apps/desktop/src/main/local-themes/agent.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/agent.ts#L9) |
| local-themes | device-link | 34 → 17 → 8 → 5 → 34 | [apps/desktop/src/main/local-themes/packages.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/local-themes/packages.ts#L10) |
| localDb | agent-island | 35 → 3 → 35 | [apps/desktop/src/main/localDb/agentIslandSessionPatch.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/agentIslandSessionPatch.ts#L19) |
| localDb | bot-import | 35 → 6 → 35 | [apps/desktop/src/main/localDb/ipc/registerAll.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/registerAll.ts#L2) |
| localDb | cindy-brain | 35 → 8 → 35 | [apps/desktop/src/main/localDb/ipc/sessions.ts:725](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/sessions.ts#L725) |
| localDb | cindy-make | 35 → 11 → 35 | [apps/desktop/src/main/localDb/index.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/index.ts#L31) |
| localDb | cindy-media | 35 → 12 → 35 | [apps/desktop/src/main/localDb/ipc/botAvatarSelection.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botAvatarSelection.ts#L3) |
| localDb | companion-cloud | 35 → 15 → 35 | [apps/desktop/src/main/localDb/ipc/botRemoteResourceProjection.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteResourceProjection.ts#L12) |
| localDb | device-link | 35 → 17 → 35 | [apps/desktop/src/main/localDb/agentHandoffPendingQueries.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/agentHandoffPendingQueries.ts#L2) |
| localDb | embedders | 35 → 20 → 35 | [apps/desktop/src/main/localDb/chatHistorySearch.ts:55](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/chatHistorySearch.ts#L55) |
| localDb | embedding-host | 35 → 21 → 35 | [apps/desktop/src/main/localDb/chatHistorySearch.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/chatHistorySearch.ts#L50) |
| localDb | git-context | 35 → 23 → 35 | [apps/desktop/src/main/localDb/ipc/messages.ts:62](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L62) |
| localDb | git-snapshot | 35 → 25 → 35 | [apps/desktop/src/main/localDb/ipc/bots.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/bots.ts#L50) |
| localDb | hook-control | 35 → 28 → 35 | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:226](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L226) |
| localDb | im | 35 → 29 → 35 | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:160](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L160) |
| localDb | maker-host | 35 → 38 → 35 | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L1) |
| localDb | maker-ipc | 35 → 39 → 35 | [apps/desktop/src/main/localDb/botProfileDeletionStore.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/botProfileDeletionStore.ts#L1) |
| localDb | mcp-apps | 35 → 41 → 35 | [apps/desktop/src/main/localDb/ipc/messages.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L35) |
| localDb | session-import | 35 → 62 → 35 | [apps/desktop/src/main/localDb/ipc/messages.ts:59](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/messages.ts#L59) |
| localDb | session-share | 35 → 63 → 35 | [apps/desktop/src/main/localDb/ipc/session-share.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/session-share.ts#L24) |
| localDb | task-management | 35 → 67 → 35 | [apps/desktop/src/main/localDb/client/WorkerThreadTransport.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/client/WorkerThreadTransport.ts#L12) |
| localDb | turn-change-set | 35 → 70 → 35 | [apps/desktop/src/main/localDb/dbSlimmingMaintenance.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/dbSlimmingMaintenance.ts#L12) |
| localDb | usage | 35 → 71 → 35 | [apps/desktop/src/main/localDb/dailyModelUsage.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/dailyModelUsage.ts#L14) |
| localDb | voice-conversation | 35 → 74 → 35 | [apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts:164](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/botRemoteManagement.ts#L164) |
| localDb | worktree | 35 → 76 → 35 | [apps/desktop/src/main/localDb/ipc/createUserSession.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/ipc/createUserSession.ts#L18) |
| log-upload | maker-host | 36 → 38 → 36 | [apps/desktop/src/main/log-upload/index.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/log-upload/index.ts#L38) |
| log-upload | performance-trace | 36 → 45 → 36 | [apps/desktop/src/main/log-upload/index.ts:65](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/log-upload/index.ts#L65) |
| machines | provider-group | 37 → 51 → 39 → 37 | [apps/desktop/src/main/machines/directory.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/machines/directory.ts#L5) |
| maker-host | agent-app-update | 38 → 1 → 17 → 38 | [apps/desktop/src/main/maker-host/index.ts:116](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L116) |
| maker-host | agent-binaries | 38 → 2 → 11 → 38 | [apps/desktop/src/main/maker-host/auth-adapters.ts:42](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auth-adapters.ts#L42) |
| maker-host | bot-import | 38 → 6 → 38 | [apps/desktop/src/main/maker-host/index.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L17) |
| maker-host | cindy-brain | 38 → 8 → 38 | [apps/desktop/src/main/maker-host/auth-adapters.ts:137](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auth-adapters.ts#L137) |
| maker-host | cindy-evaluate | 38 → 9 → 38 | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L1) |
| maker-host | cindy-make | 38 → 11 → 38 | [apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts#L20) |
| maker-host | cindy-media | 38 → 12 → 38 | [apps/desktop/src/main/maker-host/attachmentPreservation.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/attachmentPreservation.ts#L1) |
| maker-host | device-link | 38 → 17 → 38 | [apps/desktop/src/main/maker-host/index.ts:98](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L98) |
| maker-host | git-snapshot | 38 → 25 → 35 → 38 | [apps/desktop/src/main/maker-host/git-snapshot-host.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/git-snapshot-host.ts#L12) |
| maker-host | im | 38 → 29 → 38 | [apps/desktop/src/main/maker-host/index.ts:293](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L293) |
| maker-host | input-handoff | 38 → 30 → 38 | [apps/desktop/src/main/maker-host/runtimeConfigsCore.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/runtimeConfigsCore.ts#L37) |
| maker-host | local-agent | 38 → 32 → 38 | [apps/desktop/src/main/maker-host/index.ts:275](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L275) |
| maker-host | local-model-runtime | 38 → 33 → 38 | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:117](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L117) |
| maker-host | localDb | 38 → 35 → 38 | [apps/desktop/src/main/maker-host/cc-remote-mcp.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/cc-remote-mcp.ts#L31) |
| maker-host | log-upload | 38 → 36 → 38 | [apps/desktop/src/main/maker-host/pi-package-diagnostic.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/pi-package-diagnostic.ts#L2) |
| maker-host | maker-ipc | 38 → 39 → 38 | [apps/desktop/src/main/maker-host/index.ts:108](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L108) |
| maker-host | maker-orchestration | 38 → 40 → 38 | [apps/desktop/src/main/maker-host/claude-transcript-relocation.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/claude-transcript-relocation.ts#L33) |
| maker-host | mcp-integrations | 38 → 42 → 38 | [apps/desktop/src/main/maker-host/botMcpCatalog.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/botMcpCatalog.ts#L3) |
| maker-host | model-access | 38 → 44 → 38 | [apps/desktop/src/main/maker-host/codex-proxy-host.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/codex-proxy-host.desktop.ts#L2) |
| maker-host | plugin-oauth | 38 → 48 → 8 → 38 | [apps/desktop/src/main/maker-host/custom-mcp-store.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/custom-mcp-store.desktop.ts#L2) |
| maker-host | provider-group | 38 → 51 → 38 | [apps/desktop/src/main/maker-host/index.ts:159](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L159) |
| maker-host | remote-agent | 38 → 54 → 38 | [apps/desktop/src/main/maker-host/index.ts:272](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L272) |
| maker-host | remote-ssh | 38 → 57 → 38 | [apps/desktop/src/main/maker-host/index.ts:210](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L210) |
| maker-host | reviewer | 38 → 58 → 12 → 38 | [apps/desktop/src/main/maker-host/index.ts:273](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L273) |
| maker-host | scheduler-host | 38 → 60 → 38 | [apps/desktop/src/main/maker-host/piPackageStoreCore.ts:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/piPackageStoreCore.ts#L52) |
| maker-host | secrets | 38 → 61 → 44 → 38 | [apps/desktop/src/main/maker-host/auth-adapters.ts:110](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auth-adapters.ts#L110) |
| maker-host | skillhub | 38 → 65 → 38 | [apps/desktop/src/main/maker-host/built-in-skills.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/built-in-skills.ts#L16) |
| maker-host | subscription-accounts | 38 → 66 → 38 | [apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts#L9) |
| maker-host | turn-change-set | 38 → 70 → 17 → 38 | [apps/desktop/src/main/maker-host/index.ts:321](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/index.ts#L321) |
| maker-host | usage | 38 → 71 → 38 | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L6) |
| maker-host | utility-model | 38 → 72 → 38 | [apps/desktop/src/main/maker-host/auto-review-model-router.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/auto-review-model-router.ts#L7) |
| maker-host | vision-bridge | 38 → 73 → 38 | [apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/anthropicCompatProxyHostCore.ts#L39) |
| maker-host | voice-conversation | 38 → 74 → 38 | [apps/desktop/src/main/maker-host/createDesktopProviderService.ts:72](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/createDesktopProviderService.ts#L72) |
| maker-host | worktree | 38 → 76 → 38 | [apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-host/gitSnapshotHostCore.ts#L31) |
| maker-ipc | agent-app-update | 39 → 1 → 39 | [apps/desktop/src/main/maker-ipc/pluginCompanionHost.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/pluginCompanionHost.ts#L12) |
| maker-ipc | agent-binaries | 39 → 2 → 11 → 39 | [apps/desktop/src/main/maker-ipc/binary-version.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/binary-version.ts#L24) |
| maker-ipc | agent-island | 39 → 3 → 12 → 39 | [apps/desktop/src/main/maker-ipc/botGroupChatService.ts:230](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botGroupChatService.ts#L230) |
| maker-ipc | app-settings | 39 → 4 → 39 | [apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts#L1) |
| maker-ipc | bot-import | 39 → 6 → 39 | [apps/desktop/src/main/maker-ipc/botV2Migration.ts:94](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botV2Migration.ts#L94) |
| maker-ipc | cindy-brain | 39 → 8 → 39 | [apps/desktop/src/main/maker-ipc/botAuthorizationHost.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botAuthorizationHost.ts#L25) |
| maker-ipc | cindy-make | 39 → 11 → 39 | [apps/desktop/src/main/maker-ipc/cindyMakeSessionStart.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/cindyMakeSessionStart.ts#L2) |
| maker-ipc | cindy-media | 39 → 12 → 39 | [apps/desktop/src/main/maker-ipc/botCreationDraft.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botCreationDraft.ts#L5) |
| maker-ipc | commands | 39 → 14 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:337](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L337) |
| maker-ipc | companion-cloud | 39 → 15 → 39 | [apps/desktop/src/main/maker-ipc/botDirectMessageService.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botDirectMessageService.ts#L1) |
| maker-ipc | computer-permission-guide | 39 → 16 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:437](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L437) |
| maker-ipc | device-link | 39 → 17 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L4) |
| maker-ipc | file-browser | 39 → 22 → 8 → 39 | [apps/desktop/src/main/maker-ipc/normalizeAttachments.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/normalizeAttachments.ts#L26) |
| maker-ipc | git-context | 39 → 23 → 8 → 39 | [apps/desktop/src/main/maker-ipc/groupProjectCheckout.desktop.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/groupProjectCheckout.desktop.ts#L8) |
| maker-ipc | git-review | 39 → 24 → 35 → 39 | [apps/desktop/src/main/maker-ipc/groupProjectCheckout.desktop.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/groupProjectCheckout.desktop.ts#L7) |
| maker-ipc | git-snapshot | 39 → 25 → 35 → 39 | [apps/desktop/src/main/maker-ipc/botProjectMode.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botProjectMode.ts#L23) |
| maker-ipc | github-issue | 39 → 26 → 39 | [apps/desktop/src/main/maker-ipc/my-issues.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/my-issues.ts#L18) |
| maker-ipc | goal-host | 39 → 27 → 39 | [apps/desktop/src/main/maker-ipc/goal.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/goal.ts#L25) |
| maker-ipc | hook-control | 39 → 28 → 39 | [apps/desktop/src/main/maker-ipc/ghostErrandRunner.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/ghostErrandRunner.ts#L32) |
| maker-ipc | im | 39 → 29 → 39 | [apps/desktop/src/main/maker-ipc/botImAuthorization.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botImAuthorization.ts#L14) |
| maker-ipc | input-handoff | 39 → 30 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L12) |
| maker-ipc | learn-host | 39 → 31 → 39 | [apps/desktop/src/main/maker-ipc/makerSendTransaction.ts:75](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/makerSendTransaction.ts#L75) |
| maker-ipc | local-agent | 39 → 32 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:1235](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L1235) |
| maker-ipc | local-model-runtime | 39 → 33 → 39 | [apps/desktop/src/main/maker-ipc/providerHandlers.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/providerHandlers.ts#L53) |
| maker-ipc | localDb | 39 → 35 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.desktop.ts#L2) |
| maker-ipc | machines | 39 → 37 → 51 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:110](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L110) |
| maker-ipc | maker-host | 39 → 38 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:66](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L66) |
| maker-ipc | maker-orchestration | 39 → 40 → 39 | [apps/desktop/src/main/maker-ipc/fork.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/fork.ts#L19) |
| maker-ipc | mcp-apps | 39 → 41 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L11) |
| maker-ipc | mcp-integrations | 39 → 42 → 39 | [apps/desktop/src/main/maker-ipc/androidHandlers.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/androidHandlers.ts#L19) |
| maker-ipc | menubar | 39 → 43 → 38 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:730](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L730) |
| maker-ipc | model-access | 39 → 44 → 8 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:1393](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L1393) |
| maker-ipc | performance-trace | 39 → 45 → 36 → 38 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L23) |
| maker-ipc | plugin-oauth | 39 → 48 → 39 | [apps/desktop/src/main/maker-ipc/botAuthorizationService.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botAuthorizationService.ts#L3) |
| maker-ipc | provider-group | 39 → 51 → 39 | [apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/agent-input-coordinator.ts#L10) |
| maker-ipc | provider-import | 39 → 52 → 35 → 39 | [apps/desktop/src/main/maker-ipc/providerHandlers.ts:117](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/providerHandlers.ts#L117) |
| maker-ipc | remote-agent | 39 → 54 → 39 | [apps/desktop/src/main/maker-ipc/appDefaultModelControl.ts:125](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/appDefaultModelControl.ts#L125) |
| maker-ipc | remote-ssh | 39 → 57 → 17 → 39 | [apps/desktop/src/main/maker-ipc/modelRouteAdmission.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/modelRouteAdmission.ts#L13) |
| maker-ipc | reviewer | 39 → 58 → 39 | [apps/desktop/src/main/maker-ipc/normalizeAttachments.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/normalizeAttachments.ts#L36) |
| maker-ipc | scheduler-host | 39 → 60 → 39 | [apps/desktop/src/main/maker-ipc/botProjectMode.ts:43](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botProjectMode.ts#L43) |
| maker-ipc | secrets | 39 → 61 → 44 → 8 → 39 | [apps/desktop/src/main/maker-ipc/providerHandlers.ts:79](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/providerHandlers.ts#L79) |
| maker-ipc | session-title-rename | 39 → 64 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:398](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L398) |
| maker-ipc | skillhub | 39 → 65 → 17 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:686](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L686) |
| maker-ipc | subscription-accounts | 39 → 66 → 17 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L2) |
| maker-ipc | task-management | 39 → 67 → 17 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:843](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L843) |
| maker-ipc | terminal | 39 → 69 → 8 → 39 | [apps/desktop/src/main/maker-ipc/terminal-handlers.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/terminal-handlers.ts#L22) |
| maker-ipc | turn-change-set | 39 → 70 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:1023](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L1023) |
| maker-ipc | usage | 39 → 71 → 39 | [apps/desktop/src/main/maker-ipc/piUsageReceipts.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/piUsageReceipts.ts#L4) |
| maker-ipc | utility-model | 39 → 72 → 33 → 39 | [apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/auxiliary-model-settings.ts#L31) |
| maker-ipc | voice-conversation | 39 → 74 → 8 → 39 | [apps/desktop/src/main/maker-ipc/register.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/register.ts#L35) |
| maker-ipc | worktree | 39 → 76 → 17 → 39 | [apps/desktop/src/main/maker-ipc/botProjectMode.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-ipc/botProjectMode.ts#L29) |
| maker-orchestration | cindy-make | 40 → 11 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L17) |
| maker-orchestration | device-link | 40 → 17 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L18) |
| maker-orchestration | git-context | 40 → 23 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/rewind.ts:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/rewind.ts#L52) |
| maker-orchestration | git-snapshot | 40 → 25 → 35 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/rewind.ts:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/rewind.ts#L46) |
| maker-orchestration | localDb | 40 → 35 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L25) |
| maker-orchestration | maker-host | 40 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L30) |
| maker-orchestration | maker-ipc | 40 → 39 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:37](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L37) |
| maker-orchestration | remote-agent | 40 → 54 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L19) |
| maker-orchestration | subscription-accounts | 40 → 66 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/fork.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/fork.ts#L35) |
| maker-orchestration | worktree | 40 → 76 → 38 → 40 | [apps/desktop/src/main/maker-orchestration/rewind.ts:79](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/maker-orchestration/rewind.ts#L79) |
| mcp-apps | app-settings | 41 → 4 → 39 → 41 | [apps/desktop/src/main/mcp-apps/hostUi.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L14) |
| mcp-apps | cindy-brain | 41 → 8 → 41 | [apps/desktop/src/main/mcp-apps/appearance.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/appearance.ts#L5) |
| mcp-apps | cindy-media | 41 → 12 → 8 → 41 | [apps/desktop/src/main/mcp-apps/ipc.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/ipc.ts#L16) |
| mcp-apps | device-link | 41 → 17 → 41 | [apps/desktop/src/main/mcp-apps/hostUi.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L8) |
| mcp-apps | file-browser | 41 → 22 → 8 → 41 | [apps/desktop/src/main/mcp-apps/ipc.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/ipc.ts#L15) |
| mcp-apps | git-context | 41 → 23 → 8 → 41 | [apps/desktop/src/main/mcp-apps/service.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/service.ts#L9) |
| mcp-apps | localDb | 41 → 35 → 41 | [apps/desktop/src/main/mcp-apps/ipc.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/ipc.ts#L29) |
| mcp-apps | maker-host | 41 → 38 → 8 → 41 | [apps/desktop/src/main/mcp-apps/service.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/service.ts#L11) |
| mcp-apps | maker-ipc | 41 → 39 → 41 | [apps/desktop/src/main/mcp-apps/messageSender.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/messageSender.ts#L4) |
| mcp-apps | mcp-integrations | 41 → 42 → 41 | [apps/desktop/src/main/mcp-apps/hostUi.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L5) |
| mcp-apps | right-sidebar-window | 41 → 59 → 17 → 41 | [apps/desktop/src/main/mcp-apps/hostUi.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/hostUi.ts#L10) |
| mcp-apps | secrets | 41 → 61 → 44 → 8 → 41 | [apps/desktop/src/main/mcp-apps/ipc.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-apps/ipc.ts#L36) |
| mcp-integrations | agent-app-update | 42 → 1 → 39 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:103](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L103) |
| mcp-integrations | agent-binaries | 42 → 2 → 11 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L19) |
| mcp-integrations | app-settings | 42 → 4 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L21) |
| mcp-integrations | browser-extension | 42 → 7 → 17 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/browser-backend/user-browser-backend.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/browser-backend/user-browser-backend.ts#L30) |
| mcp-integrations | cindy-brain | 42 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/browser-backend/proxy-auth.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/browser-backend/proxy-auth.ts#L7) |
| mcp-integrations | cindy-evaluate | 42 → 9 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/ghost.desktop.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/ghost.desktop.ts#L1) |
| mcp-integrations | cindy-media | 42 → 12 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts#L10) |
| mcp-integrations | cindy-proxy-media | 42 → 13 → 12 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts#L2) |
| mcp-integrations | companion-cloud | 42 → 15 → 29 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L41) |
| mcp-integrations | device-link | 42 → 17 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L6) |
| mcp-integrations | doc-tools | 42 → 19 → 58 → 39 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:89](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L89) |
| mcp-integrations | git-context | 42 → 23 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/ghost.desktop.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/ghost.desktop.ts#L22) |
| mcp-integrations | github-issue | 42 → 26 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:123](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L123) |
| mcp-integrations | hook-control | 42 → 28 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:101](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L101) |
| mcp-integrations | im | 42 → 29 → 42 | [apps/desktop/src/main/mcp-integrations/feishuTransportRouting.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/feishuTransportRouting.ts#L7) |
| mcp-integrations | input-handoff | 42 → 30 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/browser.ts:56](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/browser.ts#L56) |
| mcp-integrations | learn-host | 42 → 31 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:171](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L171) |
| mcp-integrations | local-themes | 42 → 34 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L22) |
| mcp-integrations | localDb | 42 → 35 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/createProjectCore.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/createProjectCore.ts#L13) |
| mcp-integrations | machines | 42 → 37 → 51 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L34) |
| mcp-integrations | maker-host | 42 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/android.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/android.ts#L28) |
| mcp-integrations | maker-ipc | 42 → 39 → 42 | [apps/desktop/src/main/mcp-integrations/codexHttpBridge.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/codexHttpBridge.ts#L33) |
| mcp-integrations | mcp-apps | 42 → 41 → 42 | [apps/desktop/src/main/mcp-integrations/codexEnvironment.desktop.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/codexEnvironment.desktop.ts#L4) |
| mcp-integrations | model-access | 42 → 44 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts#L15) |
| mcp-integrations | plugin-contributions | 42 → 46 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/ghost.desktop.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/ghost.desktop.ts#L5) |
| mcp-integrations | plugin-market | 42 → 47 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/ghost.desktop.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/ghost.desktop.ts#L7) |
| mcp-integrations | plugin-publisher | 42 → 49 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/ghost.desktop.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/ghost.desktop.ts#L15) |
| mcp-integrations | provider-group | 42 → 51 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/followUpRoute.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/followUpRoute.ts#L9) |
| mcp-integrations | remote-desktop | 42 → 55 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/computer.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/computer.ts#L2) |
| mcp-integrations | remote-ssh | 42 → 57 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:270](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L270) |
| mcp-integrations | scheduler-host | 42 → 60 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:104](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L104) |
| mcp-integrations | secrets | 42 → 61 → 44 → 8 → 42 | [apps/desktop/src/main/mcp-integrations/browser.desktop.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/browser.desktop.ts#L8) |
| mcp-integrations | session-import | 42 → 62 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:49](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L49) |
| mcp-integrations | session-share | 42 → 63 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L50) |
| mcp-integrations | skillhub | 42 → 65 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:169](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L169) |
| mcp-integrations | subscription-accounts | 42 → 66 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L3) |
| mcp-integrations | terminal | 42 → 69 → 42 | [apps/desktop/src/main/mcp-integrations/mcp-providers.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/mcp-providers.ts#L11) |
| mcp-integrations | usage | 42 → 71 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts:58](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/cindyProxyMedia.ts#L58) |
| mcp-integrations | worktree | 42 → 76 → 38 → 42 | [apps/desktop/src/main/mcp-integrations/createTaskWorktree.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/mcp-integrations/createTaskWorktree.ts#L6) |
| menubar | maker-host | 43 → 38 → 17 → 43 | [apps/desktop/src/main/menubar/collect.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/menubar/collect.ts#L3) |
| menubar | quota-overview | 43 → 53 → 43 | [apps/desktop/src/main/menubar/service.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/menubar/service.ts#L18) |
| menubar | remote-agent | 43 → 54 → 17 → 43 | [apps/desktop/src/main/menubar/remoteSubscriptions.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/menubar/remoteSubscriptions.ts#L27) |
| menubar | usage | 43 → 71 → 17 → 43 | [apps/desktop/src/main/menubar/collect.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/menubar/collect.ts#L30) |
| model-access | cindy-brain | 44 → 8 → 44 | [apps/desktop/src/main/model-access/index.ts:61](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/index.ts#L61) |
| model-access | cindy-media | 44 → 12 → 44 | [apps/desktop/src/main/model-access/mediaModels.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/mediaModels.ts#L20) |
| model-access | maker-host | 44 → 38 → 44 | [apps/desktop/src/main/model-access/byokRuntime.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/byokRuntime.ts#L9) |
| model-access | secrets | 44 → 61 → 44 | [apps/desktop/src/main/model-access/gatewayConnection.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/gatewayConnection.ts#L3) |
| model-access | usage | 44 → 71 → 44 | [apps/desktop/src/main/model-access/index.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/model-access/index.ts#L7) |
| performance-trace | log-upload | 45 → 36 → 45 | [apps/desktop/src/main/performance-trace/index.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/performance-trace/index.ts#L22) |
| plugin-contributions | cindy-brain | 46 → 8 → 42 → 46 | [apps/desktop/src/main/plugin-contributions/host.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-contributions/host.ts#L31) |
| plugin-contributions | plugin-market | 46 → 47 → 8 → 42 → 46 | [apps/desktop/src/main/plugin-contributions/host.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-contributions/host.ts#L35) |
| plugin-contributions | plugin-publisher | 46 → 49 → 8 → 42 → 46 | [apps/desktop/src/main/plugin-contributions/host.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-contributions/host.ts#L34) |
| plugin-market | cindy-brain | 47 → 8 → 47 | [apps/desktop/src/main/plugin-market/agentTools.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-market/agentTools.ts#L1) |
| plugin-market | plugin-publisher | 47 → 49 → 47 | [apps/desktop/src/main/plugin-market/localSharing.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-market/localSharing.ts#L20) |
| plugin-oauth | cindy-brain | 48 → 8 → 48 | [apps/desktop/src/main/plugin-oauth/cards.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/cards.ts#L16) |
| plugin-oauth | device-link | 48 → 17 → 48 | [apps/desktop/src/main/plugin-oauth/identityStore.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/identityStore.ts#L12) |
| plugin-oauth | input-handoff | 48 → 30 → 8 → 48 | [apps/desktop/src/main/plugin-oauth/cards.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/cards.ts#L9) |
| plugin-oauth | maker-ipc | 48 → 39 → 48 | [apps/desktop/src/main/plugin-oauth/cards.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-oauth/cards.ts#L17) |
| plugin-publisher | cindy-brain | 49 → 8 → 49 | [apps/desktop/src/main/plugin-publisher/host.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-publisher/host.ts#L15) |
| plugin-publisher | maker-host | 49 → 38 → 8 → 49 | [apps/desktop/src/main/plugin-publisher/putObject.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-publisher/putObject.ts#L18) |
| plugin-publisher | plugin-market | 49 → 47 → 49 | [apps/desktop/src/main/plugin-publisher/host.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-publisher/host.ts#L19) |
| plugin-usage | cindy-brain | 50 → 8 → 50 | [apps/desktop/src/main/plugin-usage/ipc.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-usage/ipc.ts#L7) |
| plugin-usage | localDb | 50 → 35 → 8 → 50 | [apps/desktop/src/main/plugin-usage/current.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-usage/current.ts#L2) |
| plugin-usage | plugin-market | 50 → 47 → 8 → 50 | [apps/desktop/src/main/plugin-usage/identity.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/plugin-usage/identity.ts#L7) |
| provider-group | device-link | 51 → 17 → 51 | [apps/desktop/src/main/provider-group/continuityRuntime.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/continuityRuntime.ts#L7) |
| provider-group | goal-host | 51 → 27 → 17 → 51 | [apps/desktop/src/main/provider-group/failurePolicy.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/failurePolicy.ts#L24) |
| provider-group | local-agent | 51 → 32 → 51 | [apps/desktop/src/main/provider-group/runtime.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/runtime.ts#L10) |
| provider-group | maker-host | 51 → 38 → 51 | [apps/desktop/src/main/provider-group/bindings.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/bindings.ts#L19) |
| provider-group | maker-ipc | 51 → 39 → 51 | [apps/desktop/src/main/provider-group/failurePolicy.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/failurePolicy.ts#L25) |
| provider-group | remote-agent | 51 → 54 → 51 | [apps/desktop/src/main/provider-group/continuityRuntime.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/continuityRuntime.ts#L1) |
| provider-group | subscription-accounts | 51 → 66 → 51 | [apps/desktop/src/main/provider-group/runtime.ts:40](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/runtime.ts#L40) |
| provider-group | usage | 51 → 71 → 17 → 51 | [apps/desktop/src/main/provider-group/remoteRegistration.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-group/remoteRegistration.ts#L8) |
| provider-import | localDb | 52 → 35 → 39 → 52 | [apps/desktop/src/main/provider-import/local/sources.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/provider-import/local/sources.ts#L12) |
| quota-overview | agent-island | 53 → 3 → 53 | [apps/desktop/src/main/quota-overview/panelController.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L20) |
| quota-overview | device-link | 53 → 17 → 53 | [apps/desktop/src/main/quota-overview/desktopWidgets.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/desktopWidgets.ts#L22) |
| quota-overview | localDb | 53 → 35 → 3 → 53 | [apps/desktop/src/main/quota-overview/service.ts:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/service.ts#L48) |
| quota-overview | maker-host | 53 → 38 → 17 → 53 | [apps/desktop/src/main/quota-overview/service.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/service.ts#L50) |
| quota-overview | maker-ipc | 53 → 39 → 3 → 53 | [apps/desktop/src/main/quota-overview/panelController.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L33) |
| quota-overview | menubar | 53 → 43 → 53 | [apps/desktop/src/main/quota-overview/panelController.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L36) |
| quota-overview | subscription-accounts | 53 → 66 → 17 → 53 | [apps/desktop/src/main/quota-overview/service.ts:65](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/service.ts#L65) |
| quota-overview | usage | 53 → 71 → 17 → 53 | [apps/desktop/src/main/quota-overview/panelController.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/quota-overview/panelController.ts#L41) |
| remote-agent | cindy-media | 54 → 12 → 17 → 54 | [apps/desktop/src/main/remote-agent/host/runHost.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/runHost.ts#L3) |
| remote-agent | device-link | 54 → 17 → 54 | [apps/desktop/src/main/remote-agent/controller/deviceCatalog.ts:124](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/controller/deviceCatalog.ts#L124) |
| remote-agent | goal-host | 54 → 27 → 17 → 54 | [apps/desktop/src/main/remote-agent/host/service.ts:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/service.ts#L52) |
| remote-agent | im | 54 → 29 → 54 | [apps/desktop/src/main/remote-agent/wire.ts:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/wire.ts#L35) |
| remote-agent | localDb | 54 → 35 → 17 → 54 | [apps/desktop/src/main/remote-agent/controller/startRemote.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/controller/startRemote.ts#L3) |
| remote-agent | maker-host | 54 → 38 → 54 | [apps/desktop/src/main/remote-agent/attachmentPreservation.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/attachmentPreservation.ts#L6) |
| remote-agent | maker-ipc | 54 → 39 → 54 | [apps/desktop/src/main/remote-agent/host/runHost.ts:85](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/runHost.ts#L85) |
| remote-agent | maker-orchestration | 54 → 40 → 54 | [apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts#L5) |
| remote-agent | provider-group | 54 → 51 → 54 | [apps/desktop/src/main/remote-agent/controller/service.ts:58](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/controller/service.ts#L58) |
| remote-agent | session-share | 54 → 63 → 17 → 54 | [apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/nativeHistoryStorage.ts#L9) |
| remote-agent | subscription-accounts | 54 → 66 → 17 → 54 | [apps/desktop/src/main/remote-agent/host/service.ts:44](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/service.ts#L44) |
| remote-agent | usage | 54 → 71 → 54 | [apps/desktop/src/main/remote-agent/host/guestUsage.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-agent/host/guestUsage.ts#L9) |
| remote-desktop | cindy-brain | 55 → 8 → 17 → 55 | [apps/desktop/src/main/remote-desktop/liveScreen.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/liveScreen.ts#L23) |
| remote-desktop | computer-permission-guide | 55 → 16 → 42 → 55 | [apps/desktop/src/main/remote-desktop/index.ts:124](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/index.ts#L124) |
| remote-desktop | device-link | 55 → 17 → 55 | [apps/desktop/src/main/remote-desktop/awayGuardService.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/awayGuardService.ts#L19) |
| remote-desktop | input-handoff | 55 → 30 → 55 | [apps/desktop/src/main/remote-desktop/index.ts:47](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/index.ts#L47) |
| remote-desktop | voice-input | 55 → 75 → 17 → 55 | [apps/desktop/src/main/remote-desktop/index.ts:102](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop/index.ts#L102) |
| remote-desktop-viewer | device-link | 56 → 17 → 8 → 56 | [apps/desktop/src/main/remote-desktop-viewer/windows.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop-viewer/windows.ts#L34) |
| remote-desktop-viewer | maker-host | 56 → 38 → 8 → 56 | [apps/desktop/src/main/remote-desktop-viewer/preferences.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop-viewer/preferences.ts#L4) |
| remote-desktop-viewer | remote-desktop | 56 → 55 → 8 → 56 | [apps/desktop/src/main/remote-desktop-viewer/credentials.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-desktop-viewer/credentials.ts#L3) |
| remote-ssh | device-link | 57 → 17 → 57 | [apps/desktop/src/main/remote-ssh/index.ts:138](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/index.ts#L138) |
| remote-ssh | localDb | 57 → 35 → 17 → 57 | [apps/desktop/src/main/remote-ssh/index.ts:71](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/index.ts#L71) |
| remote-ssh | maker-host | 57 → 38 → 57 | [apps/desktop/src/main/remote-ssh/claude-env.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/claude-env.ts#L30) |
| remote-ssh | mcp-apps | 57 → 41 → 17 → 57 | [apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts#L45) |
| remote-ssh | mcp-integrations | 57 → 42 → 57 | [apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts:43](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/remote-ssh/codex-remote-mcp.ts#L43) |
| reviewer | cindy-media | 58 → 12 → 17 → 58 | [apps/desktop/src/main/reviewer/reviewEvidence.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewEvidence.ts#L12) |
| reviewer | git-context | 58 → 23 → 17 → 58 | [apps/desktop/src/main/reviewer/reviewAdditionalRepositories.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewAdditionalRepositories.ts#L9) |
| reviewer | git-review | 58 → 24 → 22 → 17 → 58 | [apps/desktop/src/main/reviewer/reviewAdditionalRepositories.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewAdditionalRepositories.ts#L6) |
| reviewer | localDb | 58 → 35 → 17 → 58 | [apps/desktop/src/main/reviewer/reviewEvidence.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewEvidence.ts#L8) |
| reviewer | maker-ipc | 58 → 39 → 58 | [apps/desktop/src/main/reviewer/reviewSessionPolicy.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewSessionPolicy.ts#L1) |
| reviewer | turn-change-set | 58 → 70 → 17 → 58 | [apps/desktop/src/main/reviewer/reviewEvidence.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/reviewer/reviewEvidence.ts#L15) |
| right-sidebar-window | device-link | 59 → 17 → 41 → 59 | [apps/desktop/src/main/right-sidebar-window/resolveHostContext.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/right-sidebar-window/resolveHostContext.ts#L14) |
| right-sidebar-window | localDb | 59 → 35 → 41 → 59 | [apps/desktop/src/main/right-sidebar-window/resolveHostContext.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/right-sidebar-window/resolveHostContext.ts#L15) |
| right-sidebar-window | maker-host | 59 → 38 → 8 → 41 → 59 | [apps/desktop/src/main/right-sidebar-window/settings-store.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/right-sidebar-window/settings-store.ts#L13) |
| right-sidebar-window | maker-ipc | 59 → 39 → 41 → 59 | [apps/desktop/src/main/right-sidebar-window/ipc.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/right-sidebar-window/ipc.ts#L13) |
| scheduler-host | agent-island | 60 → 3 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L19) |
| scheduler-host | cindy-brain | 60 → 8 → 23 → 60 | [apps/desktop/src/main/scheduler-host/index.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.ts#L20) |
| scheduler-host | companion-cloud | 60 → 15 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:58](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L58) |
| scheduler-host | device-link | 60 → 17 → 38 → 60 | [apps/desktop/src/main/scheduler-host/notifier.desktop.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/notifier.desktop.ts#L4) |
| scheduler-host | git-context | 60 → 23 → 60 | [apps/desktop/src/main/scheduler-host/script-capability-broker.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/script-capability-broker.ts#L1) |
| scheduler-host | im | 60 → 29 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L50) |
| scheduler-host | localDb | 60 → 35 → 3 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L8) |
| scheduler-host | maker-host | 60 → 38 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L18) |
| scheduler-host | maker-ipc | 60 → 39 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L41) |
| scheduler-host | mcp-integrations | 60 → 42 → 60 | [apps/desktop/src/main/scheduler-host/runner.ts:114](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/runner.ts#L114) |
| scheduler-host | plugin-oauth | 60 → 48 → 39 → 60 | [apps/desktop/src/main/scheduler-host/webhook/index.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/webhook/index.ts#L23) |
| scheduler-host | provider-group | 60 → 51 → 38 → 60 | [apps/desktop/src/main/scheduler-host/script-capability-broker.desktop.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/script-capability-broker.desktop.ts#L6) |
| scheduler-host | remote-agent | 60 → 54 → 29 → 60 | [apps/desktop/src/main/scheduler-host/index.desktop.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/index.desktop.ts#L12) |
| scheduler-host | reviewer | 60 → 58 → 23 → 60 | [apps/desktop/src/main/scheduler-host/script-capability-broker.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/script-capability-broker.ts#L14) |
| scheduler-host | subscription-accounts | 60 → 66 → 38 → 60 | [apps/desktop/src/main/scheduler-host/script-capability-broker.desktop.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/script-capability-broker.desktop.ts#L5) |
| scheduler-host | task-management | 60 → 67 → 38 → 60 | [apps/desktop/src/main/scheduler-host/quietRunArchive.desktop.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/quietRunArchive.desktop.ts#L9) |
| scheduler-host | utility-model | 60 → 72 → 33 → 60 | [apps/desktop/src/main/scheduler-host/hook-script-generator.ts:470](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/hook-script-generator.ts#L470) |
| scheduler-host | worktree | 60 → 76 → 60 | [apps/desktop/src/main/scheduler-host/restore-target.desktop.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/scheduler-host/restore-target.desktop.ts#L2) |
| secrets | model-access | 61 → 44 → 61 | [apps/desktop/src/main/secrets/providerSecretStore.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/secrets/providerSecretStore.ts#L7) |
| session-import | cindy-media | 62 → 12 → 35 → 62 | [apps/desktop/src/main/session-import/writer.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/writer.ts#L13) |
| session-import | device-link | 62 → 17 → 35 → 62 | [apps/desktop/src/main/session-import/remoteResource.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/remoteResource.ts#L17) |
| session-import | git-context | 62 → 23 → 35 → 62 | [apps/desktop/src/main/session-import/executor.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/executor.ts#L19) |
| session-import | localDb | 62 → 35 → 62 | [apps/desktop/src/main/session-import/executor.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/executor.ts#L20) |
| session-import | maker-host | 62 → 38 → 35 → 62 | [apps/desktop/src/main/session-import/executor.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/executor.ts#L23) |
| session-import | maker-ipc | 62 → 39 → 35 → 62 | [apps/desktop/src/main/session-import/handoff.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/handoff.ts#L11) |
| session-import | remote-agent | 62 → 54 → 35 → 62 | [apps/desktop/src/main/session-import/sources/claude.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/sources/claude.ts#L18) |
| session-import | session-share | 62 → 63 → 35 → 62 | [apps/desktop/src/main/session-import/sources/claude.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-import/sources/claude.ts#L21) |
| session-share | cindy-brain | 63 → 8 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareHost.desktop.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareHost.desktop.ts#L5) |
| session-share | cindy-media | 63 → 12 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareExport.ts:50](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L50) |
| session-share | device-link | 63 → 17 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareImport.ts:1108](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareImport.ts#L1108) |
| session-share | git-context | 63 → 23 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareImport.ts:70](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareImport.ts#L70) |
| session-share | localDb | 63 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareExport.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L36) |
| session-share | maker-host | 63 → 38 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareExport.ts:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L39) |
| session-share | maker-ipc | 63 → 39 → 15 → 63 | [apps/desktop/src/main/session-share/sessionShareTools.desktop.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareTools.desktop.ts#L5) |
| session-share | maker-orchestration | 63 → 40 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareExport.ts:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L45) |
| session-share | mcp-integrations | 63 → 42 → 63 | [apps/desktop/src/main/session-share/sessionShareTools.desktop.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareTools.desktop.ts#L4) |
| session-share | subscription-accounts | 63 → 66 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareExport.ts:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareExport.ts#L46) |
| session-share | worktree | 63 → 76 → 35 → 63 | [apps/desktop/src/main/session-share/sessionShareImport.ts:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-share/sessionShareImport.ts#L48) |
| session-title-rename | cindy-brain | 64 → 8 → 39 → 64 | [apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts#L10) |
| session-title-rename | maker-ipc | 64 → 39 → 64 | [apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/session-title-rename/renameSessionsConfirmBridge.ts#L11) |
| skillhub | device-link | 65 → 17 → 8 → 65 | [apps/desktop/src/main/skillhub/registerIpc.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/skillhub/registerIpc.ts#L3) |
| skillhub | localDb | 65 → 35 → 8 → 65 | [apps/desktop/src/main/skillhub/allowedProjectRoots.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/skillhub/allowedProjectRoots.ts#L5) |
| skillhub | maker-host | 65 → 38 → 65 | [apps/desktop/src/main/skillhub/activationPreferences.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/skillhub/activationPreferences.ts#L1) |
| skillhub | plugin-oauth | 65 → 48 → 8 → 65 | [apps/desktop/src/main/skillhub/remoteManagementHost.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/skillhub/remoteManagementHost.ts#L10) |
| subscription-accounts | agent-binaries | 66 → 2 → 17 → 66 | [apps/desktop/src/main/subscription-accounts/nativeCli.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/nativeCli.ts#L8) |
| subscription-accounts | device-link | 66 → 17 → 66 | [apps/desktop/src/main/subscription-accounts/ipc.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/ipc.ts#L4) |
| subscription-accounts | goal-host | 66 → 27 → 17 → 66 | [apps/desktop/src/main/subscription-accounts/runtime.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/runtime.ts#L28) |
| subscription-accounts | localDb | 66 → 35 → 17 → 66 | [apps/desktop/src/main/subscription-accounts/prepareSend.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/prepareSend.ts#L1) |
| subscription-accounts | maker-host | 66 → 38 → 66 | [apps/desktop/src/main/subscription-accounts/ipc.ts:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/ipc.ts#L29) |
| subscription-accounts | provider-group | 66 → 51 → 66 | [apps/desktop/src/main/subscription-accounts/legacyQuota.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/legacyQuota.ts#L2) |
| subscription-accounts | usage | 66 → 71 → 66 | [apps/desktop/src/main/subscription-accounts/runtime.ts:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/subscription-accounts/runtime.ts#L53) |
| task-management | device-link | 67 → 17 → 35 → 67 | [apps/desktop/src/main/task-management/ipc.desktop.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/ipc.desktop.ts#L9) |
| task-management | localDb | 67 → 35 → 67 | [apps/desktop/src/main/task-management/service.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/service.ts#L3) |
| task-management | maker-host | 67 → 38 → 35 → 67 | [apps/desktop/src/main/task-management/store.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/store.ts#L1) |
| task-management | remote-desktop-viewer | 67 → 56 → 17 → 35 → 67 | [apps/desktop/src/main/task-management/ipc.desktop.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/ipc.desktop.ts#L11) |
| task-management | right-sidebar-window | 67 → 59 → 35 → 67 | [apps/desktop/src/main/task-management/ipc.desktop.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-management/ipc.desktop.ts#L12) |
| task-migration | cindy-media | 68 → 12 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L48) |
| task-migration | device-link | 68 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L33) |
| task-migration | localDb | 68 → 35 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L24) |
| task-migration | maker-host | 68 → 38 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:59](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L59) |
| task-migration | mcp-integrations | 68 → 42 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:56](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L56) |
| task-migration | session-share | 68 → 63 → 17 → 68 | [apps/desktop/src/main/task-migration/service.ts:49](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/service.ts#L49) |
| task-migration | worktree | 68 → 76 → 68 | [apps/desktop/src/main/task-migration/portableEntries.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/task-migration/portableEntries.ts#L2) |
| terminal | cindy-brain | 69 → 8 → 69 | [apps/desktop/src/main/terminal/terminalToolAccess.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/terminal/terminalToolAccess.ts#L5) |
| terminal | mcp-integrations | 69 → 42 → 69 | [apps/desktop/src/main/terminal/terminalToolAccess.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/terminal/terminalToolAccess.ts#L4) |
| turn-change-set | device-link | 70 → 17 → 35 → 70 | [apps/desktop/src/main/turn-change-set/store.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L30) |
| turn-change-set | git-review | 70 → 24 → 70 | [apps/desktop/src/main/turn-change-set/store.ts:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L24) |
| turn-change-set | localDb | 70 → 35 → 70 | [apps/desktop/src/main/turn-change-set/store.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L26) |
| turn-change-set | maker-ipc | 70 → 39 → 70 | [apps/desktop/src/main/turn-change-set/store.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/turn-change-set/store.ts#L31) |
| usage | device-link | 71 → 17 → 71 | [apps/desktop/src/main/usage/claudeAccountUsage.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/claudeAccountUsage.ts#L22) |
| usage | localDb | 71 → 35 → 71 | [apps/desktop/src/main/usage/accountCurrencyStore.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/accountCurrencyStore.ts#L25) |
| usage | maker-host | 71 → 38 → 71 | [apps/desktop/src/main/usage/accountReferencePrice.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/accountReferencePrice.ts#L3) |
| usage | maker-ipc | 71 → 39 → 71 | [apps/desktop/src/main/usage/gatewayMediaBilling.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/gatewayMediaBilling.ts#L18) |
| usage | model-access | 71 → 44 → 71 | [apps/desktop/src/main/usage/claudeAccountUsage.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/claudeAccountUsage.ts#L1) |
| usage | remote-agent | 71 → 54 → 71 | [apps/desktop/src/main/usage/providerPartyUsageStore.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/providerPartyUsageStore.ts#L25) |
| usage | secrets | 71 → 61 → 44 → 71 | [apps/desktop/src/main/usage/modelPricing.ts:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/modelPricing.ts#L33) |
| usage | subscription-accounts | 71 → 66 → 71 | [apps/desktop/src/main/usage/codexDefaultAccountHome.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/usage/codexDefaultAccountHome.ts#L19) |
| utility-model | local-model-runtime | 72 → 33 → 38 → 72 | [apps/desktop/src/main/utility-model/oneShotCandidates.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/oneShotCandidates.ts#L15) |
| utility-model | maker-host | 72 → 38 → 72 | [apps/desktop/src/main/utility-model/auxiliaryModelSettingsStoreCore.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/auxiliaryModelSettingsStoreCore.ts#L30) |
| utility-model | model-access | 72 → 44 → 8 → 72 | [apps/desktop/src/main/utility-model/oneShotCandidates.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/oneShotCandidates.ts#L13) |
| utility-model | secrets | 72 → 61 → 44 → 8 → 72 | [apps/desktop/src/main/utility-model/oneShotCandidates.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/oneShotCandidates.ts#L14) |
| utility-model | subscription-accounts | 72 → 66 → 38 → 72 | [apps/desktop/src/main/utility-model/oneShotCandidates.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/oneShotCandidates.ts#L21) |
| utility-model | usage | 72 → 71 → 38 → 72 | [apps/desktop/src/main/utility-model/oneShotCandidates.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/utility-model/oneShotCandidates.ts#L1) |
| vision-bridge | maker-host | 73 → 38 → 73 | [apps/desktop/src/main/vision-bridge/piVisionBridgeEnvCore.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/vision-bridge/piVisionBridgeEnvCore.ts#L20) |
| vision-bridge | usage | 73 → 71 → 38 → 73 | [apps/desktop/src/main/vision-bridge/piVisionUsage.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/vision-bridge/piVisionUsage.ts#L1) |
| voice-conversation | cindy-brain | 74 → 8 → 35 → 74 | [apps/desktop/src/main/voice-conversation/index.ts:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/index.ts#L36) |
| voice-conversation | device-link | 74 → 17 → 35 → 74 | [apps/desktop/src/main/voice-conversation/dialogue.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/dialogue.ts#L5) |
| voice-conversation | localDb | 74 → 35 → 74 | [apps/desktop/src/main/voice-conversation/dialogue.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/dialogue.ts#L3) |
| voice-conversation | maker-host | 74 → 38 → 74 | [apps/desktop/src/main/voice-conversation/index.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/index.ts#L10) |
| voice-conversation | model-access | 74 → 44 → 38 → 74 | [apps/desktop/src/main/voice-conversation/index.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/index.ts#L14) |
| voice-conversation | secrets | 74 → 61 → 44 → 38 → 74 | [apps/desktop/src/main/voice-conversation/index.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/index.ts#L13) |
| voice-conversation | utility-model | 74 → 72 → 38 → 74 | [apps/desktop/src/main/voice-conversation/dialogue.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-conversation/dialogue.ts#L7) |
| voice-input | device-link | 75 → 17 → 75 | [apps/desktop/src/main/voice-input/dictionarySyncDriver.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/dictionarySyncDriver.ts#L23) |
| voice-input | maker-host | 75 → 38 → 17 → 75 | [apps/desktop/src/main/voice-input/CindyVoiceSessionClient.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/CindyVoiceSessionClient.ts#L10) |
| voice-input | model-access | 75 → 44 → 8 → 17 → 75 | [apps/desktop/src/main/voice-input/LiteLlmTextModelClient.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/LiteLlmTextModelClient.ts#L11) |
| voice-input | secrets | 75 → 61 → 44 → 8 → 17 → 75 | [apps/desktop/src/main/voice-input/index.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/index.ts#L38) |
| voice-input | usage | 75 → 71 → 17 → 75 | [apps/desktop/src/main/voice-input/CodexResponsesTextModelClient.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/CodexResponsesTextModelClient.ts#L1) |
| voice-input | utility-model | 75 → 72 → 33 → 17 → 75 | [apps/desktop/src/main/voice-input/DictionaryLearningTextModelClient.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/DictionaryLearningTextModelClient.ts#L4) |
| voice-input | voice-conversation | 75 → 74 → 17 → 75 | [apps/desktop/src/main/voice-input/index.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/voice-input/index.ts#L1) |
| worktree | device-link | 76 → 17 → 35 → 76 | [apps/desktop/src/main/worktree/WorktreeManager.ts:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/WorktreeManager.ts#L46) |
| worktree | localDb | 76 → 35 → 76 | [apps/desktop/src/main/worktree/WorktreeManager.ts:66](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/WorktreeManager.ts#L66) |
| worktree | maker-host | 76 → 38 → 76 | [apps/desktop/src/main/worktree/index.ts:173](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/index.ts#L173) |
| worktree | scheduler-host | 76 → 60 → 76 | [apps/desktop/src/main/worktree/gitExec.ts:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/gitExec.ts#L20) |
| worktree | task-migration | 76 → 68 → 76 | [apps/desktop/src/main/worktree/recoveryArchiveTask.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worktree/recoveryArchiveTask.ts#L3) |

## M02 · apps/mobile/src · 17 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | api |
| 2 | auth |
| 3 | chat |
| 4 | components |
| 5 | config |
| 6 | debug |
| 7 | device-link |
| 8 | inputHandoff |
| 9 | notifications |
| 10 | platform |
| 11 | plugins |
| 12 | remote-desktop |
| 13 | scheduler |
| 14 | session |
| 15 | update |
| 16 | utils |
| 17 | widgets |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| api | debug | [apps/mobile/src/api/client.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/api/client.ts#L2) | [apps/mobile/src/debug/visualMock.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/visualMock.ts#L15) |
| api | device-link | [apps/mobile/src/api/client.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/api/client.ts#L3) | [apps/mobile/src/device-link/agentNetDeviceApi.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/agentNetDeviceApi.ts#L2) |
| auth | chat | [apps/mobile/src/auth/AuthContext.tsx:133](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L133) | [apps/mobile/src/chat/ChatInviteHost.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteHost.tsx#L3) |
| auth | components | [apps/mobile/src/auth/LoginCaptchaWebView.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/LoginCaptchaWebView.tsx#L11) | [apps/mobile/src/components/LoginSkinControls.tsx:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/LoginSkinControls.tsx#L33) |
| auth | config | [apps/mobile/src/auth/AuthContext.tsx:71](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L71) | [apps/mobile/src/config/env.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/config/env.ts#L13) |
| auth | debug | [apps/mobile/src/auth/AuthContext.tsx:51](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L51) | [apps/mobile/src/debug/visualMock.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/visualMock.ts#L17) |
| auth | device-link | [apps/mobile/src/auth/AuthContext.tsx:127](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L127) | [apps/mobile/src/device-link/AgentNetSettingsGroup.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/AgentNetSettingsGroup.tsx#L3) |
| auth | notifications | [apps/mobile/src/auth/AuthContext.tsx:123](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L123) | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L1) |
| auth | remote-desktop | [apps/mobile/src/auth/AuthContext.tsx:132](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L132) | [apps/mobile/src/remote-desktop/RemoteDesktopHost.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopHost.tsx#L5) |
| auth | session | [apps/mobile/src/auth/AuthContext.tsx:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L53) | [apps/mobile/src/session/AccountSwitcherSheet.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L15) |
| auth | widgets | [apps/mobile/src/auth/AuthContext.tsx:124](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L124) | [apps/mobile/src/widgets/AgentActivityBridge.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/AgentActivityBridge.tsx#L5) |
| chat | device-link | [apps/mobile/src/chat/chatServerClient.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/chatServerClient.ts#L13) | [apps/mobile/src/device-link/relayAccountDirectory.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/relayAccountDirectory.ts#L27) |
| chat | session | [apps/mobile/src/chat/ChatInviteAvatar.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteAvatar.tsx#L5) | [apps/mobile/src/session/BotGroupChatScreen.tsx:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L19) |
| components | debug | [apps/mobile/src/components/RootErrorBoundary.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/RootErrorBoundary.tsx#L2) | [apps/mobile/src/debug/PluginNoticePreview.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L8) |
| components | device-link | [apps/mobile/src/components/ConnectionBanner.tsx:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/ConnectionBanner.tsx#L14) | [apps/mobile/src/device-link/DeviceManagementList.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceManagementList.tsx#L6) |
| components | platform | [apps/mobile/src/components/LoginNativeButton.ios.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/LoginNativeButton.ios.tsx#L9) | [apps/mobile/src/platform/chrome/AnchoredPullDownMenu.android.tsx:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/platform/chrome/AnchoredPullDownMenu.android.tsx#L38) |
| components | session | [apps/mobile/src/components/MobileVendorIcon.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/MobileVendorIcon.tsx#L4) | [apps/mobile/src/session/AccountSwitcherSheet.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L16) |
| debug | device-link | [apps/mobile/src/debug/PluginNoticePreview.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L17) | [apps/mobile/src/device-link/DeviceLinkContext.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceLinkContext.tsx#L11) |
| debug | plugins | [apps/mobile/src/debug/PluginNoticePreview.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L10) | [apps/mobile/src/plugins/PluginsScreen.tsx:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginsScreen.tsx#L25) |
| debug | session | [apps/mobile/src/debug/devCacheMenu.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/devCacheMenu.ts#L2) | [apps/mobile/src/session/HtmlFileReader.tsx:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HtmlFileReader.tsx#L41) |
| debug | utils | [apps/mobile/src/debug/PluginNoticePreview.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L1) | [apps/mobile/src/utils/gunzipOffThread.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/utils/gunzipOffThread.ts#L1) |
| device-link | notifications | [apps/mobile/src/device-link/agentNetNotifications.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/agentNetNotifications.ts#L9) | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L3) |
| device-link | session | [apps/mobile/src/device-link/AgentNetSettingsGroup.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/AgentNetSettingsGroup.tsx#L6) | [apps/mobile/src/session/AccountSwitcherSheet.tsx:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L20) |
| inputHandoff | session | [apps/mobile/src/inputHandoff/InputHandoffCard.tsx:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/InputHandoffCard.tsx#L28) | [apps/mobile/src/session/InteractionPanel.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/InteractionPanel.tsx#L9) |
| platform | session | [apps/mobile/src/platform/ModalContentArea.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/platform/ModalContentArea.tsx#L5) | [apps/mobile/src/session/BotGroupChatScreen.tsx:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L46) |
| plugins | session | [apps/mobile/src/plugins/MobileMailHtmlPreview.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/MobileMailHtmlPreview.tsx#L6) | [apps/mobile/src/session/HomeChromeDrawer.tsx:63](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HomeChromeDrawer.tsx#L63) |
| scheduler | session | [apps/mobile/src/scheduler/remoteScheduleEvents.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/scheduler/remoteScheduleEvents.ts#L6) | [apps/mobile/src/session/HomeSurface.tsx:196](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HomeSurface.tsx#L196) |
| session | utils | [apps/mobile/src/session/BotGroupChatScreen.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L9) | [apps/mobile/src/utils/useTaskListBack.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/utils/useTaskListBack.ts#L4) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| api | debug | 1 → 6 → 1 | [apps/mobile/src/api/client.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/api/client.ts#L2) |
| api | device-link | 1 → 7 → 1 | [apps/mobile/src/api/client.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/api/client.ts#L3) |
| auth | api | 2 → 1 → 6 → 2 | [apps/mobile/src/auth/AuthContext.tsx:59](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L59) |
| auth | chat | 2 → 3 → 2 | [apps/mobile/src/auth/AuthContext.tsx:133](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L133) |
| auth | components | 2 → 4 → 2 | [apps/mobile/src/auth/LoginCaptchaWebView.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/LoginCaptchaWebView.tsx#L11) |
| auth | config | 2 → 5 → 2 | [apps/mobile/src/auth/AuthContext.tsx:71](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L71) |
| auth | debug | 2 → 6 → 2 | [apps/mobile/src/auth/AuthContext.tsx:51](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L51) |
| auth | device-link | 2 → 7 → 2 | [apps/mobile/src/auth/AuthContext.tsx:127](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L127) |
| auth | notifications | 2 → 9 → 2 | [apps/mobile/src/auth/AuthContext.tsx:123](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L123) |
| auth | platform | 2 → 10 → 4 → 2 | [apps/mobile/src/auth/loginGroupPlacement.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/loginGroupPlacement.ts#L1) |
| auth | remote-desktop | 2 → 12 → 2 | [apps/mobile/src/auth/AuthContext.tsx:132](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L132) |
| auth | session | 2 → 14 → 2 | [apps/mobile/src/auth/AuthContext.tsx:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L53) |
| auth | update | 2 → 15 → 4 → 2 | [apps/mobile/src/auth/AuthContext.tsx:147](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L147) |
| auth | widgets | 2 → 17 → 2 | [apps/mobile/src/auth/AuthContext.tsx:124](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/auth/AuthContext.tsx#L124) |
| chat | api | 3 → 1 → 7 → 3 | [apps/mobile/src/chat/chatInviteShare.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/chatInviteShare.ts#L2) |
| chat | auth | 3 → 2 → 3 | [apps/mobile/src/chat/ChatInviteHost.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteHost.tsx#L3) |
| chat | components | 3 → 4 → 2 → 3 | [apps/mobile/src/chat/ChatInviteAvatar.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteAvatar.tsx#L4) |
| chat | config | 3 → 5 → 2 → 3 | [apps/mobile/src/chat/chatInviteShare.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/chatInviteShare.ts#L1) |
| chat | debug | 3 → 6 → 2 → 3 | [apps/mobile/src/chat/useChatServer.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/useChatServer.ts#L8) |
| chat | device-link | 3 → 7 → 3 | [apps/mobile/src/chat/chatServerClient.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/chatServerClient.ts#L13) |
| chat | platform | 3 → 10 → 14 → 3 | [apps/mobile/src/chat/ChatInviteView.ios.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteView.ios.tsx#L10) |
| chat | session | 3 → 14 → 3 | [apps/mobile/src/chat/ChatInviteAvatar.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/ChatInviteAvatar.tsx#L5) |
| chat | utils | 3 → 16 → 14 → 3 | [apps/mobile/src/chat/useChatServer.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/chat/useChatServer.ts#L22) |
| components | auth | 4 → 2 → 4 | [apps/mobile/src/components/LoginSkinControls.tsx:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/LoginSkinControls.tsx#L33) |
| components | config | 4 → 5 → 2 → 4 | [apps/mobile/src/components/RemoteCompanionAvatar.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/RemoteCompanionAvatar.tsx#L9) |
| components | debug | 4 → 6 → 4 | [apps/mobile/src/components/RootErrorBoundary.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/RootErrorBoundary.tsx#L2) |
| components | device-link | 4 → 7 → 4 | [apps/mobile/src/components/ConnectionBanner.tsx:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/ConnectionBanner.tsx#L14) |
| components | platform | 4 → 10 → 4 | [apps/mobile/src/components/LoginNativeButton.ios.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/LoginNativeButton.ios.tsx#L9) |
| components | session | 4 → 14 → 4 | [apps/mobile/src/components/MobileVendorIcon.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/components/MobileVendorIcon.tsx#L4) |
| config | auth | 5 → 2 → 5 | [apps/mobile/src/config/env.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/config/env.ts#L13) |
| config | platform | 5 → 10 → 4 → 5 | [apps/mobile/src/config/useStartupEndpointGate.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/config/useStartupEndpointGate.ts#L11) |
| debug | api | 6 → 1 → 6 | [apps/mobile/src/debug/visualMock.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/visualMock.ts#L15) |
| debug | auth | 6 → 2 → 6 | [apps/mobile/src/debug/visualMock.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/visualMock.ts#L17) |
| debug | components | 6 → 4 → 6 | [apps/mobile/src/debug/PluginNoticePreview.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L8) |
| debug | config | 6 → 5 → 2 → 6 | [apps/mobile/src/debug/mobileDiagnosticUpload.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/mobileDiagnosticUpload.ts#L5) |
| debug | device-link | 6 → 7 → 6 | [apps/mobile/src/debug/PluginNoticePreview.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L17) |
| debug | platform | 6 → 10 → 4 → 6 | [apps/mobile/src/debug/PluginNoticePreview.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L9) |
| debug | plugins | 6 → 11 → 6 | [apps/mobile/src/debug/PluginNoticePreview.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L10) |
| debug | session | 6 → 14 → 6 | [apps/mobile/src/debug/devCacheMenu.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/devCacheMenu.ts#L2) |
| debug | update | 6 → 15 → 4 → 6 | [apps/mobile/src/debug/mobileDiagnosticUpload.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/mobileDiagnosticUpload.ts#L6) |
| debug | utils | 6 → 16 → 6 | [apps/mobile/src/debug/PluginNoticePreview.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/debug/PluginNoticePreview.tsx#L1) |
| device-link | api | 7 → 1 → 7 | [apps/mobile/src/device-link/agentNetDeviceApi.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/agentNetDeviceApi.ts#L2) |
| device-link | auth | 7 → 2 → 7 | [apps/mobile/src/device-link/AgentNetSettingsGroup.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/AgentNetSettingsGroup.tsx#L3) |
| device-link | chat | 7 → 3 → 7 | [apps/mobile/src/device-link/relayAccountDirectory.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/relayAccountDirectory.ts#L27) |
| device-link | components | 7 → 4 → 7 | [apps/mobile/src/device-link/DeviceManagementList.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceManagementList.tsx#L6) |
| device-link | config | 7 → 5 → 2 → 7 | [apps/mobile/src/device-link/AgentNetSettingsGroup.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/AgentNetSettingsGroup.tsx#L5) |
| device-link | debug | 7 → 6 → 7 | [apps/mobile/src/device-link/DeviceLinkContext.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceLinkContext.tsx#L11) |
| device-link | notifications | 7 → 9 → 7 | [apps/mobile/src/device-link/agentNetNotifications.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/agentNetNotifications.ts#L9) |
| device-link | platform | 7 → 10 → 4 → 7 | [apps/mobile/src/device-link/DeviceManagementList.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceManagementList.tsx#L12) |
| device-link | scheduler | 7 → 13 → 14 → 7 | [apps/mobile/src/device-link/DeviceLinkContext.tsx:179](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceLinkContext.tsx#L179) |
| device-link | session | 7 → 14 → 7 | [apps/mobile/src/device-link/AgentNetSettingsGroup.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/AgentNetSettingsGroup.tsx#L6) |
| device-link | utils | 7 → 16 → 6 → 7 | [apps/mobile/src/device-link/DeviceLinkContext.tsx:211](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/device-link/DeviceLinkContext.tsx#L211) |
| inputHandoff | auth | 8 → 2 → 14 → 8 | [apps/mobile/src/inputHandoff/InputHandoffCard.tsx:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/InputHandoffCard.tsx#L21) |
| inputHandoff | components | 8 → 4 → 14 → 8 | [apps/mobile/src/inputHandoff/InputHandoffCard.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/InputHandoffCard.tsx#L22) |
| inputHandoff | device-link | 8 → 7 → 14 → 8 | [apps/mobile/src/inputHandoff/useInputHandoffSubmit.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/useInputHandoffSubmit.ts#L18) |
| inputHandoff | plugins | 8 → 11 → 14 → 8 | [apps/mobile/src/inputHandoff/useInputHandoffSubmit.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/useInputHandoffSubmit.ts#L19) |
| inputHandoff | session | 8 → 14 → 8 | [apps/mobile/src/inputHandoff/InputHandoffCard.tsx:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/InputHandoffCard.tsx#L28) |
| inputHandoff | utils | 8 → 16 → 14 → 8 | [apps/mobile/src/inputHandoff/InputHandoffCard.tsx:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/inputHandoff/InputHandoffCard.tsx#L30) |
| notifications | api | 9 → 1 → 7 → 9 | [apps/mobile/src/notifications/pushNotifications.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/pushNotifications.ts#L8) |
| notifications | auth | 9 → 2 → 9 | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L1) |
| notifications | chat | 9 → 3 → 2 → 9 | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L9) |
| notifications | config | 9 → 5 → 2 → 9 | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L2) |
| notifications | debug | 9 → 6 → 2 → 9 | [apps/mobile/src/notifications/pushNotifications.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/pushNotifications.ts#L4) |
| notifications | device-link | 9 → 7 → 9 | [apps/mobile/src/notifications/ChatBackgroundBridge.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/ChatBackgroundBridge.tsx#L3) |
| notifications | session | 9 → 14 → 2 → 9 | [apps/mobile/src/notifications/notificationActions.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/notifications/notificationActions.ts#L14) |
| platform | components | 10 → 4 → 10 | [apps/mobile/src/platform/chrome/AnchoredPullDownMenu.android.tsx:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/platform/chrome/AnchoredPullDownMenu.android.tsx#L38) |
| platform | session | 10 → 14 → 10 | [apps/mobile/src/platform/ModalContentArea.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/platform/ModalContentArea.tsx#L5) |
| plugins | auth | 11 → 2 → 6 → 11 | [apps/mobile/src/plugins/PluginCardActions.tsx:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginCardActions.tsx#L53) |
| plugins | components | 11 → 4 → 6 → 11 | [apps/mobile/src/plugins/PluginCardActions.tsx:48](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginCardActions.tsx#L48) |
| plugins | debug | 11 → 6 → 11 | [apps/mobile/src/plugins/PluginsScreen.tsx:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginsScreen.tsx#L25) |
| plugins | device-link | 11 → 7 → 6 → 11 | [apps/mobile/src/plugins/PluginCardActions.tsx:49](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginCardActions.tsx#L49) |
| plugins | platform | 11 → 10 → 14 → 11 | [apps/mobile/src/plugins/PluginDetailView.ios.tsx:53](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginDetailView.ios.tsx#L53) |
| plugins | session | 11 → 14 → 11 | [apps/mobile/src/plugins/MobileMailHtmlPreview.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/MobileMailHtmlPreview.tsx#L6) |
| plugins | utils | 11 → 16 → 6 → 11 | [apps/mobile/src/plugins/PluginsScreen.tsx:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/plugins/PluginsScreen.tsx#L27) |
| remote-desktop | auth | 12 → 2 → 12 | [apps/mobile/src/remote-desktop/RemoteDesktopHost.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopHost.tsx#L5) |
| remote-desktop | components | 12 → 4 → 2 → 12 | [apps/mobile/src/remote-desktop/FoldDesktopSkin.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/FoldDesktopSkin.tsx#L4) |
| remote-desktop | config | 12 → 5 → 2 → 12 | [apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx:106](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx#L106) |
| remote-desktop | debug | 12 → 6 → 2 → 12 | [apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx:117](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx#L117) |
| remote-desktop | device-link | 12 → 7 → 2 → 12 | [apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx#L1) |
| remote-desktop | platform | 12 → 10 → 4 → 2 → 12 | [apps/mobile/src/remote-desktop/FoldDesktopSkin.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/FoldDesktopSkin.tsx#L16) |
| remote-desktop | session | 12 → 14 → 2 → 12 | [apps/mobile/src/remote-desktop/FoldTouchpad.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/FoldTouchpad.tsx#L5) |
| remote-desktop | utils | 12 → 16 → 6 → 2 → 12 | [apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx:116](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/remote-desktop/RemoteDesktopScreen.tsx#L116) |
| scheduler | session | 13 → 14 → 13 | [apps/mobile/src/scheduler/remoteScheduleEvents.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/scheduler/remoteScheduleEvents.ts#L6) |
| session | api | 14 → 1 → 6 → 14 | [apps/mobile/src/session/mobileAttachmentUpload.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/mobileAttachmentUpload.ts#L1) |
| session | auth | 14 → 2 → 14 | [apps/mobile/src/session/AccountSwitcherSheet.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L15) |
| session | chat | 14 → 3 → 14 | [apps/mobile/src/session/BotGroupChatScreen.tsx:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L19) |
| session | components | 14 → 4 → 14 | [apps/mobile/src/session/AccountSwitcherSheet.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L16) |
| session | config | 14 → 5 → 2 → 14 | [apps/mobile/src/session/mobileAttachmentUpload.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/mobileAttachmentUpload.ts#L6) |
| session | debug | 14 → 6 → 14 | [apps/mobile/src/session/HtmlFileReader.tsx:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HtmlFileReader.tsx#L41) |
| session | device-link | 14 → 7 → 14 | [apps/mobile/src/session/AccountSwitcherSheet.tsx:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/AccountSwitcherSheet.tsx#L20) |
| session | inputHandoff | 14 → 8 → 14 | [apps/mobile/src/session/InteractionPanel.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/InteractionPanel.tsx#L9) |
| session | platform | 14 → 10 → 14 | [apps/mobile/src/session/BotGroupChatScreen.tsx:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L46) |
| session | plugins | 14 → 11 → 14 | [apps/mobile/src/session/HomeChromeDrawer.tsx:63](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HomeChromeDrawer.tsx#L63) |
| session | scheduler | 14 → 13 → 14 | [apps/mobile/src/session/HomeSurface.tsx:196](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/HomeSurface.tsx#L196) |
| session | utils | 14 → 16 → 14 | [apps/mobile/src/session/BotGroupChatScreen.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/session/BotGroupChatScreen.tsx#L9) |
| update | components | 15 → 4 → 2 → 15 | [apps/mobile/src/update/AndroidUpdateSheet.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/update/AndroidUpdateSheet.tsx#L6) |
| update | config | 15 → 5 → 2 → 15 | [apps/mobile/src/update/AndroidUpdateSheet.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/update/AndroidUpdateSheet.tsx#L8) |
| update | platform | 15 → 10 → 4 → 2 → 15 | [apps/mobile/src/update/AndroidUpdateSheet.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/update/AndroidUpdateSheet.tsx#L12) |
| update | session | 15 → 14 → 2 → 15 | [apps/mobile/src/update/AndroidUpdateSheet.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/update/AndroidUpdateSheet.tsx#L10) |
| utils | debug | 16 → 6 → 16 | [apps/mobile/src/utils/gunzipOffThread.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/utils/gunzipOffThread.ts#L1) |
| utils | session | 16 → 14 → 16 | [apps/mobile/src/utils/useTaskListBack.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/utils/useTaskListBack.ts#L4) |
| widgets | auth | 17 → 2 → 17 | [apps/mobile/src/widgets/AgentActivityBridge.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/AgentActivityBridge.tsx#L5) |
| widgets | config | 17 → 5 → 2 → 17 | [apps/mobile/src/widgets/agentActivityPush.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/agentActivityPush.ts#L8) |
| widgets | debug | 17 → 6 → 2 → 17 | [apps/mobile/src/widgets/agentActivityPush.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/agentActivityPush.ts#L16) |
| widgets | device-link | 17 → 7 → 2 → 17 | [apps/mobile/src/widgets/AgentActivityBridge.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/AgentActivityBridge.tsx#L6) |
| widgets | notifications | 17 → 9 → 2 → 17 | [apps/mobile/src/widgets/agentActivityPush.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/agentActivityPush.ts#L14) |
| widgets | session | 17 → 14 → 2 → 17 | [apps/mobile/src/widgets/AgentActivityBridge.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/mobile/src/widgets/AgentActivityBridge.tsx#L7) |

## M03 · apps/desktop/src/renderer/components · 17 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | auth |
| 2 | chat |
| 3 | cindy-make |
| 4 | diff-panel |
| 5 | error |
| 6 | feishuBot |
| 7 | find-in-page |
| 8 | layout |
| 9 | log-support |
| 10 | markdown |
| 11 | new-chat |
| 12 | performance-trace |
| 13 | settings |
| 14 | sidebar |
| 15 | status |
| 16 | title-bar |
| 17 | ui |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| chat | cindy-make | [apps/desktop/src/renderer/components/chat/CindyMakeDoctorCard.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/CindyMakeDoctorCard.tsx#L16) | [apps/desktop/src/renderer/components/cindy-make/CindyMakePreflightDialog.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/cindy-make/CindyMakePreflightDialog.tsx#L10) |
| chat | markdown | [apps/desktop/src/renderer/components/chat/MarkdownDiffBlock.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/MarkdownDiffBlock.tsx#L22) | [apps/desktop/src/renderer/components/markdown/MarkdownImageLightboxHost.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/markdown/MarkdownImageLightboxHost.tsx#L15) |
| chat | new-chat | [apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx#L17) | [apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx#L34) |
| chat | status | [apps/desktop/src/renderer/components/chat/MessageActionBar.tsx:72](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/MessageActionBar.tsx#L72) | [apps/desktop/src/renderer/components/status/TodaySpendChip.tsx:56](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/status/TodaySpendChip.tsx#L56) |
| layout | log-support | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:42](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L42) | [apps/desktop/src/renderer/components/log-support/StartupLogSupport.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/log-support/StartupLogSupport.tsx#L9) |
| layout | performance-trace | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L6) | [apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx#L7) |
| layout | settings | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:44](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L44) | [apps/desktop/src/renderer/components/settings/AddProviderWizard.tsx:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/AddProviderWizard.tsx#L25) |
| layout | sidebar | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L28) | [apps/desktop/src/renderer/components/sidebar/Sidebar.tsx:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/sidebar/Sidebar.tsx#L29) |
| layout | ui | [apps/desktop/src/renderer/components/layout/ChromeActions.tsx:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/ChromeActions.tsx#L41) | [apps/desktop/src/renderer/components/ui/confirm-dialog.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/ui/confirm-dialog.tsx#L8) |
| new-chat | settings | [apps/desktop/src/renderer/components/new-chat/McpSetupPrompt.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/McpSetupPrompt.tsx#L3) | [apps/desktop/src/renderer/components/settings/HookWorkspacePrefsEditor.tsx:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/HookWorkspacePrefsEditor.tsx#L32) |
| new-chat | status | [apps/desktop/src/renderer/components/new-chat/ModelPoolQuota.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/ModelPoolQuota.tsx#L10) | [apps/desktop/src/renderer/components/status/TodaySpendChip.tsx:163](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/status/TodaySpendChip.tsx#L163) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| auth | error | 1 → 5 → 17 → 8 → 1 | [apps/desktop/src/renderer/components/auth/LocalDbGate.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/auth/LocalDbGate.tsx#L7) |
| auth | ui | 1 → 17 → 8 → 1 | [apps/desktop/src/renderer/components/auth/CredentialStoreHelpDialog.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/auth/CredentialStoreHelpDialog.tsx#L4) |
| chat | cindy-make | 2 → 3 → 2 | [apps/desktop/src/renderer/components/chat/CindyMakeDoctorCard.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/CindyMakeDoctorCard.tsx#L16) |
| chat | find-in-page | 2 → 7 → 8 → 13 → 2 | [apps/desktop/src/renderer/components/chat/TextLightbox.tsx:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/TextLightbox.tsx#L31) |
| chat | layout | 2 → 8 → 13 → 2 | [apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx#L4) |
| chat | markdown | 2 → 10 → 2 | [apps/desktop/src/renderer/components/chat/MarkdownDiffBlock.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/MarkdownDiffBlock.tsx#L22) |
| chat | new-chat | 2 → 11 → 2 | [apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/GhostCardHostPrompts.tsx#L17) |
| chat | status | 2 → 15 → 2 | [apps/desktop/src/renderer/components/chat/MessageActionBar.tsx:72](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/MessageActionBar.tsx#L72) |
| chat | ui | 2 → 17 → 8 → 13 → 2 | [apps/desktop/src/renderer/components/chat/AgentActionRow.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/AgentActionRow.tsx#L3) |
| cindy-make | chat | 3 → 2 → 3 | [apps/desktop/src/renderer/components/cindy-make/CindyMakePreflightDialog.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/cindy-make/CindyMakePreflightDialog.tsx#L10) |
| cindy-make | ui | 3 → 17 → 8 → 13 → 3 | [apps/desktop/src/renderer/components/cindy-make/CindyMakeCompleteCard.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/cindy-make/CindyMakeCompleteCard.tsx#L5) |
| diff-panel | chat | 4 → 2 → 8 → 13 → 4 | [apps/desktop/src/renderer/components/diff-panel/FileChangeGroup.tsx:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/diff-panel/FileChangeGroup.tsx#L14) |
| diff-panel | ui | 4 → 17 → 8 → 13 → 4 | [apps/desktop/src/renderer/components/diff-panel/FileChangeGroup.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/diff-panel/FileChangeGroup.tsx#L15) |
| error | ui | 5 → 17 → 8 → 1 → 5 | [apps/desktop/src/renderer/components/error/AppCrashScreen.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/error/AppCrashScreen.tsx#L1) |
| feishuBot | ui | 6 → 17 → 8 → 6 | [apps/desktop/src/renderer/components/feishuBot/FeishuConflictDialog.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/feishuBot/FeishuConflictDialog.tsx#L1) |
| find-in-page | layout | 7 → 8 → 13 → 2 → 7 | [apps/desktop/src/renderer/components/find-in-page/FindInPageBar.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/find-in-page/FindInPageBar.tsx#L10) |
| layout | auth | 8 → 1 → 17 → 8 | [apps/desktop/src/renderer/components/layout/CredentialStoreBanner.tsx:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/CredentialStoreBanner.tsx#L26) |
| layout | feishuBot | 8 → 6 → 17 → 8 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L41) |
| layout | log-support | 8 → 9 → 8 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:42](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L42) |
| layout | performance-trace | 8 → 12 → 8 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L6) |
| layout | settings | 8 → 13 → 8 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:44](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L44) |
| layout | sidebar | 8 → 14 → 8 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L28) |
| layout | title-bar | 8 → 16 → 12 → 8 | [apps/desktop/src/renderer/components/layout/ChromeActions.tsx:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/ChromeActions.tsx#L39) |
| layout | ui | 8 → 17 → 8 | [apps/desktop/src/renderer/components/layout/ChromeActions.tsx:41](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/ChromeActions.tsx#L41) |
| log-support | layout | 9 → 8 → 9 | [apps/desktop/src/renderer/components/log-support/StartupLogSupport.tsx:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/log-support/StartupLogSupport.tsx#L9) |
| log-support | ui | 9 → 17 → 8 → 9 | [apps/desktop/src/renderer/components/log-support/LogSupportActions.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/log-support/LogSupportActions.tsx#L4) |
| markdown | chat | 10 → 2 → 10 | [apps/desktop/src/renderer/components/markdown/MarkdownImageLightboxHost.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/markdown/MarkdownImageLightboxHost.tsx#L15) |
| markdown | layout | 10 → 8 → 13 → 10 | [apps/desktop/src/renderer/components/markdown/MermaidSourceEditor.tsx:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/markdown/MermaidSourceEditor.tsx#L28) |
| markdown | ui | 10 → 17 → 8 → 13 → 10 | [apps/desktop/src/renderer/components/markdown/MermaidSourceEditor.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/markdown/MermaidSourceEditor.tsx#L1) |
| new-chat | chat | 11 → 2 → 11 | [apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx#L34) |
| new-chat | cindy-make | 11 → 3 → 2 → 11 | [apps/desktop/src/renderer/components/new-chat/ChatInput.tsx:280](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/ChatInput.tsx#L280) |
| new-chat | find-in-page | 11 → 7 → 8 → 13 → 11 | [apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx:36](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx#L36) |
| new-chat | layout | 11 → 8 → 13 → 11 | [apps/desktop/src/renderer/components/new-chat/CheckoutFeedback.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/CheckoutFeedback.tsx#L1) |
| new-chat | settings | 11 → 13 → 11 | [apps/desktop/src/renderer/components/new-chat/McpSetupPrompt.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/McpSetupPrompt.tsx#L3) |
| new-chat | sidebar | 11 → 14 → 8 → 13 → 11 | [apps/desktop/src/renderer/components/new-chat/PendingQueuePanel.tsx:40](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/PendingQueuePanel.tsx#L40) |
| new-chat | status | 11 → 15 → 11 | [apps/desktop/src/renderer/components/new-chat/ModelPoolQuota.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/ModelPoolQuota.tsx#L10) |
| new-chat | ui | 11 → 17 → 8 → 13 → 11 | [apps/desktop/src/renderer/components/new-chat/AddDirectoryPanel.tsx:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AddDirectoryPanel.tsx#L21) |
| performance-trace | layout | 12 → 8 → 12 | [apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx#L7) |
| performance-trace | ui | 12 → 17 → 8 → 12 | [apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/performance-trace/PerformanceTrace.tsx#L5) |
| settings | chat | 13 → 2 → 8 → 13 | [apps/desktop/src/renderer/components/settings/AvatarCropEditor.tsx:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/AvatarCropEditor.tsx#L13) |
| settings | cindy-make | 13 → 3 → 2 → 8 → 13 | [apps/desktop/src/renderer/components/settings/CindyMakeSection.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/CindyMakeSection.tsx#L12) |
| settings | diff-panel | 13 → 4 → 2 → 8 → 13 | [apps/desktop/src/renderer/components/settings/HelpAssistantPanel.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/HelpAssistantPanel.tsx#L4) |
| settings | layout | 13 → 8 → 13 | [apps/desktop/src/renderer/components/settings/AddProviderWizard.tsx:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/AddProviderWizard.tsx#L25) |
| settings | log-support | 13 → 9 → 8 → 13 | [apps/desktop/src/renderer/components/settings/AboutSection.tsx:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/AboutSection.tsx#L29) |
| settings | markdown | 13 → 10 → 8 → 13 | [apps/desktop/src/renderer/components/settings/DockIconPicker.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/DockIconPicker.tsx#L6) |
| settings | new-chat | 13 → 11 → 13 | [apps/desktop/src/renderer/components/settings/HookWorkspacePrefsEditor.tsx:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/HookWorkspacePrefsEditor.tsx#L32) |
| settings | sidebar | 13 → 14 → 8 → 13 | [apps/desktop/src/renderer/components/settings/ProvidersSection.tsx:139](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/ProvidersSection.tsx#L139) |
| settings | status | 13 → 15 → 11 → 13 | [apps/desktop/src/renderer/components/settings/OwnRemoteProviders.tsx:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/OwnRemoteProviders.tsx#L25) |
| settings | ui | 13 → 17 → 8 → 13 | [apps/desktop/src/renderer/components/settings/AboutSection.tsx:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/settings/AboutSection.tsx#L20) |
| sidebar | layout | 14 → 8 → 14 | [apps/desktop/src/renderer/components/sidebar/Sidebar.tsx:29](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/sidebar/Sidebar.tsx#L29) |
| sidebar | title-bar | 14 → 16 → 12 → 8 → 14 | [apps/desktop/src/renderer/components/sidebar/TaskListModeToggle.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/sidebar/TaskListModeToggle.tsx#L5) |
| sidebar | ui | 14 → 17 → 8 → 14 | [apps/desktop/src/renderer/components/sidebar/AccountSwitcherDialog.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/sidebar/AccountSwitcherDialog.tsx#L1) |
| status | chat | 15 → 2 → 15 | [apps/desktop/src/renderer/components/status/TodaySpendChip.tsx:56](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/status/TodaySpendChip.tsx#L56) |
| status | new-chat | 15 → 11 → 15 | [apps/desktop/src/renderer/components/status/TodaySpendChip.tsx:163](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/status/TodaySpendChip.tsx#L163) |
| status | ui | 15 → 17 → 8 → 13 → 15 | [apps/desktop/src/renderer/components/status/CodexResetAutoUseControl.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/status/CodexResetAutoUseControl.tsx#L5) |
| title-bar | performance-trace | 16 → 12 → 8 → 16 | [apps/desktop/src/renderer/components/title-bar/MenuButton.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/title-bar/MenuButton.tsx#L2) |
| title-bar | ui | 16 → 17 → 8 → 16 | [apps/desktop/src/renderer/components/title-bar/ChromeIconButton.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/title-bar/ChromeIconButton.tsx#L3) |
| ui | layout | 17 → 8 → 17 | [apps/desktop/src/renderer/components/ui/confirm-dialog.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/ui/confirm-dialog.tsx#L8) |

## M04 · apps/desktop/src/renderer/features · 13 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | bots |
| 2 | cc-agent |
| 3 | device-link |
| 4 | input-handoff |
| 5 | learn |
| 6 | model-groups |
| 7 | plugin |
| 8 | provider-group |
| 9 | provider-share |
| 10 | remote-desktop |
| 11 | right-sidebar |
| 12 | scheduler |
| 13 | task-tags |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| bots | cc-agent | [apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx#L23) | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L11) |
| bots | device-link | [apps/desktop/src/renderer/features/bots/BotAuthorizationCard.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotAuthorizationCard.tsx#L11) | [apps/desktop/src/renderer/features/device-link/agentIslandRemoteSessions.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/agentIslandRemoteSessions.ts#L13) |
| bots | right-sidebar | [apps/desktop/src/renderer/features/bots/voice/GlobalVoiceCall.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/voice/GlobalVoiceCall.tsx#L12) | [apps/desktop/src/renderer/features/right-sidebar/lib/useTabCreationMenu.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/lib/useTabCreationMenu.ts#L5) |
| bots | scheduler | [apps/desktop/src/renderer/features/bots/BotAutomationsSettings.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotAutomationsSettings.tsx#L12) | [apps/desktop/src/renderer/features/scheduler/hooks/useProjectLabel.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/hooks/useProjectLabel.ts#L4) |
| cc-agent | device-link | [apps/desktop/src/renderer/features/cc-agent/CCAgentIndexRedirect.tsx:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentIndexRedirect.tsx#L30) | [apps/desktop/src/renderer/features/device-link/SharedTasksSection.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/SharedTasksSection.tsx#L5) |
| cc-agent | plugin | [apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx:249](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx#L249) | [apps/desktop/src/renderer/features/plugin/GhostMainViewFeatureLayout.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/plugin/GhostMainViewFeatureLayout.tsx#L2) |
| cc-agent | provider-share | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:223](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L223) | [apps/desktop/src/renderer/features/provider-share/ProviderShareGlobalHost.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-share/ProviderShareGlobalHost.tsx#L17) |
| cc-agent | right-sidebar | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:121](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L121) | [apps/desktop/src/renderer/features/right-sidebar/TabDragController.tsx:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/TabDragController.tsx#L23) |
| cc-agent | scheduler | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:166](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L166) | [apps/desktop/src/renderer/features/scheduler/SchedulerPage.tsx:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/SchedulerPage.tsx#L39) |
| cc-agent | task-tags | [apps/desktop/src/renderer/features/cc-agent/SessionContentHeader.tsx:86](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/SessionContentHeader.tsx#L86) | [apps/desktop/src/renderer/features/task-tags/TaskTags.tsx:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/task-tags/TaskTags.tsx#L20) |
| device-link | scheduler | [apps/desktop/src/renderer/features/device-link/refreshRemoteSessions.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/refreshRemoteSessions.ts#L18) | [apps/desktop/src/renderer/features/scheduler/lib/archiveScheduleWarning.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/lib/archiveScheduleWarning.ts#L9) |
| provider-group | provider-share | [apps/desktop/src/renderer/features/provider-group/GroupMemberReshare.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-group/GroupMemberReshare.tsx#L10) | [apps/desktop/src/renderer/features/provider-share/ProviderShareApproveDialog.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-share/ProviderShareApproveDialog.tsx#L11) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| bots | cc-agent | 1 → 2 → 1 | [apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx#L23) |
| bots | device-link | 1 → 3 → 1 | [apps/desktop/src/renderer/features/bots/BotAuthorizationCard.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotAuthorizationCard.tsx#L11) |
| bots | input-handoff | 1 → 4 → 3 → 1 | [apps/desktop/src/renderer/features/bots/BotGroupPendingInteraction.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotGroupPendingInteraction.tsx#L22) |
| bots | plugin | 1 → 7 → 2 → 1 | [apps/desktop/src/renderer/features/bots/remoteBotSettingsClient.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/remoteBotSettingsClient.ts#L7) |
| bots | right-sidebar | 1 → 11 → 1 | [apps/desktop/src/renderer/features/bots/voice/GlobalVoiceCall.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/voice/GlobalVoiceCall.tsx#L12) |
| bots | scheduler | 1 → 12 → 1 | [apps/desktop/src/renderer/features/bots/BotAutomationsSettings.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotAutomationsSettings.tsx#L12) |
| cc-agent | bots | 2 → 1 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L11) |
| cc-agent | device-link | 2 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentIndexRedirect.tsx:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentIndexRedirect.tsx#L30) |
| cc-agent | input-handoff | 2 → 4 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:136](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L136) |
| cc-agent | learn | 2 → 5 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:120](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L120) |
| cc-agent | model-groups | 2 → 6 → 9 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:104](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L104) |
| cc-agent | plugin | 2 → 7 → 2 | [apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx:249](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx#L249) |
| cc-agent | provider-group | 2 → 8 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:224](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L224) |
| cc-agent | provider-share | 2 → 9 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:223](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L223) |
| cc-agent | remote-desktop | 2 → 10 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:165](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L165) |
| cc-agent | right-sidebar | 2 → 11 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:121](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L121) |
| cc-agent | scheduler | 2 → 12 → 2 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:166](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L166) |
| cc-agent | task-tags | 2 → 13 → 2 | [apps/desktop/src/renderer/features/cc-agent/SessionContentHeader.tsx:86](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/SessionContentHeader.tsx#L86) |
| device-link | bots | 3 → 1 → 3 | [apps/desktop/src/renderer/features/device-link/agentIslandRemoteSessions.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/agentIslandRemoteSessions.ts#L13) |
| device-link | cc-agent | 3 → 2 → 3 | [apps/desktop/src/renderer/features/device-link/SharedTasksSection.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/SharedTasksSection.tsx#L5) |
| device-link | scheduler | 3 → 12 → 3 | [apps/desktop/src/renderer/features/device-link/refreshRemoteSessions.ts:18](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/refreshRemoteSessions.ts#L18) |
| device-link | task-tags | 3 → 13 → 2 → 3 | [apps/desktop/src/renderer/features/device-link/useDeviceLinkRemoteProjects.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/device-link/useDeviceLinkRemoteProjects.ts#L1) |
| input-handoff | device-link | 4 → 3 → 1 → 4 | [apps/desktop/src/renderer/features/input-handoff/InputHandoffCard.tsx:33](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/input-handoff/InputHandoffCard.tsx#L33) |
| learn | device-link | 5 → 3 → 2 → 5 | [apps/desktop/src/renderer/features/learn/LearnStatusCard.tsx:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/learn/LearnStatusCard.tsx#L27) |
| model-groups | provider-share | 6 → 9 → 2 → 6 | [apps/desktop/src/renderer/features/model-groups/modelGroupsClient.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/model-groups/modelGroupsClient.ts#L13) |
| plugin | cc-agent | 7 → 2 → 7 | [apps/desktop/src/renderer/features/plugin/GhostMainViewFeatureLayout.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/plugin/GhostMainViewFeatureLayout.tsx#L2) |
| plugin | device-link | 7 → 3 → 1 → 7 | [apps/desktop/src/renderer/features/plugin/PluginDevicePicker.tsx:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/plugin/PluginDevicePicker.tsx#L13) |
| plugin | right-sidebar | 7 → 11 → 1 → 7 | [apps/desktop/src/renderer/features/plugin/GhostMainViewHost.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/plugin/GhostMainViewHost.tsx#L12) |
| provider-group | device-link | 8 → 3 → 2 → 8 | [apps/desktop/src/renderer/features/provider-group/GroupMemberAccounts.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-group/GroupMemberAccounts.tsx#L22) |
| provider-group | provider-share | 8 → 9 → 8 | [apps/desktop/src/renderer/features/provider-group/GroupMemberReshare.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-group/GroupMemberReshare.tsx#L10) |
| provider-share | cc-agent | 9 → 2 → 9 | [apps/desktop/src/renderer/features/provider-share/ProviderShareGlobalHost.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-share/ProviderShareGlobalHost.tsx#L17) |
| provider-share | device-link | 9 → 3 → 2 → 9 | [apps/desktop/src/renderer/features/provider-share/ProviderShareApplyDialog.tsx:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-share/ProviderShareApplyDialog.tsx#L27) |
| provider-share | provider-group | 9 → 8 → 9 | [apps/desktop/src/renderer/features/provider-share/ProviderShareApproveDialog.tsx:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/provider-share/ProviderShareApproveDialog.tsx#L11) |
| remote-desktop | device-link | 10 → 3 → 2 → 10 | [apps/desktop/src/renderer/features/remote-desktop/TaskRemoteDesktopButton.tsx:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/remote-desktop/TaskRemoteDesktopButton.tsx#L8) |
| remote-desktop | plugin | 10 → 7 → 2 → 10 | [apps/desktop/src/renderer/features/remote-desktop/TaskLiveScreenButtons.tsx:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/remote-desktop/TaskLiveScreenButtons.tsx#L12) |
| remote-desktop | right-sidebar | 10 → 11 → 2 → 10 | [apps/desktop/src/renderer/features/remote-desktop/TaskLiveScreenButtons.tsx:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/remote-desktop/TaskLiveScreenButtons.tsx#L13) |
| right-sidebar | bots | 11 → 1 → 11 | [apps/desktop/src/renderer/features/right-sidebar/lib/useTabCreationMenu.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/lib/useTabCreationMenu.ts#L5) |
| right-sidebar | cc-agent | 11 → 2 → 11 | [apps/desktop/src/renderer/features/right-sidebar/TabDragController.tsx:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/TabDragController.tsx#L23) |
| right-sidebar | device-link | 11 → 3 → 1 → 11 | [apps/desktop/src/renderer/features/right-sidebar/lib/mailPreview.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/lib/mailPreview.ts#L4) |
| scheduler | bots | 12 → 1 → 12 | [apps/desktop/src/renderer/features/scheduler/hooks/useProjectLabel.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/hooks/useProjectLabel.ts#L4) |
| scheduler | cc-agent | 12 → 2 → 12 | [apps/desktop/src/renderer/features/scheduler/SchedulerPage.tsx:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/SchedulerPage.tsx#L39) |
| scheduler | device-link | 12 → 3 → 12 | [apps/desktop/src/renderer/features/scheduler/lib/archiveScheduleWarning.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/lib/archiveScheduleWarning.ts#L9) |
| task-tags | cc-agent | 13 → 2 → 13 | [apps/desktop/src/renderer/features/task-tags/TaskTags.tsx:20](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/task-tags/TaskTags.tsx#L20) |

## M05 · apps/desktop/src/renderer · 12 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | appearance |
| 2 | cindy-brain |
| 3 | components |
| 4 | contexts |
| 5 | features |
| 6 | hooks |
| 7 | i18n |
| 8 | layout |
| 9 | lib |
| 10 | state |
| 11 | themes |
| 12 | voice-input |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| cindy-brain | components | [apps/desktop/src/renderer/cindy-brain/ForgeOidcInstallConfirmHost.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/ForgeOidcInstallConfirmHost.tsx#L4) | [apps/desktop/src/renderer/components/chat/AgentActionRow.tsx:99](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/AgentActionRow.tsx#L99) |
| cindy-brain | features | [apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx#L15) | [apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx#L15) |
| cindy-brain | hooks | [apps/desktop/src/renderer/cindy-brain/PluginModelPickerHost.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/PluginModelPickerHost.tsx#L10) | [apps/desktop/src/renderer/hooks/useAttachments.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useAttachments.ts#L23) |
| cindy-brain | lib | [apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx#L17) | [apps/desktop/src/renderer/lib/editLastUserMessage.ts:42](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/editLastUserMessage.ts#L42) |
| components | contexts | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L5) | [apps/desktop/src/renderer/contexts/AuthContext.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L16) |
| components | features | [apps/desktop/src/renderer/components/auth/LocalDbGate.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/auth/LocalDbGate.tsx#L10) | [apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx#L1) |
| components | hooks | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L7) | [apps/desktop/src/renderer/hooks/useBrandLogo.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useBrandLogo.ts#L10) |
| components | lib | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L2) | [apps/desktop/src/renderer/lib/agent-actions/workActivityProjection.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/agent-actions/workActivityProjection.ts#L15) |
| components | state | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L1) | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L21) |
| components | voice-input | [apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx#L45) | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L6) |
| contexts | features | [apps/desktop/src/renderer/contexts/AuthContext.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L1) | [apps/desktop/src/renderer/features/billing/BillingPage.tsx:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingPage.tsx#L32) |
| contexts | lib | [apps/desktop/src/renderer/contexts/AppShellCoverContext.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AppShellCoverContext.tsx#L5) | [apps/desktop/src/renderer/lib/cindyMakeCommand.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/cindyMakeCommand.ts#L6) |
| contexts | state | [apps/desktop/src/renderer/contexts/AuthContext.tsx:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L46) | [apps/desktop/src/renderer/state/newMakerDraft.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/newMakerDraft.ts#L26) |
| features | hooks | [apps/desktop/src/renderer/features/bots/BotChannelsPage.tsx:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotChannelsPage.tsx#L34) | [apps/desktop/src/renderer/hooks/useCCSessions.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useCCSessions.ts#L34) |
| features | lib | [apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx#L10) | [apps/desktop/src/renderer/lib/backgroundTaskStop.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/backgroundTaskStop.ts#L11) |
| features | state | [apps/desktop/src/renderer/features/bots/BotGroupChatView.tsx:67](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotGroupChatView.tsx#L67) | [apps/desktop/src/renderer/state/newMakerDraft.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/newMakerDraft.ts#L3) |
| hooks | lib | [apps/desktop/src/renderer/hooks/codexAuthLogin.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/codexAuthLogin.ts#L2) | [apps/desktop/src/renderer/lib/checkForUpdateWithToast.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/checkForUpdateWithToast.ts#L1) |
| hooks | state | [apps/desktop/src/renderer/hooks/useCCSessions.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useCCSessions.ts#L38) | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L22) |
| hooks | voice-input | [apps/desktop/src/renderer/hooks/useComposerSendShortcutPreference.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useComposerSendShortcutPreference.ts#L5) | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L7) |
| i18n | lib | [apps/desktop/src/renderer/i18n/index.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/i18n/index.ts#L26) | [apps/desktop/src/renderer/lib/autoPermissionFallbackToast.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/autoPermissionFallbackToast.ts#L8) |
| lib | state | [apps/desktop/src/renderer/lib/errorDiagnosisPrompt.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/errorDiagnosisPrompt.ts#L16) | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L23) |
| lib | voice-input | [apps/desktop/src/renderer/lib/appShortcutStore.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/appShortcutStore.ts#L13) | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L5) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| appearance | i18n | 1 → 7 → 9 → 2 → 1 | [apps/desktop/src/renderer/appearance/AppearancePresenter.ts:73](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/appearance/AppearancePresenter.ts#L73) |
| appearance | lib | 1 → 9 → 2 → 1 | [apps/desktop/src/renderer/appearance/AppearancePresenter.ts:73](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/appearance/AppearancePresenter.ts#L73) |
| appearance | themes | 1 → 11 → 9 → 2 → 1 | [apps/desktop/src/renderer/appearance/AppearancePresenter.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/appearance/AppearancePresenter.ts#L4) |
| cindy-brain | appearance | 2 → 1 → 9 → 2 | [apps/desktop/src/renderer/cindy-brain/usePluginAppearance.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/usePluginAppearance.ts#L6) |
| cindy-brain | components | 2 → 3 → 2 | [apps/desktop/src/renderer/cindy-brain/ForgeOidcInstallConfirmHost.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/ForgeOidcInstallConfirmHost.tsx#L4) |
| cindy-brain | contexts | 2 → 4 → 3 → 2 | [apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx#L14) |
| cindy-brain | features | 2 → 5 → 2 | [apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx#L15) |
| cindy-brain | hooks | 2 → 6 → 2 | [apps/desktop/src/renderer/cindy-brain/PluginModelPickerHost.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/PluginModelPickerHost.tsx#L10) |
| cindy-brain | lib | 2 → 9 → 2 | [apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/GhostInstallConsentHost.tsx#L17) |
| cindy-brain | state | 2 → 10 → 3 → 2 | [apps/desktop/src/renderer/cindy-brain/PluginTaskPrefs.tsx:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/PluginTaskPrefs.tsx#L23) |
| cindy-brain | themes | 2 → 11 → 9 → 2 | [apps/desktop/src/renderer/cindy-brain/importCindyFile.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/cindy-brain/importCindyFile.ts#L3) |
| components | cindy-brain | 3 → 2 → 3 | [apps/desktop/src/renderer/components/chat/AgentActionRow.tsx:99](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/AgentActionRow.tsx#L99) |
| components | contexts | 3 → 4 → 3 | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L5) |
| components | features | 3 → 5 → 3 | [apps/desktop/src/renderer/components/auth/LocalDbGate.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/auth/LocalDbGate.tsx#L10) |
| components | hooks | 3 → 6 → 3 | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L7) |
| components | i18n | 3 → 7 → 9 → 3 | [apps/desktop/src/renderer/components/chat/MarkdownRenderer.tsx:113](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/chat/MarkdownRenderer.tsx#L113) |
| components | layout | 3 → 8 → 2 → 3 | [apps/desktop/src/renderer/components/layout/MainLayout.tsx:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/layout/MainLayout.tsx#L30) |
| components | lib | 3 → 9 → 3 | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L2) |
| components | state | 3 → 10 → 3 | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L1) |
| components | themes | 3 → 11 → 9 → 3 | [apps/desktop/src/renderer/components/AppPreferenceControl.tsx:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/AppPreferenceControl.tsx#L19) |
| components | voice-input | 3 → 12 → 3 | [apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/components/new-chat/AskUserQuestionPrompt.tsx#L45) |
| contexts | components | 4 → 3 → 4 | [apps/desktop/src/renderer/contexts/AuthContext.tsx:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L16) |
| contexts | features | 4 → 5 → 4 | [apps/desktop/src/renderer/contexts/AuthContext.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L1) |
| contexts | lib | 4 → 9 → 4 | [apps/desktop/src/renderer/contexts/AppShellCoverContext.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AppShellCoverContext.tsx#L5) |
| contexts | state | 4 → 10 → 4 | [apps/desktop/src/renderer/contexts/AuthContext.tsx:46](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/contexts/AuthContext.tsx#L46) |
| features | appearance | 5 → 1 → 9 → 5 | [apps/desktop/src/renderer/features/right-sidebar/plugins/terminal/lib/useTerminalFontSettings.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/plugins/terminal/lib/useTerminalFontSettings.ts#L7) |
| features | cindy-brain | 5 → 2 → 5 | [apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotCollaborationCard.tsx#L15) |
| features | components | 5 → 3 → 5 | [apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx#L1) |
| features | contexts | 5 → 4 → 5 | [apps/desktop/src/renderer/features/billing/BillingPage.tsx:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingPage.tsx#L32) |
| features | hooks | 5 → 6 → 5 | [apps/desktop/src/renderer/features/bots/BotChannelsPage.tsx:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotChannelsPage.tsx#L34) |
| features | i18n | 5 → 7 → 9 → 5 | [apps/desktop/src/renderer/features/cc-agent/lib/sessionDisplayTitle.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/lib/sessionDisplayTitle.ts#L23) |
| features | layout | 5 → 8 → 2 → 5 | [apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx:399](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/CCAgentSessionView.tsx#L399) |
| features | lib | 5 → 9 → 5 | [apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/billing/BillingCheckoutDialog.tsx#L10) |
| features | state | 5 → 10 → 5 | [apps/desktop/src/renderer/features/bots/BotGroupChatView.tsx:67](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotGroupChatView.tsx#L67) |
| features | themes | 5 → 11 → 9 → 5 | [apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx:61](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/NewMakerDraftRoute.tsx#L61) |
| features | voice-input | 5 → 12 → 3 → 5 | [apps/desktop/src/renderer/features/bots/BotGroupComposer.tsx:123](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/bots/BotGroupComposer.tsx#L123) |
| hooks | appearance | 6 → 1 → 9 → 6 | [apps/desktop/src/renderer/hooks/useReducedMotion.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useReducedMotion.ts#L13) |
| hooks | cindy-brain | 6 → 2 → 6 | [apps/desktop/src/renderer/hooks/useAttachments.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useAttachments.ts#L23) |
| hooks | components | 6 → 3 → 6 | [apps/desktop/src/renderer/hooks/useBrandLogo.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useBrandLogo.ts#L10) |
| hooks | contexts | 6 → 4 → 3 → 6 | [apps/desktop/src/renderer/hooks/remoteDeviceUsageMirror.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/remoteDeviceUsageMirror.ts#L6) |
| hooks | features | 6 → 5 → 6 | [apps/desktop/src/renderer/hooks/useCCSessions.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useCCSessions.ts#L34) |
| hooks | i18n | 6 → 7 → 9 → 6 | [apps/desktop/src/renderer/hooks/useCorruptionRestoredToast.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useCorruptionRestoredToast.ts#L17) |
| hooks | lib | 6 → 9 → 6 | [apps/desktop/src/renderer/hooks/codexAuthLogin.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/codexAuthLogin.ts#L2) |
| hooks | state | 6 → 10 → 6 | [apps/desktop/src/renderer/hooks/useCCSessions.ts:38](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useCCSessions.ts#L38) |
| hooks | themes | 6 → 11 → 9 → 6 | [apps/desktop/src/renderer/hooks/useTheme.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useTheme.ts#L10) |
| hooks | voice-input | 6 → 12 → 6 | [apps/desktop/src/renderer/hooks/useComposerSendShortcutPreference.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/hooks/useComposerSendShortcutPreference.ts#L5) |
| i18n | lib | 7 → 9 → 7 | [apps/desktop/src/renderer/i18n/index.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/i18n/index.ts#L26) |
| layout | cindy-brain | 8 → 2 → 3 → 8 | [apps/desktop/src/renderer/layout/LayoutRoot.tsx:24](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/layout/LayoutRoot.tsx#L24) |
| layout | lib | 8 → 9 → 3 → 8 | [apps/desktop/src/renderer/layout/PanelDragController.tsx:35](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/layout/PanelDragController.tsx#L35) |
| lib | cindy-brain | 9 → 2 → 9 | [apps/desktop/src/renderer/lib/editLastUserMessage.ts:42](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/editLastUserMessage.ts#L42) |
| lib | components | 9 → 3 → 9 | [apps/desktop/src/renderer/lib/agent-actions/workActivityProjection.ts:15](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/agent-actions/workActivityProjection.ts#L15) |
| lib | contexts | 9 → 4 → 9 | [apps/desktop/src/renderer/lib/cindyMakeCommand.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/cindyMakeCommand.ts#L6) |
| lib | features | 9 → 5 → 9 | [apps/desktop/src/renderer/lib/backgroundTaskStop.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/backgroundTaskStop.ts#L11) |
| lib | hooks | 9 → 6 → 9 | [apps/desktop/src/renderer/lib/checkForUpdateWithToast.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/checkForUpdateWithToast.ts#L1) |
| lib | i18n | 9 → 7 → 9 | [apps/desktop/src/renderer/lib/autoPermissionFallbackToast.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/autoPermissionFallbackToast.ts#L8) |
| lib | state | 9 → 10 → 9 | [apps/desktop/src/renderer/lib/errorDiagnosisPrompt.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/errorDiagnosisPrompt.ts#L16) |
| lib | voice-input | 9 → 12 → 9 | [apps/desktop/src/renderer/lib/appShortcutStore.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/lib/appShortcutStore.ts#L13) |
| state | components | 10 → 3 → 10 | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:21](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L21) |
| state | contexts | 10 → 4 → 10 | [apps/desktop/src/renderer/state/newMakerDraft.ts:26](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/newMakerDraft.ts#L26) |
| state | features | 10 → 5 → 10 | [apps/desktop/src/renderer/state/newMakerDraft.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/newMakerDraft.ts#L3) |
| state | hooks | 10 → 6 → 10 | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L22) |
| state | lib | 10 → 9 → 10 | [apps/desktop/src/renderer/state/agentDeviceModelMemory.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/state/agentDeviceModelMemory.ts#L23) |
| themes | lib | 11 → 9 → 2 → 11 | [apps/desktop/src/renderer/themes/local-themes.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/themes/local-themes.ts#L1) |
| voice-input | components | 12 → 3 → 12 | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L6) |
| voice-input | hooks | 12 → 6 → 12 | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L7) |
| voice-input | lib | 12 → 9 → 12 | [apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/voice-input/VoiceInputDictionaryToast.tsx#L5) |

## M06 · packages/maker-core/src · 4 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | agents |
| 2 | interfaces |
| 3 | memory |
| 4 | types |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| agents | interfaces | [packages/maker-core/src/agents/base-agent.ts:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/base-agent.ts#L45) | [packages/maker-core/src/interfaces/runtime-config.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/interfaces/runtime-config.ts#L10) |
| agents | memory | [packages/maker-core/src/agents/base-agent.ts:63](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/base-agent.ts#L63) | [packages/maker-core/src/memory/host-factory.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/memory/host-factory.ts#L16) |
| interfaces | types | [packages/maker-core/src/interfaces/auth-adapter.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/interfaces/auth-adapter.ts#L9) | [packages/maker-core/src/types/events.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/types/events.ts#L13) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| agents | interfaces | 1 → 2 → 1 | [packages/maker-core/src/agents/base-agent.ts:45](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/base-agent.ts#L45) |
| agents | memory | 1 → 3 → 1 | [packages/maker-core/src/agents/base-agent.ts:63](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/base-agent.ts#L63) |
| agents | types | 1 → 4 → 2 → 1 | [packages/maker-core/src/agents/base-agent.ts:25](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/base-agent.ts#L25) |
| interfaces | agents | 2 → 1 → 2 | [packages/maker-core/src/interfaces/runtime-config.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/interfaces/runtime-config.ts#L10) |
| interfaces | types | 2 → 4 → 2 | [packages/maker-core/src/interfaces/auth-adapter.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/interfaces/auth-adapter.ts#L9) |
| memory | agents | 3 → 1 → 3 | [packages/maker-core/src/memory/host-factory.ts:16](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/memory/host-factory.ts#L16) |
| memory | interfaces | 3 → 2 → 1 → 3 | [packages/maker-core/src/memory/flush-controller.ts:31](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/memory/flush-controller.ts#L31) |
| memory | types | 3 → 4 → 2 → 1 → 3 | [packages/maker-core/src/memory/host-factory.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/memory/host-factory.ts#L14) |
| types | interfaces | 4 → 2 → 4 | [packages/maker-core/src/types/events.ts:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/types/events.ts#L13) |

## M07 · packages/maker-core/src/agents · 4 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | claude-code |
| 2 | codex |
| 3 | pi |
| 4 | shared |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| claude-code | shared | [packages/maker-core/src/agents/claude-code/auto-review-policy.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/claude-code/auto-review-policy.ts#L17) | [packages/maker-core/src/agents/shared/customization-worker-api.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L3) |
| codex | shared | [packages/maker-core/src/agents/codex/capability-routing.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/codex/capability-routing.ts#L6) | [packages/maker-core/src/agents/shared/customization-worker-api.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L4) |
| pi | shared | [packages/maker-core/src/agents/pi/auto-review-policy.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/pi/auto-review-policy.ts#L23) | [packages/maker-core/src/agents/shared/customization-worker-api.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L5) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| claude-code | shared | 1 → 4 → 1 | [packages/maker-core/src/agents/claude-code/auto-review-policy.ts:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/claude-code/auto-review-policy.ts#L17) |
| codex | shared | 2 → 4 → 2 | [packages/maker-core/src/agents/codex/capability-routing.ts:6](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/codex/capability-routing.ts#L6) |
| pi | shared | 3 → 4 → 3 | [packages/maker-core/src/agents/pi/auto-review-policy.ts:23](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/pi/auto-review-policy.ts#L23) |
| shared | claude-code | 4 → 1 → 4 | [packages/maker-core/src/agents/shared/customization-worker-api.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L3) |
| shared | codex | 4 → 2 → 4 | [packages/maker-core/src/agents/shared/customization-worker-api.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L4) |
| shared | pi | 4 → 3 → 4 | [packages/maker-core/src/agents/shared/customization-worker-api.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/maker-core/src/agents/shared/customization-worker-api.ts#L5) |

## M08 · . · 3 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | apps |
| 2 | scripts |
| 3 | tools |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| apps | scripts | [apps/desktop/scripts/ci/lib.mjs:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/scripts/ci/lib.mjs#L17) | [scripts/dev-legacy-migration-demo.mts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/scripts/dev-legacy-migration-demo.mts#L22) |
| apps | tools | [apps/desktop/scripts/ensure-android-platform-tools.mjs:51](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/scripts/ensure-android-platform-tools.mjs#L51) | [tools/model-catalog/xai-sync.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/tools/model-catalog/xai-sync.ts#L8) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| apps | scripts | 1 → 2 → 1 | [apps/desktop/scripts/ci/lib.mjs:17](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/scripts/ci/lib.mjs#L17) |
| apps | tools | 1 → 3 → 1 | [apps/desktop/scripts/ensure-android-platform-tools.mjs:51](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/scripts/ensure-android-platform-tools.mjs#L51) |
| scripts | apps | 2 → 1 → 2 | [scripts/dev-legacy-migration-demo.mts:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/scripts/dev-legacy-migration-demo.mts#L22) |
| scripts | tools | 2 → 3 → 1 → 2 | [scripts/agent-binary-cdn-fallback.mjs:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/scripts/agent-binary-cdn-fallback.mjs#L27) |
| tools | apps | 3 → 1 → 3 | [tools/model-catalog/xai-sync.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/tools/model-catalog/xai-sync.ts#L8) |

## M09 · apps/desktop/src/renderer/features/skillhub · 3 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | components |
| 2 | hooks |
| 3 | lib |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| components | hooks | [apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx#L3) | [apps/desktop/src/renderer/features/skillhub/hooks/useMarketManagement.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/hooks/useMarketManagement.tsx#L7) |
| hooks | lib | [apps/desktop/src/renderer/features/skillhub/hooks/useMarketList.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/hooks/useMarketList.ts#L34) | [apps/desktop/src/renderer/features/skillhub/lib/detailButtons.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/lib/detailButtons.ts#L2) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| components | hooks | 1 → 2 → 1 | [apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx#L3) |
| components | lib | 1 → 3 → 2 → 1 | [apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/components/HomeMarketCard.tsx#L4) |
| hooks | components | 2 → 1 → 2 | [apps/desktop/src/renderer/features/skillhub/hooks/useMarketManagement.tsx:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/hooks/useMarketManagement.tsx#L7) |
| hooks | lib | 2 → 3 → 2 | [apps/desktop/src/renderer/features/skillhub/hooks/useMarketList.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/hooks/useMarketList.ts#L34) |
| lib | hooks | 3 → 2 → 3 | [apps/desktop/src/renderer/features/skillhub/lib/detailButtons.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/skillhub/lib/detailButtons.ts#L2) |

## M10 · apps/desktop/src/renderer/features/cc-agent · 3 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | hooks |
| 2 | lib |
| 3 | sidebar |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| hooks | lib | [apps/desktop/src/renderer/features/cc-agent/hooks/helpers/sidebarFilterCore.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/hooks/helpers/sidebarFilterCore.ts#L14) | [apps/desktop/src/renderer/features/cc-agent/lib/mainListModel.ts:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/lib/mainListModel.ts#L39) |
| hooks | sidebar | [apps/desktop/src/renderer/features/cc-agent/hooks/useSessionLifecycleActions.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/hooks/useSessionLifecycleActions.ts#L28) | [apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx#L27) |
| lib | sidebar | [apps/desktop/src/renderer/features/cc-agent/lib/appAttentionCount.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/lib/appAttentionCount.ts#L9) | [apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx#L22) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| hooks | lib | 1 → 2 → 1 | [apps/desktop/src/renderer/features/cc-agent/hooks/helpers/sidebarFilterCore.ts:14](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/hooks/helpers/sidebarFilterCore.ts#L14) |
| hooks | sidebar | 1 → 3 → 1 | [apps/desktop/src/renderer/features/cc-agent/hooks/useSessionLifecycleActions.ts:28](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/hooks/useSessionLifecycleActions.ts#L28) |
| lib | hooks | 2 → 1 → 2 | [apps/desktop/src/renderer/features/cc-agent/lib/mainListModel.ts:39](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/lib/mainListModel.ts#L39) |
| lib | sidebar | 2 → 3 → 2 | [apps/desktop/src/renderer/features/cc-agent/lib/appAttentionCount.ts:9](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/lib/appAttentionCount.ts#L9) |
| sidebar | hooks | 3 → 1 → 3 | [apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx#L27) |
| sidebar | lib | 3 → 2 → 3 | [apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx:22](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/sidebar/AutomationSessionGroupItem.tsx#L22) |

## M11 · apps/desktop/src/renderer/features/right-sidebar · 3 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | hooks |
| 2 | lib |
| 3 | plugins |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| lib | plugins | [apps/desktop/src/renderer/features/right-sidebar/lib/executeSidebarCommand.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/lib/executeSidebarCommand.ts#L11) | [apps/desktop/src/renderer/features/right-sidebar/plugins/mail-preview/index.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/plugins/mail-preview/index.tsx#L10) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| hooks | lib | 1 → 2 → 3 → 1 | [apps/desktop/src/renderer/features/right-sidebar/hooks/useBrowserWebview.ts:34](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/hooks/useBrowserWebview.ts#L34) |
| lib | plugins | 2 → 3 → 2 | [apps/desktop/src/renderer/features/right-sidebar/lib/executeSidebarCommand.ts:11](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/lib/executeSidebarCommand.ts#L11) |
| plugins | hooks | 3 → 1 → 2 → 3 | [apps/desktop/src/renderer/features/right-sidebar/plugins/web-browser/BrowserTabBody.tsx:51](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/plugins/web-browser/BrowserTabBody.tsx#L51) |
| plugins | lib | 3 → 2 → 3 | [apps/desktop/src/renderer/features/right-sidebar/plugins/mail-preview/index.tsx:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/right-sidebar/plugins/mail-preview/index.tsx#L10) |

## M12 · apps/desktop/src/main · 3 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | input-devices |
| 2 | worklouder-codex |
| 3 | xbox-gamepad |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| input-devices | worklouder-codex | [apps/desktop/src/main/input-devices/index.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-devices/index.ts#L1) | [apps/desktop/src/main/worklouder-codex/WindowsMicroHost.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worklouder-codex/WindowsMicroHost.ts#L3) |
| input-devices | xbox-gamepad | [apps/desktop/src/main/input-devices/index.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-devices/index.ts#L2) | [apps/desktop/src/main/xbox-gamepad/host.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/xbox-gamepad/host.ts#L8) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| input-devices | worklouder-codex | 1 → 2 → 1 | [apps/desktop/src/main/input-devices/index.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-devices/index.ts#L1) |
| input-devices | xbox-gamepad | 1 → 3 → 1 | [apps/desktop/src/main/input-devices/index.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/input-devices/index.ts#L2) |
| worklouder-codex | input-devices | 2 → 1 → 2 | [apps/desktop/src/main/worklouder-codex/WindowsMicroHost.ts:3](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/worklouder-codex/WindowsMicroHost.ts#L3) |
| xbox-gamepad | input-devices | 3 → 1 → 3 | [apps/desktop/src/main/xbox-gamepad/host.ts:8](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/xbox-gamepad/host.ts#L8) |
| xbox-gamepad | worklouder-codex | 3 → 2 → 1 → 3 | [apps/desktop/src/main/xbox-gamepad/index.ts:30](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/xbox-gamepad/index.ts#L30) |

## M13 · packages/browser-control-runtime/src · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | _generated |
| 2 | shim |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| _generated | shim | [packages/browser-control-runtime/src/_generated/extension/src/browser/bridge-auth-registry.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/browser-control-runtime/src/_generated/extension/src/browser/bridge-auth-registry.ts#L10) | [packages/browser-control-runtime/src/shim/browser-action-targets.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/browser-control-runtime/src/shim/browser-action-targets.ts#L1) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| _generated | shim | 1 → 2 → 1 | [packages/browser-control-runtime/src/_generated/extension/src/browser/bridge-auth-registry.ts:10](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/browser-control-runtime/src/_generated/extension/src/browser/bridge-auth-registry.ts#L10) |
| shim | _generated | 2 → 1 → 2 | [packages/browser-control-runtime/src/shim/browser-action-targets.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/browser-control-runtime/src/shim/browser-action-targets.ts#L1) |

## M14 · apps/desktop/src/main/localDb · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | client |
| 2 | worker |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| client | worker | [apps/desktop/src/main/localDb/client/DbClient.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/client/DbClient.ts#L12) | [apps/desktop/src/main/localDb/worker/dbWorker.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/worker/dbWorker.ts#L5) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| client | worker | 1 → 2 → 1 | [apps/desktop/src/main/localDb/client/DbClient.ts:12](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/client/DbClient.ts#L12) |
| worker | client | 2 → 1 → 2 | [apps/desktop/src/main/localDb/worker/dbWorker.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/localDb/worker/dbWorker.ts#L5) |

## M15 · apps/desktop/src/renderer/features · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | first-run-guide |
| 2 | setup-migration |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| first-run-guide | setup-migration | [apps/desktop/src/renderer/features/first-run-guide/FirstRunGuide.tsx:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/first-run-guide/FirstRunGuide.tsx#L52) | [apps/desktop/src/renderer/features/setup-migration/SetupMigrationHost.tsx:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/setup-migration/SetupMigrationHost.tsx#L13) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| first-run-guide | setup-migration | 1 → 2 → 1 | [apps/desktop/src/renderer/features/first-run-guide/FirstRunGuide.tsx:52](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/first-run-guide/FirstRunGuide.tsx#L52) |
| setup-migration | first-run-guide | 2 → 1 → 2 | [apps/desktop/src/renderer/features/setup-migration/SetupMigrationHost.tsx:13](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/setup-migration/SetupMigrationHost.tsx#L13) |

## M16 · apps/desktop/src/renderer/features/cc-agent/workdir-browse · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | hooks |
| 2 | lib |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| hooks | lib | [apps/desktop/src/renderer/features/cc-agent/workdir-browse/hooks/useConfirmSwitchAwayIfDirty.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/workdir-browse/hooks/useConfirmSwitchAwayIfDirty.ts#L27) | [apps/desktop/src/renderer/features/cc-agent/workdir-browse/lib/fileContentCache.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/workdir-browse/lib/fileContentCache.ts#L19) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| hooks | lib | 1 → 2 → 1 | [apps/desktop/src/renderer/features/cc-agent/workdir-browse/hooks/useConfirmSwitchAwayIfDirty.ts:27](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/workdir-browse/hooks/useConfirmSwitchAwayIfDirty.ts#L27) |
| lib | hooks | 2 → 1 → 2 | [apps/desktop/src/renderer/features/cc-agent/workdir-browse/lib/fileContentCache.ts:19](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/cc-agent/workdir-browse/lib/fileContentCache.ts#L19) |

## M17 · apps/desktop/src/renderer/features/scheduler · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | hooks |
| 2 | lib |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| hooks | lib | [apps/desktop/src/renderer/features/scheduler/hooks/useReadFailedScheduleRuns.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/hooks/useReadFailedScheduleRuns.ts#L4) | [apps/desktop/src/renderer/features/scheduler/lib/projectAutomationConfig.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/lib/projectAutomationConfig.ts#L5) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| hooks | lib | 1 → 2 → 1 | [apps/desktop/src/renderer/features/scheduler/hooks/useReadFailedScheduleRuns.ts:4](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/hooks/useReadFailedScheduleRuns.ts#L4) |
| lib | hooks | 2 → 1 → 2 | [apps/desktop/src/renderer/features/scheduler/lib/projectAutomationConfig.ts:5](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/renderer/features/scheduler/lib/projectAutomationConfig.ts#L5) |

## M18 · packages/lizi-mcps/src/lsp · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | launcher |
| 2 | server |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| launcher | server | [packages/lizi-mcps/src/lsp/launcher/base.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/lizi-mcps/src/lsp/launcher/base.ts#L2) | [packages/lizi-mcps/src/lsp/server/lsp-server-pool.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/lizi-mcps/src/lsp/server/lsp-server-pool.ts#L7) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| launcher | server | 1 → 2 → 1 | [packages/lizi-mcps/src/lsp/launcher/base.ts:2](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/lizi-mcps/src/lsp/launcher/base.ts#L2) |
| server | launcher | 2 → 1 → 2 | [packages/lizi-mcps/src/lsp/server/lsp-server-pool.ts:7](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/packages/lizi-mcps/src/lsp/server/lsp-server-pool.ts#L7) |

## M19 · apps/desktop/src/main/im · 2 个成员

| 编号 | 成员路径 |
|---:|---|
| 1 | shared |
| 2 | wechat |

### 直接互引

| A | B | A → B | B → A |
|---|---|---|---|
| shared | wechat | [apps/desktop/src/main/im/shared/botImConnectionRuntime.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/botImConnectionRuntime.ts#L32) | [apps/desktop/src/main/im/wechat/WechatIM.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/wechat/WechatIM.ts#L1) |

### 全部参与循环的有向依赖

闭合路径使用本组成员编号。

| 引用方 | 被引用方 | 闭合路径 | 源码位置 |
|---|---|---|---|
| shared | wechat | 1 → 2 → 1 | [apps/desktop/src/main/im/shared/botImConnectionRuntime.ts:32](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/shared/botImConnectionRuntime.ts#L32) |
| wechat | shared | 2 → 1 → 2 | [apps/desktop/src/main/im/wechat/WechatIM.ts:1](https://github.com/makecindy/cindy/blob/3b8fc9babbb8ecb0a0cf8ee9fdfd01ff8ea11469/apps/desktop/src/main/im/wechat/WechatIM.ts#L1) |
