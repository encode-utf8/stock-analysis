# data-service

个股与基金行情数据侧车（FastAPI），Web 端通过 `DATA_SERVICE_URL` 调用，默认 `http://127.0.0.1:8000`。

## 环境准备

推荐使用项目专属 conda 环境：

```bash
conda env create -n stock-analysis -f data-service/environment.yml
conda activate stock-analysis
```

也可以按 `data-service/pyproject.toml` 安装依赖（fastapi、uvicorn、pydantic-settings、akshare、pandas、curl_cffi、py-mini-racer）。其中 AkShare 与 py-mini-racer 缺失时不影响腾讯实时行情与确定性回退数据。

## 启动

```bash
conda activate stock-analysis
uvicorn app.main:app --reload --app-dir data-service --host 127.0.0.1 --port 8000
```

或在仓库根目录执行：

```bash
pnpm dev:data
```

## 健康检查

```bash
curl http://127.0.0.1:8000/health
```

## 已实现接口

行情与市场：

- `GET /health`：存活探针。
- `GET /quote?code=600519`：单只行情快照（最新价、涨跌幅、开高低收、量额、换手率、PE/PB、市值）。
- `GET /quotes?codes=600519,000001`：批量行情，供自选池与实时推送使用。
- `GET /quote/verify?code=600519`：代码存在性校验，返回 `ok` / `not_found` / `upstream_unavailable` 三态结论与上游名称。
- `GET /kline?code=600519&period=day&adjust=qfq&limit=120`：K 线，支持 `minute/day/week/month` 与 `qfq/hfq/none`。
- `GET /index/quote?codes=sh000001,sz399001,sz399006`：大盘指数快照。
- `GET /index/kline?code=sh000001&limit=60`：指数 K 线（含成交额 `amount`）。
- `GET /market/breadth[?date=YYYY-MM-DD]`：全市场涨跌家数；带 `date` 时按历史日期回补。
- `GET /market/sectors?limit=5[&date=YYYY-MM-DD][&history=1]`：行业板块涨跌榜；带 `date` 走历史回补，`history=1` 强制同花顺历史口径并返回 `comparison` 轮动块。
- `GET /trading-calendar?start=YYYY-MM-DD&end=YYYY-MM-DD`：AkShare 交易日历，供预警判定与日报探测共用。

基金（统一前缀 `/fund`）：

- `GET /fund/profile?code=110022`：基金档案与类型/交易模式识别。
- `GET /fund/verify?code=110022`：基金代码存在性校验（三态结论）。
- `GET /fund/nav?code=110022&start=YYYY-MM-DD&end=YYYY-MM-DD&nav_type=unit`：区间历史净值，`nav_type` 支持 `unit/cumulative`。
- `GET /fund/intraday?code=110022`：场内实时价 / 场外盘中估算净值与涨跌幅。
- `GET /fund/holdings?code=110022`：基金前十大持仓（季度报告口径）。

## 降级约定

- AkShare 未安装或接口失败时自动降级为确定性数据，并标记 `source=deterministic-fallback`。
- Web 端在做估值、预警与日报时会识别该标记并跳过，不会把演示数据当成真实行情展示。
