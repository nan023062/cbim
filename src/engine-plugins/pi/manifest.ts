export const manifest = {
  id: 'pi',
  storageDirectory: 'pi',
  nativeHistoryFormat: 'pi',
  label: 'Pi',
  businessTypes: ['通用任务', '代码开发'],
  supportedApis: ['openai-completions', 'openai-responses', 'anthropic-messages']
} as const;
