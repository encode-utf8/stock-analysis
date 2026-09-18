# 行情与基金数据侧车镜像（FastAPI）。
# akshare 单独一层容错安装：装不上只告警，与 start.* 的本机行为一致
# （缺 akshare 时降级到腾讯实时行情与确定性回退数据）。
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1
ENV PIP_DISABLE_PIP_VERSION_CHECK=1
ENV PIP_NO_CACHE_DIR=1
ENV TZ=Asia/Shanghai

# 国内网络默认走清华 PyPI 镜像；需要时用
# --build-arg PIP_INDEX_URL=https://pypi.org/simple 覆盖。
ARG PIP_INDEX_URL=https://pypi.tuna.tsinghua.edu.cn/simple

RUN apt-get update \
    && apt-get install -y --no-install-recommends tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 必需依赖：侧车启动、实时行情与基金估值的基础。
RUN pip install --index-url "$PIP_INDEX_URL" \
    "fastapi>=0.115" \
    "uvicorn[standard]>=0.30" \
    "pydantic-settings>=2.6" \
    "curl_cffi>=0.10" \
    "pandas>=2.2"

# 可选依赖：AkShare 全市场数据源，安装失败不影响侧车启动。
RUN pip install --index-url "$PIP_INDEX_URL" "akshare>=1.16" "py-mini-racer>=0.6" \
    || echo "[warn] AkShare 安装失败，侧车将降级到腾讯实时行情与确定性回退数据。"

COPY app ./app

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
