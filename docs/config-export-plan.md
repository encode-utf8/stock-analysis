# 配置导出与自动加载方案（跨环境迁移）

- 文档版本：v1.0
- 编制日期：2026-09-18
- 分支：`feature/docker-fullstack`（与 Docker 全栈部署、Linux 一键部署同分支）
- 关联文档：`README.md`、`checklist.md`、`docs/deploy-plan.md`、`docs/deploy-linux-plan.md`
- 需求来源：本机（Windows）部署好之后要迁到云服务器（Linux）时，密钥、地址、cron 等配置需要一条条从 `.env` 抄到新环境，重复且容易漏。期望：一条命令导出配置 → 把导出文件粘到新项目目录 → 新环境自动生效。

## 1. 可行性分析

- 现状：配置的唯一来源是项目根 `.env`（`.gitignore` 已忽略），`.env.example` 只是模板；四个消费方分别读取它：
  - Next（web）：`next dev` / `next start` / standalone 运行时由 Next 自己加载 `.env`；
  - 工具链：`drizzle.config.ts` 通过 `dotenv/config` 读取 `DATABASE_URL`；
  - 启动脚本：`start.ps1` / `start.bat` / `start.sh` / `deploy.sh` 在 `.env` 缺失时复制 `.env.example`；
  - Compose：`docker-compose.yml` 用 `${VAR:-}` 从项目根 `.env` 插值，把密钥传进容器。
- 可实现，且不需要新增依赖：`dotenv` 已经是生产依赖（`package.json` 的 `dependencies`），运行时可直接用它解析导出文件；导出侧只写 `KEY=value` 文本，不需要依赖。
- 关键约束：
  - 导出文件包含密钥，必须继续被 `.gitignore` 忽略（`.env.*` 已覆盖，再补一条显式条目便于识别）。
  - 优先级必须可预期：真实环境变量 > `.env` > `.env.export`，即导出文件只补空缺、不覆盖本机已配置项。
  - Compose 只认名为 `.env` 的文件（或 `--env-file`），所以脚本在 `.env` 缺失时要把 `.env.export` 落地成 `.env`，否则容器场景拿不到密钥。

## 2. 方案设计

### 2.1 文件与优先级

| 文件 | 角色 | 是否入库 |
| --- | --- | --- |
| `.env.example` | 模板与键位顺序（导出脚本按它的顺序与注释生成） | 是 |
| `.env` | 本机实际配置，文件来源里的最高优先级 | 否 |
| `.env.export` | 迁移导出文件：粘到新环境项目根目录即自动加载 | 否 |

- 合并顺序（先加载者优先，后加载者只补空缺）：真实环境变量 > `.env`（Next / dotenv 先加载）> `.env.export`（本项目补充加载）。
- 导出文件采用 dotenv 语法（注释、`KEY=value`、必要时单/双引号包裹），既能被 `dotenv` 读，也能被脚本直接复制成 `.env`。

### 2.2 导出脚本

- 新增：`export-config.ps1`（Windows，含 `export-config.bat` 双击入口）、`export-config.sh`（Linux / macOS）。
- 生成内容：
  1. 头部元信息：导出时间、来源主机、生成方、安全提示；
  2. 「未填写键」清单：值为空或仍是 `replace-me` / `replace-with-*` / `xxxx` 这类占位值；
  3. 按 `.env.example` 的顺序与注释逐键输出，取值优先 `.env`、缺失时回退模板默认值；
  4. 追加「自定义键」段落：`.env` 中存在但模板没有的键（例如 `DATA_ROOT`）。
- 参数：`-Output`（默认 `.env.export`）、`-EnvPath`、`-TemplatePath`、`-Force`；`-h/--help`。
- 幂等：同一份输入重复导出，除时间与主机元信息外内容一致。
- 输出使用 LF 行尾，方便跨平台携带；Windows 生成、Linux 直接使用无需转换。

### 2.3 自动加载

- Web 运行时：新增 `src/lib/env-export.ts`（`dotenv` 解析 + 只补空缺）；`src/instrumentation.ts` 在 Node 运行时启动阶段调用（覆盖 `next dev` / `next start` / standalone 容器），`next.config.ts` 在配置求值时再调用一次（覆盖构建期与配置期读取）。
- 工具链：`drizzle.config.ts` 在 `dotenv/config` 之后调用同一函数，保证只有 `.env.export` 的机器上 `pnpm db:migrate` 也能连库。
- 脚本与 Compose：`start.ps1` / `start.bat` / `start.sh` / `deploy.sh` 的「`.env` 缺失」分支改为优先复制 `.env.export`，没有才回退 `.env.example`，并打印来源提示。
- 侧车（FastAPI）：不读 `.env`（配置都来自请求参数与容器环境），无需改动。

### 2.4 安全

- 导出文件是明文密钥：保持 `.gitignore` 忽略并补显式条目；脚本结尾提示「请勿提交、勿外发」。
- Linux 下导出后把文件权限收为 `600`。
- 导出脚本只打印键名与数量，不打印密钥值。

## 3. 改动范围

- 新增：`export-config.ps1`、`export-config.bat`、`export-config.sh`、`src/lib/env-export.ts`、`tests/env-export.test.ts`、本文档。
- 修改：`src/instrumentation.ts`、`next.config.ts`、`drizzle.config.ts`、`start.ps1`、`start.bat`、`start.sh`、`deploy.sh`、`.gitignore`、`README.md`、`checklist.md`。
- 不改动：业务逻辑、数据库结构、容器编排与镜像、CI 流程。

