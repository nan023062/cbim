/**
 * 作用定位：未安装产品也可读取的轻量清单；只引用插件元数据。
 * 设计原因：静态清单支持未安装产品的发现，避免为展示图标与描述加载完整执行 SDK。
 */
import { manifest as pi } from '../../engine-plugins/pi/manifest';

import { manifest as claude } from '../../engine-plugins/claude/manifest';

import { manifest as codex } from '../../engine-plugins/codex/manifest';

import { manifest as memory } from '../../engine-plugins/memory/manifest';

export const engineCatalog = [pi, claude, codex, memory] as const;
