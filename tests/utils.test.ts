// 类名合并工具测试：验证 clsx 条件合并与 tailwind-merge 冲突消解。
import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("合并条件类名并忽略假值", () => {
    expect(cn("text-sm", false, undefined, null, ["font-bold"])).toBe("text-sm font-bold");
    expect(cn()).toBe("");
  });

  it("后写的同类 Tailwind 类名覆盖先写的", () => {
    expect(cn("px-2 py-1", "px-4")).toBe("py-1 px-4");
    expect(cn("text-red-500", { "text-blue-500": true, "text-green-500": false })).toBe(
      "text-blue-500",
    );
  });
});
