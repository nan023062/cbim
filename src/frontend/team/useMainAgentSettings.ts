/**
 * 作用定位：对话栏与主 Agent 配置页共用的配置读取、保存和同步 Hook。
 * 设计原因：后端持有唯一配置，界面不再按会话保存引擎/模型；轮询只同步已保存值，保存期间及工作区切换后的迟到读取不得覆盖新值。
 */
import {useEffect,useRef,useState} from 'react';
import {mainAgentSettingsSchema,type MainAgentSettingsView,type AgentModelSelection} from '../../bridge/contracts/models';

export function useMainAgentSettings(workspaceId:string,instanceId?:string,active=true){
  const [value,setValue]=useState<MainAgentSettingsView>(),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const generation=useRef(0),saving=useRef(false),current=useRef(value);current.current=value;
  useEffect(()=>{
    const ticket=++generation.current;setValue(undefined);setError('');setBusy(false);
    if(!instanceId||!active)return;
    const identity={workspaceId,instanceId};
    let timer:ReturnType<typeof setTimeout>,cancelled=false;
    async function poll(){
      try{
        if(saving.current)return;
        const result=mainAgentSettingsSchema.parse(await window.cbim.call('agent.mainSettings',identity));
        if(result.workspaceId!==workspaceId||result.instanceId!==instanceId)throw Error('主 Agent 配置属于其他工作区实例');
        if(!cancelled&&generation.current===ticket&&!saving.current){setValue(old=>old&&old.revision>=result.revision?old:result);setError('')}
      }catch(cause){if(!cancelled&&generation.current===ticket)setError(cause instanceof Error?cause.message:String(cause))}
      finally{if(!cancelled)timer=setTimeout(()=>void poll(),1000)}
    }
    void poll();return()=>{cancelled=true;clearTimeout(timer);generation.current++};
  },[workspaceId,instanceId,active]);
  /** 以当前已读版本保存，冲突或未知结果保留错误，由下一次读取核实，绝不自动重放。 */
  async function save(selection:AgentModelSelection|null,expectedRevision?:number){
    const base=current.current;if(!base||saving.current)return false;
    const ticket=generation.current;saving.current=true;setBusy(true);setError('');
    try{
      const result=mainAgentSettingsSchema.parse(await window.cbim.call('agent.configureMain',{...base,revision:expectedRevision??base.revision,selection}));
      if(result.workspaceId!==workspaceId||result.instanceId!==instanceId)throw Error('主 Agent 配置保存回执身份不一致');
      if(generation.current===ticket){current.current=result;setValue(result)}
      return true;
    }catch(cause){if(generation.current===ticket)setError(cause instanceof Error?cause.message:String(cause));return false}
    finally{saving.current=false;if(generation.current===ticket)setBusy(false)}
  }
  return {value:value?.workspaceId===workspaceId&&value.instanceId===instanceId?value:undefined,error,busy,save};
}
