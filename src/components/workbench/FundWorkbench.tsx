/** 基金工作台空容器：F0 只提供可渲染骨架，基金数据面板在后续阶段接入。 */
export default function FundWorkbench() {
  return (
    <section className="mx-auto flex min-w-0 flex-1 max-w-6xl flex-col gap-6 px-4 py-8">
      <header className="rounded-xl border bg-white p-5 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">基金分析与 AI 学习台</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            基金工作台骨架已就绪，基金档案、历史净值、盘中行情、持仓与风险指标将在后续阶段接入。
          </p>
        </div>
      </header>

      <div className="flex min-h-[420px] items-center justify-center rounded-xl border border-dashed bg-white p-8 text-center shadow-sm">
        <div>
          <h2 className="text-lg font-semibold">基金面板待接入</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            本阶段已冻结基金领域类型与工作台切换骨架，后续将在 F1/F2 阶段补齐查询与展示能力。
          </p>
        </div>
      </div>

      <footer className="text-center text-xs text-muted-foreground">
        基金行情、净值、持仓与 AI 输出可能存在延迟或误差，仅供学习参考，不构成投资建议。
      </footer>
    </section>
  );
}
