/**
 * 作用定位：在目标接续历史中展示 Main 已受理的 v1/v2 附件清单和有界来源摘要。
 * 设计原因：历史只读当时快照，区别链接、目录与真实资料；不重新联网、读源文件或用已保存授权冒充当前连接。
 */
import type {ContinuationAttachmentManifest,ContinuationAttachmentItem} from '../../bridge/contracts/dispatch';

const labels={image:'图片',reference:'二进制引用',text:'文本快照',directory_listing:'首层目录清单',url_reference:'链接指针（未抓取）',web_excerpt:'网页摘录',resource_excerpt:'仓库静态资料'};
function sourceSummary(item:ContinuationAttachmentItem){
  if(item.kind==='file')return;
  const source=item.proof;
  switch(source.kind){
    case 'folder':return `首层 ${source.entryCount} 项${source.truncated?' · 已截取清单':''}，没有递归读取文件内容`;
    case 'link':return `${source.url} · 仅保存地址`;
    case 'web':return `${source.url} · 实际响应 ${source.rawBytes} 字节${source.truncated?' · 正文已截取':''}`;
    case 'repository_resource':return `${source.resourceKind} · ${source.resourceId} · 仓库版本 ${source.revision.slice(0,12)} · 原文 ${source.fullContentBytes} 字节${source.truncated?' · 已截取':''} · 导入时只读授权第 ${source.grantRevision} 版`;
  }
}
/** 无内容抓取入口；快照仅代表导入/受理事实，不作为目标完成或当前源状态证明。 */
export function ContinuationAttachmentHistory({manifest}:{manifest:ContinuationAttachmentManifest}){
  return <details data-testid="scope-continuation-manifest"><summary>{manifest.items.length} 份已受理附件快照</summary>{manifest.items.map(item=><p key={item.attachmentId} data-attachment-kind={item.kind}>{item.name} · {labels[item.contentKind]} · {item.byteLength} 字节{item.kind!=='file'&&<><br/><span className="scope-goal-muted">{sourceSummary(item)} · {new Date(item.proof.capturedAt).toLocaleString()}</span></>}{item.note&&<><br/><span className="scope-goal-muted">{item.note}</span></>}</p>)}</details>;
}
