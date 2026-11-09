/**
 * 作用定位：将公开运行事件投影为输入框左上角的大脑状态。
 * 设计原因：忽略计量遥测，只使用生命周期和工具事件；仓库资料读取与业务文件读取分别显示，不读取或展示私有推理正文。
 */
import type {RunSummary} from '../../bridge/contracts/execution';
export function brainStatus(run?:RunSummary,waiting=false){
 if(!run)return '';if(run.status!=='running')return {completed:'本轮已结束',cancelled:'已停止',failed:'执行失败',interrupted:'执行中断'}[run.status];
 if(waiting)return '等待确认…';
 for(const event of [...run.events].reverse()){
  if(event.type==='engine.status'&&event.data.metric==='activity')return String(event.data.label);
  if(event.type==='engine.status'&&!event.data.metric&&!String(event.data.label).includes('配置'))return String(event.data.label);
  if(event.type==='tool.started'||event.type==='tool.updated')return ({write:'正在写文件…',edit:'正在修改文件…',bash:'正在执行命令…',read:'正在读取文件…',ls:'正在查看目录…',find:'正在查找文件…',grep:'正在搜索…',cbim_repository_list:'正在查询仓库资源…',cbim_repository_get:'正在读取仓库资料…',cbim_ask_user_question:'等待你的回答…'} as Record<string,string>)[String(event.data.name)]||'正在调用工具…';
  if(event.type==='tool.finished'||event.type==='tool.denied')return '正在思考…';
  if(event.type==='message.delta')return '正在生成…';
 }
 return '正在准备…';
}
