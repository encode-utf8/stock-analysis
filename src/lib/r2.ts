// Cloudflare R2 对象存储封装：用于保存分析快照、资讯原文与历史追溯文件。
// 使用 S3 兼容接口；密钥只从环境变量读取，不落库、不提交。

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { recordExternalCall } from "@/lib/observability";
import type { AnalysisReport, FundAnalysisReport, NewsItem } from "@/lib/shared/types";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

let client: S3Client | null = null;

/** R2 快照写入硬超时，避免远端对象存储不可达时阻塞主流程。 */
const SNAPSHOT_TIMEOUT_MS = 3_000;

/** 给 Promise 增加硬超时；超时后仅停止等待，不取消底层网络请求。 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`R2 操作超时（${timeoutMs / 1000} 秒）`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** 校验并读取 R2 配置；缺失或格式错误时抛出明确错误。 */
function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID ?? "";
  const accessKeyId = process.env.R2_ACCESS_KEY_ID ?? "";
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY ?? "";
  const bucket = process.env.R2_BUCKET_NAME ?? "";
  const publicUrl = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");

  if (!/^[0-9a-f]{32}$/i.test(accountId)) {
    throw new Error("R2_ACCOUNT_ID 应为 32 位十六进制 Cloudflare 账户 ID。");
  }
  if (!/^[0-9a-f]{32}$/i.test(accessKeyId)) {
    throw new Error("R2_ACCESS_KEY_ID 应为 32 位十六进制 Access Key ID。");
  }
  if (!/^[0-9a-f]{64}$/i.test(secretAccessKey)) {
    throw new Error("R2_SECRET_ACCESS_KEY 应为 64 位十六进制 Secret Access Key。");
  }
  if (!bucket) {
    throw new Error("R2_BUCKET_NAME 未配置。");
  }

  return { accountId, accessKeyId, secretAccessKey, bucket, publicUrl };
}

/** 判断 R2 是否已完整、合法配置。 */
export function isR2Configured(): boolean {
  try {
    getR2Config();
    return true;
  } catch {
    return false;
  }
}

/** 获取复用的 S3 客户端。 */
function getClient(): S3Client {
  if (client) {
    return client;
  }
  const config = getR2Config();
  client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  return client;
}

/** 生成公开访问地址；未配置公开域名时返回对象键。 */
function buildPublicUrl(key: string): string {
  const publicUrl = (process.env.R2_PUBLIC_URL ?? "").replace(/\/$/, "");
  return publicUrl ? `${publicUrl}/${key}` : key;
}

/** 写入 JSON 对象，返回对象键和公开地址。 */
export async function putJsonObject(
  key: string,
  value: unknown,
): Promise<{ key: string; url: string }> {
  const config = getR2Config();
  const clientInstance = getClient();
  await clientInstance.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: JSON.stringify(value),
      ContentType: "application/json",
    }),
  );
  recordExternalCall(true);
  return { key, url: buildPublicUrl(key) };
}

/** 读取 JSON 对象；不存在时返回 null。 */
export async function getJsonObject<T>(key: string): Promise<T | null> {
  const config = getR2Config();
  const clientInstance = getClient();
  try {
    const output = await clientInstance.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    recordExternalCall(true);
    const body = await output.Body?.transformToString();
    return body ? (JSON.parse(body) as T) : null;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NoSuchKey" || name === "NotFound") {
      return null;
    }
    recordExternalCall(false);
    throw error;
  }
}

/** 判断对象是否存在。 */
export async function objectExists(key: string): Promise<boolean> {
  const config = getR2Config();
  const clientInstance = getClient();
  try {
    await clientInstance.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
    recordExternalCall(true);
    return true;
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "NotFound" || name === "NoSuchKey") {
      return false;
    }
    recordExternalCall(false);
    throw error;
  }
}

/** 删除指定对象。 */
export async function deleteObject(key: string): Promise<void> {
  const config = getR2Config();
  const clientInstance = getClient();
  await clientInstance.send(
    new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
  );
  recordExternalCall(true);
}

/** 保存分析报告快照到 R2；失败时返回 null，不阻塞主流程。 */
export async function saveAnalysisSnapshot(report: AnalysisReport): Promise<string | null> {
  if (!isR2Configured()) {
    return null;
  }
  try {
    const key = `analysis/${report.code}/${report.id}.json`;
    await withTimeout(putJsonObject(key, report), SNAPSHOT_TIMEOUT_MS);
    return key;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 保存基金 AI 分析报告快照到 R2；失败时返回 null，不阻塞主流程。 */
export async function saveFundAnalysisSnapshot(report: FundAnalysisReport): Promise<string | null> {
  if (!isR2Configured()) {
    return null;
  }
  try {
    const key = `fund-analysis/${report.code}/${report.id}.json`;
    await withTimeout(putJsonObject(key, report), SNAPSHOT_TIMEOUT_MS);
    return key;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 保存资讯原始结果快照到 R2；失败时返回 null，不阻塞主流程。 */
export async function saveNewsSnapshot(code: string, items: NewsItem[]): Promise<string | null> {
  if (!isR2Configured()) {
    return null;
  }
  try {
    const key = `news/${code}/${Date.now()}.json`;
    await withTimeout(putJsonObject(key, items), SNAPSHOT_TIMEOUT_MS);
    return key;
  } catch {
    recordExternalCall(false);
    return null;
  }
}

/** 为 R2 操作提供统一的硬超时包装，避免远端不可达时阻塞调用方。 */
export function withR2Timeout<T>(
  promise: Promise<T>,
  timeoutMs = SNAPSHOT_TIMEOUT_MS,
): Promise<T> {
  return withTimeout(promise, timeoutMs);
}

/** 按前缀列举对象键；自动翻页，单次前缀最多返回 5000 个键。 */
export async function listJsonObjects(prefix: string): Promise<string[]> {
  const config = getR2Config();
  const clientInstance = getClient();
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const output = await withTimeout(
      clientInstance.send(
        new ListObjectsV2Command({
          Bucket: config.bucket,
          Prefix: prefix,
          ContinuationToken: token,
          MaxKeys: 1000,
        }),
      ),
      SNAPSHOT_TIMEOUT_MS,
    );
    for (const item of output.Contents ?? []) {
      if (item.Key) {
        keys.push(item.Key);
      }
    }
    token = output.IsTruncated ? output.NextContinuationToken : undefined;
    if (keys.length >= 5000) {
      break;
    }
  } while (token);

  recordExternalCall(true);
  return keys;
}