/**
 * 作用定位：供应商草稿中的向量接口及模型编辑，独立输入容量、向量维度和输入计价。
 * 设计原因：向量模型不能伪装成生成模型或填输出上限；父级保存凭据和整个供应商，组件不发模型请求。
 */
import {useState} from 'react';
import type {EmbeddingConnection,EmbeddingModel} from '../../bridge/contracts/models';
export function EmbeddingModels({value,onChange}:{value?:EmbeddingConnection;onChange:(value:EmbeddingConnection|undefined)=>void}){
  const [id,setId]=useState('');
  const update=(index:number,patch:Partial<EmbeddingModel>)=>onChange({...value!,models:value!.models.map((model,i)=>i===index?{...model,...patch}:model)});
  return <section aria-label="向量模型"><h3>向量模型</h3><p>用于语义检索与记忆索引。与生成模型共用供应商凭据，接口地址需要单独确认。</p>
    <label><input type="checkbox" checked={!!value} onChange={event=>onChange(event.target.checked?{api:'openai-embeddings',baseUrl:'',models:[]}:undefined)}/>配置向量模型接口</label>
    {value&&<><label>向量接口根地址<input required type="url" aria-label="向量接口根地址" placeholder="https://api.example.com/v1" value={value.baseUrl} onChange={event=>onChange({...value,baseUrl:event.target.value})}/></label><p>使用 OpenAI Embeddings 兼容接口；地址不包含 /embeddings。首次添加或更换地址需要重新输入 Key。</p>
      <div className="model-actions"><input aria-label="向量模型 ID" value={id} onChange={event=>setId(event.target.value)} maxLength={160}/><button type="button" disabled={!id.trim()||value.models.some(model=>model.id===id.trim())} onClick={()=>{onChange({...value,models:[...value.models,{id:id.trim(),name:id.trim(),enabled:true,inputTokens:0,dimensions:0}]});setId('')}}>添加向量模型</button></div>
      {value.models.map((model,index)=><div className="model-row" key={model.id}><b>{model.id}</b><div className="model-grid"><label>显示名称<input value={model.name} maxLength={160} onChange={event=>update(index,{name:event.target.value})}/></label><label>最大输入 token<input required type="number" min={1} max={2000000} value={model.inputTokens||''} onChange={event=>update(index,{inputTokens:Number(event.target.value)})}/></label><label>向量维度<input required type="number" min={1} max={65536} value={model.dimensions||''} onChange={event=>update(index,{dimensions:Number(event.target.value)})}/></label><label>输入价格（USD / 百万 token）<input type="number" min={0} step="any" placeholder="未知" value={model.inputPrice??''} onChange={event=>update(index,{inputPrice:event.target.value===''?undefined:Number(event.target.value)})}/></label></div><label><input type="checkbox" checked={model.enabled} onChange={event=>update(index,{enabled:event.target.checked})}/>启用向量模型</label><button type="button" onClick={()=>onChange({...value,models:value.models.filter((_,i)=>i!==index)})}>移除向量模型 {model.id}</button></div>)}
      <p>容量与维度填写供应商的真实值；未知价格留空，免费填写 0。</p></>}
  </section>;
}