## 4. 测试与验收

- 单测：解析与合并语义（注释、空行、单双引号、`export` 前缀、CRLF、BOM、非法行、空值）、只补空缺、`override` 模式、文件缺失时不报错、返回已应用键列表。
- 脚本：用临时 `.env` + `.env.example` 跑导出，校验键顺序、取值优先级、自定义键段落、占位值清单、`-Force` 覆盖行为；并用同一份输入跑 `export-config.sh`，比对两者正文一致（忽略时间与主机元信息）。
- 集成：项目根临时放置 `.env.export` 后启动 `pnpm dev`，确认日志出现「已加载 .env.export（N 项）」；只有 `.env.export` 时 `pnpm db:migrate` 能取到 `DATABASE_URL`。
- 脚本落地：在隔离目录（无 `.env`）验证 `start.*` 与 `deploy.sh` 优先复制 `.env.export`。
- 回归：`typecheck`、`lint`、`test`、`build`、`test:e2e` 全绿。

## 5. 风险与替代方案

- 明文密钥：导出文件与 `.env` 同等敏感，文档与脚本都要提示，Linux 下收紧权限到 600。
- 解析差异：脚本侧只支持常见 dotenv 写法（简单键值、单/双引号），复杂的多行转义需人工处理；运行时以 `dotenv` 的解析结果为准。
- 优先级误用：`.env.export` 只补空缺；若希望「导出文件覆盖本机配置」，需要显式使用 `override`（当前不提供命令行开关，避免误伤本机配置）。
- 替代方案：把导出文件命名为 `.env.local` 让 Next 原生加载——但 Compose、drizzle、启动脚本都读不到，且 `.env.local` 在 Next 里优先级高于 `.env`，与「本机优先」相反，否决。

## 6. 实施记录（2026-09-18）

- 状态：已完成（分支 `feature/docker-fullstack`；改动未提交，等待人工确认）。
- 与立项方案的一处偏差：导出逻辑没有写成「PowerShell + Bash 两份实现」，而是收敛为一个零依赖的 Node 核心
  `scripts/export-config.mjs`，`export-config.ps1`（Windows，附 `export-config.bat` 双击入口）与
  `export-config.sh`（Linux / macOS）只做参数转发。原因：两份实现无法保证「跨平台正文一致」，
  而 node 本就是项目运行依赖；核心刻意不引用 `dotenv`，所以 `pnpm install` 之前、或只有 node 的容器里也能导出。
- 新增文件：
  - `src/lib/env-export.ts`：`loadEnvExport()`（复用 `dotenv` 解析 + 只补空缺）、`isPlaceholderValue()`、`describeEnvExportResult()`；
  - `scripts/export-config.mjs`：导出核心（解析语义与 `dotenv.parse` 对齐、按模板键位生成、未填写清单、自定义键段落、LF 输出、非 Windows 自动 `chmod 600`）；
  - `export-config.ps1` / `export-config.bat` / `export-config.sh`：平台入口；
  - `tests/env-export.test.ts`、`tests/env-export-script.test.ts`：合并语义单测、解析对照 `dotenv` 的逐例断言、CLI 子进程端到端用例。
- 修改文件：`src/instrumentation.ts`（Node 运行时启动阶段加载并打印摘要）、`next.config.ts`（配置求值阶段加载）、
  `drizzle.config.ts`（`dotenv/config` 之后加载）、`start.ps1` / `start.bat` / `start.sh` / `deploy.sh`
  （`.env` 缺失时优先复制 `.env.export`）、`.gitignore`（显式忽略 `.env.export`）、`package.json`（新增 `export:config`）、
  `.env.example`（顶部说明）、`README.md`、`checklist.md`。
- 实测结论（完整命令与输出见 `checklist.md`「配置导出与自动加载」小节的实测结果）：单测 49 文件 / 609 例通过；
  `pnpm dev` 启动日志出现 `[env] 已加载 .env.export…`；在 `DOTENV_CONFIG_PATH` 指向空文件（即完全不加载 `.env`）的前提下
  `pnpm db:migrate` 仍成功连库并应用迁移；Windows 与 Linux 导出正文一致（忽略时间与主机行）；
  `start.ps1` / `start.bat` / `start.sh` / `deploy.sh` 均验证为优先复制 `.env.export`。
- 开发中新增的两处实现约束：
  1. `src/lib/env-export.ts` 不直接调用 `node:fs`，而是用 `dotenv.config({ path, processEnv: {} })` 读取导出文件：
     直接调用 `node:fs`（动态路径）会触发 Turbopack 警告并让 `output: standalone` 把整个项目（含 `tests/`、`docs/`、`.env`、`.data`）
     trace 进 `.next/standalone`（实测 33.8 MB → 修复后 27.66 MB，且不再包含 `tests/`、`docs/` 与根目录脚本）。
  2. 新增 `SKIP_ENV_EXPORT=1` 开关：端到端测试刻意清空 `DATABASE_URL` 等变量来隔离真实数据，若不允许关闭，
     `.env.export` 会把它们补回来；`playwright.config.ts` 的 `webServer.env` 已设置该开关。
