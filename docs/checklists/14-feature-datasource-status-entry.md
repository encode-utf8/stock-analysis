# 14 数据源状态入口上移与探测超时修复验收清单

- 分支：`feature/datasource-failure-ux`
- 关联方案：`docs/datasource-status-panel-plan.md`
- 目标：把数据源健康与调度状态从个股工作台模块抽到页面右上角功能区；修复 `/api/admin/datasources` 因 R2 探测无超时而导致「怎么刷新都是请求超时」。
- 状态：已完成，待用户确认。

## 验收项

### 入口上移

- [x] 页面右上角功能区新增「数据源状态」入口（与背景与光效 / 轨迹显示 / 数据一致性并列）
- [x] 弹窗内容与原子个模块一致：5 张数据源卡片 + 调度任务 + 四个操作按钮
- [x] 快照在打开弹窗时懒加载，进页面不触发外部探测；加载后按钮显示最差状态点
- [x] 个股工作台模块栏不再出现「数据源与调度」，全局分组计数 6 → 5
- [x] 基金工作台不受影响（原本没有该模块）

### 探测超时

- [x] 五个探测全部有硬超时（R2 通过 `Promise.race` 加界）
- [x] 快照整体有总预算，超预算的数据源返回「离线 · 探测超时」而不是挂住
- [x] 接口响应时间上界 ≈ 12 秒 + store 查询，客户端 20 秒超时不再被触发
- [x] 超时原因在卡片上可见（区分网络不可达 / 上游异常）

### 任务触发超时

- [x] 三个任务触发请求改用 180 秒超时，不再把耗时任务误判为失败
- [x] 任务超时文案说明「任务可能仍在执行，请刷新状态确认」

### 测试与文档

- [x] 单测：探测超时保护 + 分组划分更新
- [x] 端到端：入口可打开并展示数据源卡片；模块分组计数更新
- [x] 回归：`typecheck` / `lint` / `test` / `build` / `test:e2e` 全绿
- [x] 文档：方案、验收清单、分组方案与根清单同步

## 验证命令

```powershell
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
corepack pnpm test:e2e
```

## 验证方式与结果（2026-09-22）

```powershell
corepack pnpm typecheck   # 通过
corepack pnpm lint        # 通过（0 error / 0 warning）
corepack pnpm test        # 55 个文件 / 640 个用例全绿（含新增 tests/datasource-health.test.ts）
corepack pnpm build       # 通过
corepack pnpm test:e2e    # 17 个用例全绿（含新增首页外壳「数据源状态入口」用例）
```

- 修复效果实测：真实 `.env`（本机 R2 不可达）下 `getDataSourceHealthSnapshot()` 由 > 60 秒降至 **8.3 秒**返回；R2 卡片显示「离线 · R2 探测超时（8 秒未响应）」，其余四类数据源在线，远端 `/api/admin/datasources` 不再触发 20 秒客户端超时。
- 单测 `tests/datasource-health.test.ts`：mock R2 永不返回，断言五个数据源齐全、R2 `state=offline` 且文案含「探测超时」、整体耗时 < 3 秒。
- 端到端 `tests/e2e/home.spec.ts`：右上角入口打开后 `datasource-status-card` 计 5、可见「调度任务」标题，关闭后弹窗隐藏。
- 人工核对：个股工作台模块栏已无「数据源与调度」，全局分组显示 0/5。

## 通过标准

- 全部验收项勾选；
- 本地 `.env`（R2 不可达）下 `/api/admin/datasources` 在 ~12 秒内返回且 R2 显示离线 + 超时原因；
- 面板四个按钮不再普遍出现「请求超时，请稍后重试。」。

## 风险与遗留

- R2 探测超时后底层请求仍会在后台自行结束（最长约 50 秒），仅影响连接占用，不影响接口响应；
- R2 上传路径（日报 / 资讯快照）在 R2 不可达时仍会长时间等待，属既有行为，本次未处理；
- 数据源面板改为懒加载后，未打开弹窗时右上角没有状态点（首次打开后才出现）。