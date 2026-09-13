// 统一 API 响应包装测试：成功/错误/未捕获异常三种结构。
import { describe, expect, it } from "vitest";

import { apiFail, apiOk, apiUnexpected } from "@/lib/api-response";

describe("apiOk", () => {
  it("返回 200 与统一成功结构", async () => {
    const response = apiOk({ code: "600519" });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { code: "600519" },
    });
  });

  it("支持自定义状态码", async () => {
    const response = apiOk({ ok: true }, { status: 201 });
    expect(response.status).toBe(201);
  });
});

describe("apiFail", () => {
  it("返回统一错误结构与 details", async () => {
    const response = apiFail("BAD_REQUEST", "参数错误", 400, { field: "code" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: { code: "BAD_REQUEST", message: "参数错误", details: { field: "code" } },
    });
  });

  it("默认状态码为 500", () => {
    expect(apiFail("INTERNAL_ERROR", "出错").status).toBe(500);
  });
});

describe("apiUnexpected", () => {
  it("Error 取 message，非 Error 回退默认文案", async () => {
    const fromError = apiUnexpected(new Error("连接失败"));
    expect(fromError.status).toBe(500);
    await expect(fromError.json()).resolves.toMatchObject({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "连接失败" },
    });

    await expect(apiUnexpected("字符串异常").json()).resolves.toMatchObject({
      error: { message: "未知错误" },
    });
  });
});
