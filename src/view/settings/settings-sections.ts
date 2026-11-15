/**
 * 作用定位：设置中心的静态导航、分组与搜索词；仅描述已有设置入口。
 * 设计原因：页面导航与业务表单分离，搜索不读取凭据、不触发配置提交，也不生成用户插件入口。
 */
export const settingsSections=[
  {id:'models',label:'大模型',group:'AI 能力',icon:'sparkles',description:'管理供应商、连接方式与生成 / 向量模型。',keywords:'供应商 API Key 密钥 连接 默认 模型 价格 token 上下文 embedding 向量'},
  {id:'engines',label:'引擎',group:'AI 能力',icon:'plug',description:'了解业务专长和可用模型，管理官方引擎包。',keywords:'Pi Claude Code Codex 记忆 安装 更新 移除 停用 启用 能力'},
  {id:'accounts',label:'账号与连接',group:'偏好',icon:'team',description:'查看本地使用状态，管理反馈服务的账号连接。',keywords:'账户 登录 GitHub OAuth 反馈 绑定 退出 断开'},
  {id:'appearance',label:'主题与个性化',group:'偏好',icon:'sun',description:'选择显示模式、阅读字号和动态效果。',keywords:'外观 浅色 深色 系统 字体 字号 代码 动画 阅读 主题'},
  {id:'runtime',label:'任务运行',group:'工作方式',icon:'flow',description:'设置全局并发，查看名额占用与等待数量。',keywords:'Agent 并发 排队 执行 上限 工作区'},
  {id:'budget',label:'用量与预算',group:'工作方式',icon:'clock',description:'设置新目标的用量额度与请求预留方式。',keywords:'token 美元 USD 费用 限额 消耗 用量 预算'},
  {id:'web',label:'网页与搜索',group:'工具与数据',icon:'search',description:'管理网页读取策略与 Brave 搜索服务。',keywords:'浏览器 robots 抓取 互联网 网络 搜索 key'},
  {id:'resources',label:'资源仓库',group:'工具与数据',icon:'folder',description:'选择本地资源目录，管理这台电脑的仓库共享。',keywords:'存储 数据 目录 文件 路径 局域网 共享 端口 链接器 人才 模板'},
  {id:'about',label:'关于与更新',group:'应用',icon:'settings',description:'查看当前版本、更新日志与桌面更新状态。',keywords:'CBIM 版本 升级 安装 更新 日志 关于'},
] as const;
export type SettingsSectionId=typeof settingsSections[number]['id'];
/** 多关键词都须命中同一设置项；结果仅供导航，不把搜索当成自动选择或执行命令。 */
export function findSettingsSections(query:string){const words=query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);return settingsSections.filter(item=>words.every(word=>(item.label+' '+item.description+' '+item.keywords).toLocaleLowerCase().includes(word)))}
