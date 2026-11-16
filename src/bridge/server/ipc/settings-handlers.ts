/**
 * 网页设置管理浏览器 robots 策略、Brave 开关和加密密钥摘要，不向页面提供任意抓取代理。
 * 作用定位：模型、准入、预算与反馈账号设置的主进程处理器。
 * 设计原因：设置仅改变配置或未来周期默认值，不向页面暴露运行许可或保存凭据。请求已在总分派中解析。
 * 模型测试将显式引擎交给配置服务，使用与实际运行相同的兼容接口解析。
 */
import type { ApplicationServices } from './services';

import type { IpcHandlers } from '../../contracts/ipc-call';

import type { SettingsIpcResponses } from '../../contracts/ipc-settings';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function settingsIpcHandlers(app: ApplicationServices): IpcHandlers<keyof SettingsIpcResponses>
{
  const packages = () => { if (!app.enginePackages) throw Error('源码开发模式不管理正式引擎包'); return app.enginePackages };

  return {
    'engines.settings': () => app.enginePackages?.Read() ?? { managed: false, revision: 0, items: [] },

    'engines.check': async () => { await packages().Check(); return packages().Read() },

    'engines.install': async args => { await packages().Install(args.kind, { revision: args.revision, identity: args.identity }); return packages().Read() },

    'engines.configure': async args => { await packages().SetEnabled(args.kind, args.action === 'enable', args.action === 'remove', args.revision); return packages().Read() },

    'web.settings': () => app.webSettings.Read(),

    'web.configure': args => app.webSettings.Configure(args),

    'agent.mainSettings': args => app.mainAgentSettings.Read(args),

    'agent.configureMain': args => app.mainAgentSettings.Configure(args),

    'runtime.snapshot': async args => { return app.runtime.Snapshot(); },

    'runtime.read': async args => { return app.runtime.Read(args?.cursor); },

    'admission.read': async args => { return app.admission.Read(args?.cursor); },

    'admission.settings': async args => { return app.admissionSettings.Read(); },

    'admission.configure': async args => { return app.admissionSettings.Configure(args); },

    'budget.settings': async args => { return app.budgetSettings.Read(); },

    'budget.configure': async args => { return app.budgetSettings.Configure(args); },

    'models.list': async args => { return app.models.List(); },

    'github.feedback.status': async args => { return app.githubFeedback.auth.Status(); },

    'github.feedback.begin': async args => { return app.githubFeedback.auth.Begin(args); },

    'github.feedback.poll': async args => { return app.githubFeedback.auth.Poll(args); },

    'github.feedback.cancel': async args => { return app.githubFeedback.auth.Cancel(); },

    'github.feedback.disconnect': async args => { return app.githubFeedback.auth.Disconnect(); },

    'models.save': async args => { return app.models.Save(args); },

    'models.select': async args => { return app.models.Select(args.id); },

    'models.remove': async args => { return app.models.Remove(args.id); },

    'models.test': async args => { return app.engineModels.Test(args.id, args.modelId, args.engine); },

    'models.testConnection': args => args.kind === 'embedding' ? app.models.TestEmbedding(args.id, args.modelId) : app.models.Test(args.id, args.modelId, { supportedApis: [args.api], fallbackApi: args.api }),

    'models.discover': async args => { return app.models.Discover(args); },

    'models.discoverDetails': async args => { return app.models.DiscoverDetails(args); },
  };
}
