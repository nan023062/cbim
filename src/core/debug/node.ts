/** Node 文件日志入口。调用方负责目录、记录内容、写入顺序及写失败后的业务处置。 */
import fs from 'node:fs/promises';

/** 使用单行 JSON 追加诊断记录；调用者可选择忽略文件写入失败。 */
export function appendDiagnosticRecord(filename: string, record: object): Promise<void>
{
  return fs.appendFile(filename, JSON.stringify(record) + '\n', { mode: 0o600 });
}

/** 写入单条记录并同步文件。首次独占创建用于禁止覆盖已有的恢复日志。 */
export async function appendDurableRecord(filename: string, record: object, mode: 'a' | 'wx' = 'a'): Promise<void>
{
  const file = await fs.open(filename, mode, 0o600);

  try
  {
    await file.writeFile(JSON.stringify(record) + '\n');

    await file.sync();
  }
  finally
  {
    await file.close();
  }
}
