// view/conversation: module-owned integration coverage; keep the original scenario and cleanup semantics.
import {expect,it} from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {fixture} from '../../../logic/application/unittest/support/helpers';
import {ChatInputs} from '../../../logic/materials/service/chat-inputs';
import {pastedLocalPaths} from '../../../bridge/contracts/chat';
import {pastedImage} from '../pasted-images';
import {ComposerAttachments} from '../../execution-view/ComposerAttachments';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2X8AAAAASUVORK5CYII=','base64');
it('仅完整绝对路径列表识别为引用，普通文字和混合内容保留原文',()=>{
 expect(pastedLocalPaths('"C:\\工作目录\\a.txt"\r\nC:\\工作目录\\文件夹')).toEqual(['C:\\工作目录\\a.txt','C:\\工作目录\\文件夹']);
 expect(pastedLocalPaths('file:///C:/a%20b.png')).toEqual(['file:///C:/a%20b.png']);expect(pastedLocalPaths('/home/user/a.md')).toEqual(['/home/user/a.md']);
 for(const text of ['请查看 C:\\a.txt','C:\\a.txt\n谢谢','https://example.com','relative.txt','\\\\server\\share','../secret',''])expect(pastedLocalPaths(text)).toBeUndefined();
});
