/**
 * 作用定位：读取固定 GitHub 仓库中独立 desktop-v 通道的公开稳定发布。
 * 设计原因：同仓库已有 Python 内核版本；按标签、平台附件和地址核验，不能把仓库 latest 当成桌面升级。
 */
import type {DesktopRelease} from '../../bridge/contracts/desktop-updates';
import {releaseRequest,type ReleaseRequest} from './release-http';
const repository='https://github.com/nan023062/cbim';
const versionPattern=/^(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
/** 稳定三段版本比较；非法版本不参与升级，不接受预发布或前导零。 */
export function compareDesktopVersions(a:string,b:string){
  if(!versionPattern.test(a)||!versionPattern.test(b))throw Error('桌面版本格式无效');
  const left=a.split('.').map(Number),right=b.split('.').map(Number);
  for(let i=0;i<3;i++)if(left[i]!==right[i])return left[i]>right[i]?1:-1;return 0;
}
export function desktopInstallerName(version:string){compareDesktopVersions(version,version);return `CBIM-Setup-${version}-x64.exe`}
/** 地址完全由校验后的版本构造，渲染进程和远端正文不能提供任意更新源。 */
export function desktopReleaseBase(version:string){compareDesktopVersions(version,version);return `${repository}/releases/download/desktop-v${version}/`}
export function parseDesktopRelease(value:unknown):DesktopRelease|undefined{
  if(!value||typeof value!=='object')return;const item=value as Record<string,unknown>;
  if(item.draft!==false||item.prerelease!==false||typeof item.tag_name!=='string'||!item.tag_name.startsWith('desktop-v'))return;
  const version=item.tag_name.slice(9);if(!versionPattern.test(version)||item.html_url!==`${repository}/releases/tag/${item.tag_name}`)return;
  if(typeof item.published_at!=='string'||!Number.isFinite(Date.parse(item.published_at))||!Array.isArray(item.assets))return;
  for(const name of [desktopInstallerName(version),'latest.yml']){
    const matches=item.assets.filter(asset=>asset&&asset.name===name);
    if(matches.length!==1||matches[0].state!=='uploaded'||!Number.isSafeInteger(matches[0].size)||matches[0].size<=0||matches[0].browser_download_url!==desktopReleaseBase(version)+name)return;
  }
  return {version,tag:item.tag_name,notes:typeof item.body==='string'?item.body.slice(0,20000):'',publishedAt:item.published_at};
}
/** 至多读取最近 150 条发布；只读请求不附带反馈 OAuth Token。完整扫描后按版本选择。 */
export async function latestDesktopRelease(signal:AbortSignal,request:ReleaseRequest=releaseRequest){
  const releases:DesktopRelease[]=[];
  for(let page=1;page<=5;page++){
    const result=await request(`https://api.github.com/repos/nan023062/cbim/releases?per_page=30&page=${page}`,{method:'GET',signal});
    if(result.status!==200||!Array.isArray(result.data))throw Error('无法读取 GitHub 桌面发布，请稍后手动检查');
    for(const raw of result.data){const release=parseDesktopRelease(raw);if(release)releases.push(release)}
    if(result.data.length<30)break;
    if(page===5)throw Error('发布列表超过检查范围，请在 GitHub 核对桌面版本');
  }
  return releases.sort((a,b)=>compareDesktopVersions(b.version,a.version))[0];
}
