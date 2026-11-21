/** 为工作区和知识数据解析提供原生 Error。 */
import { JsonUtils, StrictJsonError } from '../../core/io/json';

/** 不改变字段及资源限制；只将已知解析失败转换为原生 Error，其他异常原样传播。 */
export function parseJson(text: string)
{
  try
  {
    return JsonUtils.ParseStrictJson(text);
  }
  catch (error)
  {
    if (error instanceof StrictJsonError)
      throw new Error(error.message);

    throw error;
  }
}
