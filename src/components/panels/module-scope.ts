// 工作台模块分组：把「随当前标的切换」的视图与账户级 / 独立工具分开，
// 让顶部模块栏与内容区只呈现同一类内容，避免混排带来的滚动与语义歧义。

/** target = 随当前标的切换；global = 与标的无关（账户级数据或自带代码输入的独立工具）。 */
export type ModuleScope = "target" | "global";

export interface ModuleScopeOption {
  key: ModuleScope;
  label: string;
  /** 分组说明，用于 tab 的悬浮提示。 */
  hint: string;
}

export interface ModuleOption<K extends string> {
  key: K;
  label: string;
  scope: ModuleScope;
}

/** 分组标签固定，说明文案按工作台定制（个股 / 基金口径不同）。 */
export function createModuleScopes(hints: Record<ModuleScope, string>): readonly ModuleScopeOption[] {
  return [
    { key: "target", label: "当前标的", hint: hints.target },
    { key: "global", label: "持仓与全局工具", hint: hints.global },
  ];
}

/** 取指定分组下的模块选项，保持模块选项自身的展示顺序。 */
export function moduleOptionsForScope<K extends string>(
  options: readonly ModuleOption<K>[],
  scope: ModuleScope,
): ModuleOption<K>[] {
  return options.filter((option) => option.scope === scope);
}

/** 生成某一分组的勾选集合，供「全选本组 / 清空本组」与切换分组时合并使用。 */
export function moduleVisibilityForScope<K extends string>(
  options: readonly ModuleOption<K>[],
  scope: ModuleScope,
  enabled: boolean,
): Partial<Record<K, boolean>> {
  return Object.fromEntries(
    moduleOptionsForScope(options, scope).map((option) => [option.key, enabled]),
  ) as Partial<Record<K, boolean>>;
}

/**
 * 某一分组的默认模块：取该组第一个选项作为「一键可用视图」，
 * 即个股「行情概览 / 我的持仓组合」、基金「基金档案 / 持有基金」（由模块选项顺序保证，单测固定）。
 */
export function primaryModuleForScope<K extends string>(
  options: readonly ModuleOption<K>[],
  scope: ModuleScope,
): ModuleOption<K> | null {
  return moduleOptionsForScope(options, scope)[0] ?? null;
}

/** 某一分组是否已勾选模块：用于判断切过去会不会是空白。 */
export function hasEnabledInScope<K extends string>(
  options: readonly ModuleOption<K>[],
  scope: ModuleScope,
  enabledModules: Record<K, boolean>,
): boolean {
  return moduleOptionsForScope(options, scope).some((option) => enabledModules[option.key]);
}
