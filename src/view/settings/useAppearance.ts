/**
 * 作用定位：由 App 唯一持有的外观控制器，将本机偏好应用到窗口，并响应系统配色变化。
 * 设计原因：设置页与账号菜单共享同一状态；页面卸载不重置外观，保存只发生在用户修改时。
 */
import {useEffect,useRef,useState} from 'react';
import {defaultAppearance,readAppearance,resolveTheme,saveAppearance,type AppearancePreferences} from './appearance-state';
import './appearance.css';
export interface AppearanceController {
  value:AppearancePreferences;
  resolvedTheme:'dark'|'light';
  error:string;
  update:(patch:Partial<AppearancePreferences>)=>void;
  reset:()=>void;
  retry:()=>void;
}
/** 初始化不写存储；系统监听随外壳释放，保存失败仍允许本窗口预览并显式重试。 */
export function useAppearance():AppearanceController{
  const [initial]=useState(()=>{try{return readAppearance(window.localStorage)}catch{return {value:{...defaultAppearance},error:'本机存储不可用，外观偏好暂时无法读取。'}}});
  const [value,setValue]=useState(initial.value),[error,setError]=useState(initial.error);
  const current=useRef(value);
  const [systemDark,setSystemDark]=useState(()=>window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(()=>{const media=window.matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(media.matches);change();media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[]);
  const resolvedTheme=resolveTheme(value.theme,systemDark);
  useEffect(()=>{
    const root=document.documentElement;root.dataset.theme=resolvedTheme;root.style.colorScheme=resolvedTheme;
    root.style.setProperty('--chat-text-size',value.textSize+'px');root.style.setProperty('--chat-code-size',value.codeSize+'px');
    root.dataset.reduceMotion=String(value.reduceMotion);
  },[resolvedTheme,value.textSize,value.codeSize,value.reduceMotion]);
  function persist(next:AppearancePreferences){try{setError(saveAppearance(window.localStorage,next))}catch{setError('本机存储不可用，本次外观修改仅在当前窗口生效。请稍后重试保存。')}}
  function update(patch:Partial<AppearancePreferences>){const next={...current.current,...patch};current.current=next;setValue(next);persist(next)}
  return {value,resolvedTheme,error,update,reset:()=>update({...defaultAppearance}),retry:()=>persist(current.current)};
}
