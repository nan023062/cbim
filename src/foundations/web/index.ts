/**
 * 作用定位：高内聚网页基础类库的 Node 公开入口。
 * 设计原因：消费者按契约读取网页或复用安全 HTTP；Electron 实现在单独入口，普通导入不会加载桌面运行时。
 */
export {WebPageReader} from './page-reader';
export {PublicHttp,publicUrl,publicAddress} from './public-http';
export type {PublicHttpTransport,PublicHttpResponse,PublicHttpBytes} from './public-http';
export {htmlMarkdown,truncateParagraphs} from './web-content';
export type {BrowserReader,BrowserPage} from './browser-reader';
export type {PageReadInput} from './contracts';
