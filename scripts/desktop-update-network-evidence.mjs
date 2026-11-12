// 线上验收的被动网络观测：不修改地址、请求/响应头、响应体或产品状态，不记录带签名查询参数的 URL。
export async function observeUpdaterNetwork(application) {
  await application.evaluate(({session}) => {
    const records = new Map();
    globalThis.__cbimUpdaterNetworkRecords = records;
    const requests = session.fromPartition('electron-updater', {cache: false}).webRequest;
    const header = (headers, name) => {
      const value = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name)?.[1];
      return Array.isArray(value) ? value[0] : value;
    };
    const item = details => {
      if (!records.has(details.id)) records.set(details.id, {id: details.id});
      return records.get(details.id);
    };
    requests.onBeforeSendHeaders((details, callback) => {
      const url = new URL(details.url), record = item(details);
      const disposition = url.searchParams.get('rscd') ?? '';
      record.file = /filename="?([^";]+)/i.exec(disposition)?.[1] ?? decodeURIComponent(url.pathname.split('/').pop());
      record.host = url.hostname; record.range = header(details.requestHeaders, 'range') ?? null;
      callback({requestHeaders: details.requestHeaders});
    });
    requests.onHeadersReceived((details, callback) => {
      const record = item(details), disposition = header(details.responseHeaders, 'content-disposition') ?? '';
      record.file = /filename="?([^";]+)/i.exec(disposition)?.[1] ?? record.file;
      record.status = details.statusCode;
      const length = header(details.responseHeaders, 'content-length');
      record.bytes = length === undefined ? null : Number(length);
      record.contentRange = header(details.responseHeaders, 'content-range') ?? null;
      callback({responseHeaders: details.responseHeaders});
    });
    requests.onCompleted(details => {item(details).completed = true;});
    requests.onErrorOccurred(details => {item(details).completed = false; item(details).error = details.error;});
  });
}

export async function readUpdaterNetwork(application) {
  return application.evaluate(() => [...globalThis.__cbimUpdaterNetworkRecords.values()]);
}

/** 只计已完成的安装包实体响应，排除重定向、索引和中止请求；字节指 Content-Length，不含协议开销。 */
export function summarizeUpdaterNetwork(records, filename) {
  const payloads = records.filter(item => item.file === filename && item.completed && [200, 206].includes(item.status));
  const measured = payloads.every(item => Number.isSafeInteger(item.bytes) && item.bytes >= 0);
  return {requests: payloads.length, ranges: payloads.filter(item => item.status === 206 && item.contentRange).length, fullDownloads: payloads.filter(item => item.status === 200).length, completedPayloadBytes: measured ? payloads.reduce((sum, item) => sum + item.bytes, 0) : null};
}
