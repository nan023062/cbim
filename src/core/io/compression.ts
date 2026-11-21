/**
 * 作用定位：Node 字节解压。由调用者决定输入来源、压缩格式及输出字节上限。
 * 设计原因：无状态封装平台解码和输出上限，避免把网络来源及业务大小策略耦合到字节算法。
 */
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';

/** 仅解压传入字节视图，超出输出上限或输入损坏时传播解码错误。 */
export function decompressBytes(bytes: Uint8Array, format: 'gzip' | 'deflate' | 'br', maxOutputLength: number): Buffer<ArrayBuffer>
{
  const options = { maxOutputLength };

  switch (format)
  {
    case 'gzip':
      return gunzipSync(bytes, options);
    case 'deflate':
      return inflateSync(bytes, options);
    case 'br':
      return brotliDecompressSync(bytes, options);
    default:
      throw new TypeError('不支持的压缩格式');
  }
}
