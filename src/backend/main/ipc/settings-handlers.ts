/**
 * 作用定位：模型、准入、预算与反馈账号设置的主进程处理器。
 * 设计原因：设置仅改变配置或未来周期默认值，不向页面暴露运行许可或保存凭据。请求已在总分派中解析。
 */
import type {ApplicationServices} from './services';
import type {IpcHandlers} from '../../../bridge/contracts/ipc-call';
import type {SettingsIpcResponses} from '../../../bridge/contracts/ipc-settings';

/** 仅装配本业务组；每项实际实现都受对应请求／响应约束。 */
export function settingsIpcHandlers(app:ApplicationServices):IpcHandlers<keyof SettingsIpcResponses>{
  return {
    'agent.mainSettings':args=>app.mainAgentSettings.read(args),
    'agent.configureMain':args=>app.mainAgentSettings.configure(args),
    'runtime.snapshot':async args=>{return app.runtime.snapshot();},
    'runtime.read':async args=>{return app.runtime.read(args?.cursor);},
    'admission.read':async args=>{return app.admission.read(args?.cursor);},
    'admission.settings':async args=>{return app.admissionSettings.read();},
    'admission.configure':async args=>{
return app.admissionSettings.configure(args);},
    'budget.settings':async args=>{return app.budgetSettings.read();},
    'budget.configure':async args=>{
return app.budgetSettings.configure(args);},
    'models.list':async args=>{return app.models.list();},
    'github.feedback.status':async args=>{return app.githubFeedback.auth.status();},
    'github.feedback.begin':async args=>{
return app.githubFeedback.auth.begin(args);},
    'github.feedback.poll':async args=>{return app.githubFeedback.auth.poll(args);},
    'github.feedback.cancel':async args=>{return app.githubFeedback.auth.cancel();},
    'github.feedback.disconnect':async args=>{return app.githubFeedback.auth.disconnect();},
    'models.save':async args=>{return app.models.save(args);},
    'models.select':async args=>{return app.models.select(args.id);},
    'models.remove':async args=>{return app.models.remove(args.id);},
    'models.test':async args=>{return app.models.test(args.id,args.modelId);},
    'models.discover':async args=>{return app.models.discover(args);},
    'models.discoverDetails':async args=>{return app.models.discoverDetails(args);},
  };
}
