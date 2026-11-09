const fs = require('node:fs/promises');
const path = require('node:path');
const {signingConfig} = require('./config.cjs');

// electron-builder invokes this for the generated uninstaller before embedding it, then for the final installer.
module.exports = async function signInstaller(task) {
  if (task.hash !== 'sha256' || task.isNest) throw Error('SIGNING_HASH_UNEXPECTED');
  const root = process.env.CBIM_DESKTOP_OUTPUT;
  if (!root || path.dirname(path.resolve(task.path)) !== path.resolve(root)) throw Error('SIGNING_OUTPUT_INVALID');
  const {createWindowsSigner} = await import('./windows.mjs');
  const {digest} = await import('./payload.mjs');
  const signature = createWindowsSigner(signingConfig()).sign(task.path);
  const name = path.basename(task.path);
  // Builder deletes this intermediate file after embedding; preserve the signed bytes for the publication gate.
  if (name.endsWith('__uninstaller.exe')) await fs.copyFile(task.path, path.join(root, 'signed-uninstaller.exe'), fs.constants.COPYFILE_EXCL);
  await fs.appendFile(path.join(root, 'installer-signatures.jsonl'), JSON.stringify({name, sha256: await digest(task.path), signature}) + '\n');
};
