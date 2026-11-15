import {describe,it,expect} from 'vitest';
import {findSettingsSections,settingsSections} from '../src/view/settings/settings-sections';
describe('设置搜索',()=>{
  it('忽略首尾空白与英文大小写，按子设置关键词定位',()=>{expect(findSettingsSections('  aPi KEY  ').map(x=>x.id)).toEqual(['models']);expect(findSettingsSections('向量').map(x=>x.id)).toEqual(['models']);expect(findSettingsSections('深色').map(x=>x.id)).toEqual(['appearance'])});
  it('多词必须同属一项，找不到不回退到其它页面',()=>{expect(findSettingsSections('局域网 端口').map(x=>x.id)).toEqual(['resources']);expect(findSettingsSections('引擎 头像')).toEqual([])});
  it('空搜索保留全部入口与顺序，不修改静态导航',()=>{expect(findSettingsSections('  ')).toEqual(settingsSections);findSettingsSections('不存在');expect(findSettingsSections('').map(x=>x.id)).toEqual(settingsSections.map(x=>x.id))});
});
