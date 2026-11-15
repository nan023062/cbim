/**
 * 作用定位：页面入口的延迟模块装配，提供局部加载与失败重试，不负责业务导航。
 * 设计原因：按需加载只影响代码到达时间；边界固定在页面内部，重试不刷新窗口或丢弃其它页面草稿。
 */
import {Component,Suspense,lazy,useMemo,useState,type ReactNode} from 'react';

/** 捕获模块加载或该页渲染失败；不将未知错误推断为网络离线，也不自动重放业务请求。 */
class ViewLoadBoundary extends Component<{label:string;retry:()=>void;children:ReactNode},{failed:boolean}> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true}}
  render(){return this.state.failed?<section role="alert"><p>{this.props.label}未能显示。可以重新加载此页面，或从导航返回。</p><button onClick={this.props.retry}>重新加载此页面</button></section>:this.props.children}
}

/** 在模块作用域声明；首次挂载才调用 loader。成功后的父层重绘与隐藏不会重建页面。 */
export function deferredView<P extends object>(load:()=>Promise<{default:(props:P)=>ReactNode}>,label:string):(props:P)=>ReactNode{
  return function DeferredView(props:P){
    const [attempt,setAttempt]=useState(0);
    const View=useMemo(()=>lazy(load),[attempt]);
    return <ViewLoadBoundary key={attempt} label={label} retry={()=>setAttempt(value=>value+1)}><Suspense fallback={<p role="status">正在加载{label}…</p>}><View {...props}/></Suspense></ViewLoadBoundary>;
  };
}
