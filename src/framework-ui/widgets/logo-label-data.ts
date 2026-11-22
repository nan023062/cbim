/** 只读的结构化视图契约；纯数据提供者无需依赖视图包。 */
export interface LogoLabelData<Id extends string = string> {
  readonly id: Id;
  readonly name: string;
  readonly logo: { readonly src?: string; readonly fallbackIcon: string };
  readonly tooltip: string;
  readonly selected?: boolean;
  readonly disabledReason?: string;
}
