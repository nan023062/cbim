import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export async function digest(file, algorithm = 'sha256', encoding = 'hex') {
  return createHash(algorithm).update(await fs.readFile(file)).digest(encoding);
}

/** 查找实际 PE 文件；同包里的 ELF/Mach-O 原生模块不交给 Windows 签名器。 */
export async function windowsPayloads(root) {
  const result = [];
  async function walk(directory) {
    for (const entry of await fs.readdir(directory, {withFileTypes: true})) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw Error('SIGNING_PAYLOAD_LINK：正式包不能通过链接引用包外文件');
      if (entry.isDirectory()) await walk(file);
      else if (/\.(exe|dll|node)$/i.test(entry.name)) {
        const handle = await fs.open(file, 'r');
        try {
          const header = Buffer.alloc(64);
          const {bytesRead} = await handle.read(header, 0, 64, 0);
          if (header.toString('ascii', 0, 2) === 'MZ') {
            if (bytesRead < 64) throw Error(`SIGNING_PAYLOAD_INVALID：${file}`);
            const signature = Buffer.alloc(4);
            await handle.read(signature, 0, 4, header.readUInt32LE(60));
            if (signature.equals(Buffer.from([80, 69, 0, 0]))) result.push(file);
            else throw Error(`SIGNING_PAYLOAD_INVALID：${file}`);
          } else if (/\.(exe|dll)$/i.test(entry.name)) throw Error(`SIGNING_PAYLOAD_INVALID：${file}`);
        } finally { await handle.close(); }
      }
    }
  }
  await walk(root);
  if (!result.includes(path.join(root, 'CBIM Desktop.exe'))) throw Error('SIGNING_PAYLOAD_MISSING：找不到主程序');
  return result.sort();
}

export async function signPayload(root, signer) {
  const files = await windowsPayloads(root), receipts = [];
  for (const file of files) {
    const signature = await signer.sign(file);
    receipts.push({file: path.relative(root, file).replaceAll('\\', '/'), sha256: await digest(file), signature});
  }
  return receipts;
}
