// 数据源健康探测：外部依赖挂起时必须在预算内返回「离线 + 探测超时」，
// 否则面板会一直等到请求超时（R2 探测曾因缺少超时导致面板长期报「请求超时」）。
import { afterEach, describe, expect, it, vi } from "vitest";

// R2 探测永不返回：模拟对象存储网络不可达时 S3 HeadObject 挂起。
vi.mock("@/lib/r2", () => ({
  isR2Configured: () => true,
  objectExists: () => new Promise<boolean>(() => {}),
}));

describe("数据源健康探测超时保护", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("R2 挂起时仍能在预算内返回离线状态与超时原因", async () => {
    vi.stubEnv("DATA_SOURCE_PROBE_TIMEOUT_MS", "200");
    vi.stubEnv("DATA_SOURCE_SNAPSHOT_BUDGET_MS", "1000");
    // 本用例只验证探测超时：置空数据库连接，避免并行跑测试时被数据库兜底耗时干扰。
    vi.stubEnv("DATABASE_URL", "");
    const { getDataSourceHealthSnapshot } = await import("@/lib/datasource-health");

    const started = Date.now();
    const snapshot = await getDataSourceHealthSnapshot();
    const elapsed = Date.now() - started;

    // 五个数据源一个都不能少，挂起的 R2 按离线 + 超时原因返回。
    expect(snapshot.sources.map((source) => source.source)).toEqual([
      "AkShare/Tencent",
      "AkShare/基金",
      "Tavily",
      "DeepSeek",
      "R2",
    ]);
    const r2 = snapshot.sources.find((source) => source.source === "R2");
    expect(r2?.state).toBe("offline");
    expect(r2?.message ?? "").toContain("探测超时");
    // 预算 200ms + 调度任务查询（store 侧最多 2 秒兜底），不会退化成数十秒挂起。
    expect(elapsed).toBeLessThan(3_000);
  }, 20_000);
});