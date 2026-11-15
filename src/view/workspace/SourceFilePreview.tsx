/**
 * 作用定位：模块源码的只读文本预览，服务端决定范围与字节上限。
 * 设计原因：正文作为文本渲染，不执行 HTML；切换文件、知识版本或实例使旧响应失效，无自动重试或写入。
 */
import {useEffect,useState} from 'react';
import type {SourceTarget,SourceFile} from '../../bridge/contracts/ipc-workspace';
export function SourceFilePreview({target}:{target:SourceTarget}){
 const key=JSON.stringify(target),[attempt,setAttempt]=useState(0),[state,setState]=useState<{key:string;value?:SourceFile;error?:string}>();
 useEffect(()=>{let active=true;setState({key});void window.cbim.call('source.read',target).then(value=>{if(active)setState({key,value})},cause=>{if(active)setState({key,error:cause instanceof Error?cause.message:String(cause)})});return()=>{active=false}},[key,attempt]);
 const current=state?.key===key?state:undefined;
 return <section className="source-file-preview" aria-label="源文件预览"><header><h2>{target.path?.split('/').at(-1)}</h2><button onClick={()=>setAttempt(value=>value+1)}>刷新文件</button></header><code>{target.source}/{target.path}</code><p>只读预览 · 当前磁盘内容</p>
  {current?.error?<p role="alert">{current.error}<button onClick={()=>setAttempt(value=>value+1)}>重试读取</button></p>:!current?.value?<p role="status">正在读取源文件…</p>:current.value.kind==='unsupported'?<p>{current.value.reason}（{current.value.bytes} 字节）</p>:<pre>{current.value.text}</pre>}
 </section>;
}
