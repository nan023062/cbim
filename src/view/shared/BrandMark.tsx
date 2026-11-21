/**
 * 作用定位：引用 assets/branding 的无业务状态 CBIM 产品标识，供外壳与欢迎页复用。
 * 设计原因：直接引用 assets/branding 中的品牌矢量源，安装图标和官网也由同一源生成，避免各入口各画一份。
 */
import mark from '../../../assets/branding/cbim-mark.svg';

/** 邻近已有产品名称时使用 decorative，避免屏幕阅读器重复读出名称。 */
export function BrandMark({ size = 28, decorative = false }: { size?: number; decorative?: boolean })
{
  return <img src={mark} width={size} height={size} alt={decorative ? '' : 'CBIM Assistant'} draggable={false} style={{ display: 'block', flexShrink: 0 }} />;
}
