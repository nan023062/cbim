/**
 * 作用定位：Pi 引擎产品的静态身份、图标和协议元数据。
 * 设计原因：发现阶段只读产品描述，避免产品列表传递加载 Pi SDK。
 */
export const manifest = { logo: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAA7klEQVR4nO2awQ6CMBBEh4n/iHLTD8NbV79SYyKJYikIje20vnMhb3d2QwgA4jRzBw7Hyw0JsfM+6NjkKr60ECrIh5yoIB9yo4r8lCOV5H2u3h1QgmrdHxicy0hAGUIcQhxCnN3Sg65v8Wu607X8BAhxiFp2oAvM43g/5mb32/NFJ8CtN4jZzTX8E0gNIQ4hDiEOIQ4hDiEOUXMBLvFT+EHdCcTC9e3qN74kBcQcNaKWF5rYnRxf65RGKGYzCHEIcYgSCrCZT5k5Yk/nMhJQS8FeXN8SUCjCRo4fI5RzEeZx8+5AjkXYhJP8zx5Q5w7XdE8q7g8aNwAAAABJRU5ErkJggg==', id: 'pi', storageDirectory: 'pi', nativeHistoryFormat: 'pi', label: 'Pi', businessTypes: ['通用任务', '代码开发'], supportedApis: ['openai-completions', 'openai-responses', 'anthropic-messages'] } as const;
