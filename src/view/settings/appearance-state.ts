/**
 * 作用定位：View 层的本机外观偏好、旧主题迁移与存储边界，不含账号或模型配置。
 * 设计原因：偏好校验与 React 生命周期分离；损坏值逐项回退，存储失败明确保留为本窗口效果。
 */
export type ThemePreference = 'dark' | 'light' | 'system';

export interface AppearancePreferences
{
  theme: ThemePreference;

  /** 全局普通界面文字字号，单位 px；覆盖对话、控件、状态与说明，代码独立。 */
  textSize: 13 | 15 | 17;

  /** 代码字号，单位 px；代码块、行内代码及等宽日志共用。 */
  codeSize: 12 | 14 | 16;

  /** 额外减少动画；关闭后仍尊重系统的减少动态效果偏好。 */
  reduceMotion: boolean;
}

/** 直接接受 localStorage；保留浏览器标准方法名，测试替身遵循同一契约。 */
export interface PreferenceStorage
{
  getItem(key: string): string | null;

  setItem(key: string, value: string): void
}

export const appearanceKey = 'cbim.appearance.v1';

export const defaultAppearance: Readonly<AppearancePreferences> = { theme: 'dark', textSize: 15, codeSize: 14, reduceMotion: false };

/** 无新记录时继承旧 cbim.theme；只读取本功能的键，未知字段与无效值不进入视图。 */
export function readAppearance(storage: PreferenceStorage): { value: AppearancePreferences; error: string }
{
  try
  {
    const raw = storage.getItem(appearanceKey);

    const parsed: unknown = raw === null ? { theme: storage.getItem('cbim.theme') } : JSON.parse(raw);

    const value = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};

    return {
      value: {
        theme: ['dark', 'light', 'system'].includes(String(value.theme)) ? value.theme as ThemePreference : defaultAppearance.theme,

        textSize: [13, 15, 17].includes(value.textSize as number) ? value.textSize as AppearancePreferences['textSize'] : defaultAppearance.textSize,

        codeSize: [12, 14, 16].includes(value.codeSize as number) ? value.codeSize as AppearancePreferences['codeSize'] : defaultAppearance.codeSize,

        reduceMotion: value.reduceMotion === true,
      }, error: ''
    };
  }
  catch
  {
    return { value: { ...defaultAppearance }, error: '外观偏好暂时无法读取，已使用默认显示。可重新选择并保存。' }
  }
}

/** 单键提交全部外观偏好，不写入模型凭据或覆盖其它本机设置；失败不伪装成已保存。 */
export function saveAppearance(storage: PreferenceStorage, value: AppearancePreferences): string
{
  try
  {
    storage.setItem(appearanceKey, JSON.stringify(value));

    return ''
  }
  catch
  {
    return '外观偏好未能保存，本次修改仅在当前窗口生效。请检查本机存储后重试。'
  }
}

/** 跟随系统只计算实际配色，不改写用户选择。 */
export function resolveTheme(theme: ThemePreference, systemDark: boolean): 'dark' | 'light'
{
  return theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
}
