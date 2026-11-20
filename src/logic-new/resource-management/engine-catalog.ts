/** 未安装产品也可读取的轻量清单；只引用插件元数据。 */
import { manifest as pi } from '../../engine-plugins/pi/manifest';
import { manifest as claude } from '../../engine-plugins/claude/manifest';
import { manifest as codex } from '../../engine-plugins/codex/manifest';
import { manifest as memory } from '../../engine-plugins/memory/manifest';

export const engineCatalog = [pi, claude, codex, memory] as const;
