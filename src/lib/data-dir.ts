// 本地数据目录：所有运行期落盘（自选、持仓、预警、日报、背景设置等）都经过这里。
// 默认是「进程工作目录/.data」；设置 DATA_ROOT 可整体切换数据根目录，
// 供单元测试与浏览器端到端用例指向临时目录，避免污染本机真实数据。
import path from "node:path";

/** 降级数据目录名（固定为 .data）。 */
export const DATA_DIR_NAME = ".data";

/** 本地数据根目录：默认进程工作目录；DATA_ROOT 有值时以它为准，相对路径按工作目录解析。 */
export function dataRootDir(): string {
  const override = process.env.DATA_ROOT?.trim();
  return override ? path.resolve(override) : process.cwd();
}

/** 本地降级数据目录：<数据根目录>/.data。 */
export function dataDir(): string {
  return path.join(dataRootDir(), DATA_DIR_NAME);
}

/** 拼接降级数据目录下的路径，例如 dataPath("watchlist.json")。 */
export function dataPath(...segments: string[]): string {
  return path.join(dataDir(), ...segments);
}
