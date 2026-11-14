/**
 * 作用定位：嵌入当前对话、办公室或成员审阅标题行右侧的单一视图切换按钮；图标表达当前视图，文字提示目标视图。
 * 设计原因：聊天、成员审阅和办公室共用父级状态，按钮本身不创建工具栏，仅发出查看切换，不卸载会话或触发执行。
 */
import {Icon} from '../components/Icon';
/** review 只改变成员的返回提示；office 状态由所属会话保存。 */
export function InteractionModeToggle({office,review,onToggle}:{office:boolean;review:boolean;onToggle:()=>void}){
 const label=office?(review?'切换到工作审阅':'切换到对话'):'切换到办公室';
 return <button className="interaction-mode-toggle" type="button" data-testid="interaction-mode-toggle" aria-label={label} title={label} aria-pressed={office} onClick={onToggle}><Icon name={office?'team':'chat'} size={18}/></button>;
}
