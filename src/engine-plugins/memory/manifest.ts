/**
 * 作用定位：Memory 引擎产品的静态身份、图标和协议元数据。
 * 设计原因：发现阶段只读产品描述，记忆引擎的模型和运行资源在实际启动时装配。
 */
export const manifest = { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAABKUlEQVR4nO2aYRKCIBBGgeGCdYL2BHmUOoF7gjxijTPRmK0QIMrn8P1qmqD3XNnQVAo8OvSBy+n2VDuGh87LqGsF/1fEIMD7mAwCvI/NoMAvMRokeIlVXANIMWhH38UxH6MCyLElJ+8f189rOt9xBPoJ+Py9tUVsafDSInYL6NA4ypCxW4P75qIEEbsn+Boi0QJu8hIitEUFSojQHmtA+vIYmWq6UGxVqvsd6GewI6Ak4qsUZUjp1N1o6HSRoFLGhK6TowViF+0IlTKmmIBLDW2Uh063NkqtjealtdGltDb6R1obHdN2o5lpu1Epod0ozI0tKgR9qFuLRoHHqCMIcOCvzBrDb+ZjVACtCjxh/aoAggTPGH9OoZolWGAT10CNErzABP+wh0LPC8buyeA88g7hAAAAAElFTkSuQmCC', id: 'memory', storageDirectory: 'memory', nativeHistoryFormat: 'cbim', label: '记忆引擎', businessTypes: ['知识库管理', '语义检索', '摘要与压缩'], supportedApis: ['openai-completions'], additionalModelRoles: [{ id: 'embedding', label: '记忆向量模型', kind: 'embedding', required: true }] } as const;
