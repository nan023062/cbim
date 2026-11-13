/**
 * 作用定位：不执行脚本的 HTML 正文提取和按段落截断。
 * 设计原因：保留标题、段落、列表与链接；剔除导航和表单，长单段只按 Unicode 字符截取，不冒充全文。
 */
import {parse,type DefaultTreeAdapterMap} from 'parse5';
type Node=DefaultTreeAdapterMap['node'];
const skipped=new Set(['script','style','nav','header','footer','form','iframe','noscript','svg','canvas','button','input','select']);
function children(node:Node):Node[]{return 'childNodes' in node?node.childNodes:[]}
function tag(node:Node):string{return 'tagName' in node?node.tagName:''}
function attr(node:Node,name:string):string|undefined{return 'attrs' in node?node.attrs.find(item=>item.name===name)?.value:undefined}
/** 文档大小由传输限制；迭代扫描有界节点，正文递归深度最多 100，异常深层页面拒绝。 */
export function htmlMarkdown(html:string,base:string):{title:string;markdown:string;login:boolean;challenge:boolean}{
  const root=parse(html),nodes:Node[]=[],pending=[root as Node];
  while(pending.length){const node=pending.pop()!;nodes.push(node);if(nodes.length>50000)throw Error('WEB_CONTENT: 页面结构过大');pending.push(...children(node).slice().reverse())}
  const text=(node:Node,depth=0):string=>{
    if(depth>100)throw Error('WEB_CONTENT: 页面嵌套过深');
    if('value' in node)return node.value;
    return children(node).map(child=>text(child,depth+1)).join('');
  };
  const titleNode=nodes.find(node=>tag(node)==='title'),title=(titleNode?text(titleNode):'').trim().slice(0,500);
  const login=nodes.some(node=>tag(node)==='input'&&attr(node,'type')?.toLowerCase()==='password');
  const challenge=nodes.some(node=>['cf-challenge-running','challenge-form'].includes(attr(node,'id')??'')||attr(node,'class')?.split(/\s+/).includes('g-recaptcha'))||/^(just a moment|access denied|attention required)/i.test(title);
  const selected=nodes.find(node=>tag(node)==='article')??nodes.find(node=>tag(node)==='main')??nodes.find(node=>tag(node)==='body')??root;
  const render=(node:Node,depth=0):string=>{
    if(depth>100)throw Error('WEB_CONTENT: 页面嵌套过深');
    if('value' in node)return node.value.replace(/\s+/g,' ');
    const name=tag(node);if(skipped.has(name)||attr(node,'hidden')!==undefined||attr(node,'aria-hidden')==='true')return '';
    const value=children(node).map(child=>render(child,depth+1)).join('');
    if(/^h[1-6]$/.test(name))return `\n\n${'#'.repeat(Number(name[1]))} ${value.trim()}\n\n`;
    if(name==='pre')return '\n\n```\n'+text(node).trim()+'\n```\n\n';
    if(name==='li')return '\n- '+value.trim();
    if(name==='br')return '\n';
    if(name==='a'&&attr(node,'href')){try{const link=new URL(attr(node,'href')!,base);if(['http:','https:'].includes(link.protocol))return `[${value.trim().replace(/[[\]]/g,'')}](${link.href.replace(/[()]/g,char=>encodeURIComponent(char))})`}catch{}}
    return ['p','div','section','article','ul','ol','blockquote','table','tr'].includes(name)?'\n\n'+value.trim()+'\n\n':value;
  };
  return {title,markdown:render(selected).replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim(),login,challenge};
}
export function truncateParagraphs(value:string,maxChars:number):{markdown:string;truncated:boolean}{
  const points=Array.from(value);if(points.length<=maxChars)return {markdown:value,truncated:false};
  const prefix=points.slice(0,maxChars).join(''),boundary=prefix.lastIndexOf('\n\n');
  return {markdown:(boundary>0?prefix.slice(0,boundary):prefix).trimEnd(),truncated:true};
}
