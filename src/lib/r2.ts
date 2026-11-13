// =============================================================
// Cloudflare R2 Storage Service (S3-compatible, PRIVATE bucket)
// - Presigned PUT (upload truc tiep tu browser)
// - Presigned GET (doc anh co thoi han, KHONG luu vao DB)
// - Delete/Copy/List cho quan ly & cleanup file mo coi
// =============================================================

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectsCommand,
  CopyObjectCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateBucketCommand,
  GetBucketCorsCommand,
  PutBucketCorsCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getEnv } from "@/lib/env";

let cachedClient: S3Client | null = null;

export function r2(): S3Client {
  if (cachedClient) return cachedClient;
  const env = getEnv();
  if (!env.r2.accessKeyId || !env.r2.secretAccessKey || !env.r2.endpoint) {
    throw new Error("[r2] Cấu hình R2 chưa đầy đủ (kiểm tra các biến R2_* trong .env)");
  }
  cachedClient = new S3Client({
    region: "auto",
    endpoint: env.r2.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.r2.accessKeyId,
      secretAccessKey: env.r2.secretAccessKey,
    },
  });
  return cachedClient;
}

function bucket(): string {
  const b = getEnv().r2.bucket;
  if (!b) throw new Error("[r2] R2_BUCKET_NAME chưa được cấu hình trong .env");
  return b;
}

// ---------------- Object keys ---------------------------------

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export function extFromMime(mime: string): string | null {
  return IMAGE_EXT[mime.toLowerCase()] ?? null;
}

function rand(len: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export function pageObjectKey(mangaId: string, chapterId: string, seq: number, ext: string): string {
  return `mangas/${mangaId}/chapters/${chapterId}/p${String(seq).padStart(4, "0")}-${rand(8)}.${ext}`;
}

export function coverObjectKey(mangaId: string, ext: string): string {
  return `mangas/${mangaId}/covers/cover-${rand(8)}.${ext}`;
}

// ---------------- Presigned URLs ------------------------------

/** Presigned PUT — upload truc tiep browser -> R2. Ky ca Content-Length de chot dung luong. */
export async function presignPut(params: {
  key: string;
  contentType: string;
  contentLength?: number;
  expiresIn?: number;
}): Promise<string> {
  const cmd = new PutObjectCommand({
    Bucket: bucket(),
    Key: params.key,
    ContentType: params.contentType,
    ...(params.contentLength ? { ContentLength: params.contentLength } : {}),
    CacheControl: "private, max-age=604800",
  });
  return getSignedUrl(r2(), cmd, { expiresIn: params.expiresIn ?? 15 * 60 });
}

/** Presigned GET — doc anh co han. KHONG bao gio luu URL nay vao DB. */
export async function presignGet(key: string, expiresIn?: number): Promise<string> {
  const env = getEnv();
  const cmd = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(r2(), cmd, { expiresIn: expiresIn ?? env.signedUrlExpiry });
}

export async function presignGetMany(keys: string[], expiresIn?: number): Promise<string[]> {
  return Promise.all(keys.map((k) => presignGet(k, expiresIn)));
}

// ---------------- Object operations ---------------------------

export async function deleteObjects(keys: string[]): Promise<{
  deleted: number;
  /** Danh sach key da duoc xac nhan XOA (hoac khong ton tai — S3 delete la idempotent). */
  deletedKeys: string[];
  /** Key xoa that bai kem ly do. */
  errors: string[];
}> {
  let deleted = 0;
  const deletedKeys: string[] = [];
  const errors: string[] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (chunk.length === 0) continue;
    const res = await r2().send(
      new DeleteObjectsCommand({
        Bucket: bucket(),
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: false },
      })
    );
    // Quiet=false de nhan duoc danh sach key da xoa (S3 delete idempotent:
    // key khong ton tai van duoc bao "Deleted" -> an toan de go bo metadata)
    deleted += res.Deleted?.length ?? 0;
    for (const d of res.Deleted ?? []) {
      if (d.Key) deletedKeys.push(d.Key);
    }
    for (const err of res.Errors ?? []) {
      errors.push(`${err.Key}: ${err.Message ?? "unknown"}`);
    }
  }
  return { deleted, deletedKeys, errors };
}

export async function copyObject(srcKey: string, destKey: string, contentType?: string): Promise<void> {
  await r2().send(
    new CopyObjectCommand({
      Bucket: bucket(),
      CopySource: `/${bucket()}/${encodeURI(srcKey)}`,
      Key: destKey,
      ...(contentType ? { ContentType: contentType, MetadataDirective: "REPLACE" } : {}),
    })
  );
}

export async function headObject(key: string): Promise<{ contentLength: number; contentType?: string } | null> {
  try {
    const res = await r2().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
    return {
      contentLength: res.ContentLength ?? 0,
      contentType: res.ContentType ?? undefined,
    };
  } catch {
    return null;
  }
}

export interface ListPage {
  keys: string[];
  sizes: number[];
  continuationToken?: string;
  truncated: boolean;
}

/** List object keys (phan trang) — dung cho audit storage */
export async function listObjectsPage(opts: {
  prefix?: string;
  continuationToken?: string;
  maxKeys?: number;
}): Promise<ListPage> {
  const res = await r2().send(
    new ListObjectsV2Command({
      Bucket: bucket(),
      Prefix: opts.prefix,
      ContinuationToken: opts.continuationToken,
      MaxKeys: opts.maxKeys ?? 1000,
    })
  );
  return {
    keys: (res.Contents ?? []).map((o) => o.Key ?? "").filter(Boolean),
    sizes: (res.Contents ?? []).map((o) => o.Size ?? 0),
    continuationToken: res.IsTruncated ? res.NextContinuationToken : undefined,
    truncated: Boolean(res.IsTruncated),
  };
}

// ---------------- Bucket admin (setup script) ------------------

export async function headBucket(): Promise<boolean> {
  try {
    await r2().send(new HeadBucketCommand({ Bucket: bucket() }));
    return true;
  } catch (err: unknown) {
    const name = (err as { name?: string }).name ?? "";
    if (name === "NotFound" || name === "NoSuchBucket") return false;
    throw err;
  }
}

export async function createBucketIfMissing(): Promise<"exists" | "created"> {
  if (await headBucket()) return "exists";
  await r2().send(new CreateBucketCommand({ Bucket: bucket() }));
  return "created";
}

export async function putBucketCors(allowedOrigins: string[]): Promise<void> {
  await r2().send(
    new PutBucketCorsCommand({
      Bucket: bucket(),
      CORSConfiguration: {
        CORSRules: [
          {
            AllowedOrigins: allowedOrigins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
          },
        ],
      },
    })
  );
}

export async function getBucketCors(): Promise<unknown> {
  try {
    const res = await r2().send(new GetBucketCorsCommand({ Bucket: bucket() }));
    return res.CORSRules ?? [];
  } catch {
    return null;
  }
}
