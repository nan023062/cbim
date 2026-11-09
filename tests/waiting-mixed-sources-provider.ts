import assert from 'node:assert/strict';
import http from 'node:http';
import {waitingAttachmentsProvider,attachmentFixture} from './waiting-attachments-provider';

export {attachmentFixture as mixedSourceGoal,requestImages} from './waiting-attachments-provider';
export const mixedSourceData={connectorId:'.cbim/connectors/mixed_materials',pageText:'MIXED_WEB_SAVED_29a：这只是网页资料，不是业务验证。',pageScript:'MIXED_SCRIPT_MUST_NOT_APPEAR',listingName:'listing-visible.txt',nestedFact:'NESTED_CONTENT_MUST_NOT_BE_READ',draft:'普通输入草稿不参与本次十二项资料补充。'};
export const mixedResourceKinds=['connector','team','agent','skill','architecture','module','workflow'] as const;
export const mixedResourceText=(kind:string)=>`# 已保存的 ${kind} 资料\n\nMIXED_RESOURCE_${kind}_29a\n\n静态正文只是参考，不授予业务执行或人工验收权限。`;

/** Reuse the unchanged actual Pi plan/wait/continuation/read chain; the additional HTTP server only supplies real public page bytes. */
export async function waitingMixedSourcesProvider(){
  const model=await waitingAttachmentsProvider(),httpRequests:Array<{method:string;url:string}>=[];let pageText=mixedSourceData.pageText,releaseWeb=()=>{},held=false;
  const webGate=new Promise<void>(resolve=>{releaseWeb=resolve});
  const web=http.createServer(async(req,res)=>{
    httpRequests.push({method:req.method??'',url:req.url??''});
    if(req.url==='/held'){held=true;await webGate}
    if(res.destroyed)return;res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(`<html><head><script>${mixedSourceData.pageScript}</script></head><body><h1>${pageText}</h1><p>保存时间的公开摘录</p></body></html>`);
  });
  await new Promise<void>(resolve=>web.listen(0,'127.0.0.1',resolve));const address=web.address();assert.ok(address&&typeof address!=='string');
  return {...model,httpRequests,webUrl:`http://127.0.0.1:${address.port}`,get webHeld(){return held},releaseWeb,changeWeb:()=>{pageText='MIXED_WEB_AFTER_IMPORT_MUST_NOT_APPEAR'},closeWeb:async()=>{releaseWeb();web.closeAllConnections();await new Promise<void>(resolve=>web.close(()=>resolve()))},close:async()=>{releaseWeb();web.closeAllConnections();await Promise.all([model.close(),new Promise<void>(resolve=>web.close(()=>resolve()))])},goal:attachmentFixture};
}
