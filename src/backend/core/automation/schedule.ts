/**
 * 作用定位：计算下一个自动化触发时刻，不触发执行或读写时钟。
 * 设计原因：间隔从指定基点计算，每日按保存的 IANA 时区处理夏令时；过期一次任务不补跑。所有传输时刻是 UTC ISO 字符串。
 */
import type {AutomationSchedule} from './contracts';
/** previous 是上一自动触发时刻；每日重复的夏令时时刻同一天只取一次。 */
export function nextAutomationAt(schedule:AutomationSchedule,after:number,previous?:number):string|undefined{
 if(schedule.kind==='manual')return;
 if(schedule.kind==='interval')return new Date(after+schedule.minutes*60000).toISOString();
 if(schedule.kind==='once')return Date.parse(schedule.at)>after?schedule.at:undefined;
 const format=new Intl.DateTimeFormat('en-CA',{timeZone:schedule.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 const local=(at:number)=>{const parts=Object.fromEntries(format.formatToParts(at).map(part=>[part.type,part.value]));return {day:parts.year+'-'+parts.month+'-'+parts.day,time:parts.hour+':'+parts.minute}};
 const prior=previous===undefined?undefined:local(previous).day;
 // 某地夏令时可能跳过整个目标时刻；查三天只选真实存在的下一分钟。
 for(let candidate=Math.floor(after/60000)*60000+60000;candidate<=after+3*86400000;candidate+=60000){const value=local(candidate);if(value.time===schedule.time&&value.day!==prior)return new Date(candidate).toISOString()}
 return;
}
