/**
 * 作用定位：将 Agent 消息渲染成排版后的正文、列表、表格与可复制代码块。
 * 设计原因：沿用 Cindy 的 react-markdown/GFM/高亮流水线及流式语法修复；
 * CBIM 通过受控 IPC 打开链接，不执行模型返回的 HTML 或脚本。
 * 更新边界：原文、流式标记或工作区身份变化才重排正文；组件自身复制与链接错误状态仍可独立更新。
 * 来源：Cindy MarkdownRenderer.tsx（Apache-2.0），仅移植渲染核心；许可见 legal。
 */
import {Children,isValidElement,memo,useState,type ReactNode} from 'react';
import ReactMarkdown,{defaultUrlTransform} from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import {repairStreamingMarkdown} from './repairStreamingMarkdown';

function plainText(value:ReactNode):string{return Children.toArray(value).map(v=>typeof v==='string'||typeof v==='number'?String(v):isValidElement<{children?:ReactNode}>(v)?plainText(v.props.children):'').join('')}
/** 复制原代码而非高亮后的 HTML；复制失败在按钮旁显示，不假报成功。 */
function CodeBlock({children}:{children?:ReactNode}){
  const [status,setStatus]=useState('');const child=Children.toArray(children)[0];
  const language=isValidElement<{className?:string}>(child)?child.props.className?.match(/language-([^ ]+)/)?.[1]:undefined;
  return <div className="chat-code-block"><div className="chat-code-header"><span>{language||'代码'}</span><button onClick={()=>void navigator.clipboard.writeText(plainText(children)).then(()=>setStatus('已复制')).catch(()=>setStatus('复制失败'))}>{status||'复制代码'}</button></div><pre>{children}</pre></div>;
}
/** 流式修复仅影响显示；持久化记录和复制消息始终保留原文。 */
export const MarkdownMessage=memo(function MarkdownMessage({text,streaming=false,workspaceId}:{text:string;streaming?:boolean;workspaceId:string}){
  const [error,setError]=useState('');
  return <div className="chat-markdown"><ReactMarkdown urlTransform={url=>/^[a-z]:[\\/]/i.test(url)?url:defaultUrlTransform(url)} remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} skipHtml components={{
    pre:({children})=><CodeBlock>{children}</CodeBlock>,
    a:({href,children})=><a href={href} onClick={e=>{e.preventDefault();if(href)void window.cbim.call('chat.openLink',{id:workspaceId,target:href}).catch((e:Error)=>setError(e.message))}}>{children}</a>,
    img:({alt,src})=><a href={src} onClick={e=>{e.preventDefault();if(src)void window.cbim.call('chat.openLink',{id:workspaceId,target:src}).catch((e:Error)=>setError(e.message))}}>{alt||'查看图片'}</a>,
    table:({children})=><div className="chat-table-scroll"><table>{children}</table></div>,
  }}>{streaming?repairStreamingMarkdown(text):text}</ReactMarkdown>{error&&<p role="alert">{error}</p>}</div>;
});
