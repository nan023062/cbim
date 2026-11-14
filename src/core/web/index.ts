/**
 * 作用定位：环境无关的网页读取契约和 HTML 正文转换入口。
 * 设计原因：输入校验、浏览器端口和正文算法不加载网络或 Electron；平台实现单向组合本入口。
 */
export {pageReadInput,browserRobotsPolicy} from './contracts';
export type {PageReadInput,BrowserRobotsPolicy} from './contracts';
export type {BrowserReader,BrowserPage} from './browser-reader';
export {htmlMarkdown,truncateParagraphs} from './web-content';
