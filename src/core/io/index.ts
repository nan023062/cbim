/**
 * 作用定位：IO 便携入口。字符串、字节与 JSON 算法在此维护，浏览器和 Node 均可使用。
 * 设计原因：用重导出聚合便携算法，与 Node 文件及加密实现分开，使浏览器消费者保持可构建。
 */
export { StringUtils, LineFramer, type LineFramePolicy } from './strings';

export { ByteUtils, ByteLimitError } from './bytes';

export { parseJson, JsonUtils, StrictJsonError, type JsonKeyOrder } from './json';
