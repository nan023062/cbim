/** IO 便携入口。字符串、字节与 JSON 算法在此维护，浏览器和 Node 均可使用。 */
export { StringUtils, LineFramer, type LineFramePolicy } from './strings';

export { ByteUtils, ByteLimitError } from './bytes';

export { parseJson, JsonUtils, StrictJsonError, type JsonKeyOrder } from './json';
