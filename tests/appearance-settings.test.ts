import {describe,it,expect} from 'vitest';
import {appearanceKey,defaultAppearance,readAppearance,resolveTheme,saveAppearance,type PreferenceStorage} from '../src/view/settings/appearance-state';

function storage(values:Record<string,string>={}):PreferenceStorage&{values:Record<string,string>}{return {values,getItem:key=>values[key]??null,setItem:(key,value)=>{values[key]=value}}}
describe('本机外观偏好',()=>{
  it('继承旧主题且读取不写入配置',()=>{const saved=storage({'cbim.theme':'light'});expect(readAppearance(saved)).toEqual({value:{...defaultAppearance,theme:'light'},error:''});expect(saved.values).toEqual({'cbim.theme':'light'})});
  it('新偏好优先，跟随系统不被旧主题覆盖',()=>{const saved=storage({[appearanceKey]:JSON.stringify({...defaultAppearance,theme:'system',textSize:17,codeSize:16}),'cbim.theme':'light'});expect(readAppearance(saved).value).toEqual({...defaultAppearance,theme:'system',textSize:17,codeSize:16})});
  it('逐项拒绝无效字号、布尔值和未知主题',()=>{expect(readAppearance(storage({[appearanceKey]:JSON.stringify({theme:'unknown',textSize:'17',codeSize:99,reduceMotion:'false'})})).value).toEqual(defaultAppearance)});
  it('保留有效项，同时回退无效项',()=>{expect(readAppearance(storage({[appearanceKey]:JSON.stringify({theme:'light',textSize:17,codeSize:-1,reduceMotion:true})})).value).toEqual({theme:'light',textSize:17,codeSize:12,reduceMotion:true})});
  it('损坏记录与不可用存储给出可恢复错误，不覆盖原值',()=>{const saved=storage({[appearanceKey]:'{bad'});expect(readAppearance(saved).error).toContain('无法读取');expect(saved.values[appearanceKey]).toBe('{bad');expect(readAppearance({getItem(){throw Error('blocked')},setItem(){}}).value).toEqual(defaultAppearance)});
  it('只保存外观，保留其它本机数据并可重新读取',()=>{const saved=storage({'cbim.workspace.tabs.v1':'draft'}),value={...defaultAppearance,textSize:17 as const};expect(saveAppearance(saved,value)).toBe('');expect(readAppearance(saved).value).toEqual(value);expect(saved.values['cbim.workspace.tabs.v1']).toBe('draft')});
  it('写入失败不报告保存成功，重试后可读回',()=>{const saved=storage();let blocked=true;const failing={getItem:saved.getItem,setItem:(key:string,value:string)=>{if(blocked)throw Error('quota');saved.setItem(key,value)}};expect(saveAppearance(failing,defaultAppearance)).toContain('仅在当前窗口');blocked=false;expect(saveAppearance(failing,defaultAppearance)).toBe('')});
  it('只有跟随系统时响应系统配色',()=>{expect(resolveTheme('system',true)).toBe('dark');expect(resolveTheme('system',false)).toBe('light');expect(resolveTheme('dark',false)).toBe('dark');expect(resolveTheme('light',true)).toBe('light')});
});
