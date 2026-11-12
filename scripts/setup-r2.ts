// =============================================================
// R2 Setup Script — chay 1 lan khi trien khai:
//   bun run scripts/setup-r2.ts
//
// 1. Kiem tra / tao bucket
// 2. Cau hinh CORS (can thiet cho presigned upload truc tiep tu browser)
//    — neu token khong du quyen thi in huong dan dashboard
// 3. Roundtrip test: presign PUT -> upload -> presign GET -> verify -> delete
// =============================================================

import {
  headBucket,
  createBucketIfMissing,
  putBucketCors,
  getBucketCors,
  presignPut,
  presignGet,
  deleteObjects,
} from "../src/lib/r2";
import { getEnv } from "../src/lib/env";

async function main() {
  const env = getEnv();
  console.log("=== TSUNDOKU R2 Setup ===");
  console.log(`Endpoint : ${env.r2.endpoint}`);
  console.log(`Bucket   : ${env.r2.bucket}`);
  console.log("");

  // 1) Bucket
  const exists = await headBucket();
  if (exists) {
    console.log("[1/4] Bucket ton tai: OK");
  } else {
    console.log("[1/4] Bucket khong ton tai -> dang tao...");
    const created = await createBucketIfMissing();
    console.log(`[1/4] Bucket: ${created === "created" ? "DA TAO" : "da ton tai"}`);
  }

  // 2) CORS — cho phep browser PUT truc tiep bang presigned URL
  const allowedOrigins = (process.env.R2_ALLOWED_ORIGINS ?? "*").split(",").map((s) => s.trim());
  try {
    await putBucketCors(allowedOrigins);
    const cors = await getBucketCors();
    console.log(`[2/4] CORS da cau hinh (origins: ${allowedOrigins.join(", ")}):`, JSON.stringify(cors));
  } catch (err) {
    console.log("[2/4] KHONG the cau hinh CORS qua API (token thieu quyen bucket-level).");
    console.log("     -> Ung dung van hoat dong: upload tu dong chuyen qua che do proxy server.");
    console.log("     -> De bat upload truc tiep ( nhanh hon, khong gioi han kich thuoc ):");
    console.log("        Cloudflare Dashboard > R2 > bucket '" + env.r2.bucket + "' > Settings > CORS Policy, them:");
    console.log(JSON.stringify({
      AllowedOrigins: allowedOrigins,
      AllowedMethods: ["GET", "PUT", "HEAD"],
      AllowedHeaders: ["*"],
      ExposeHeaders: ["ETag"],
      MaxAgeSeconds: 3600,
    }, null, 2));
    void err;
  }

  // 3) Roundtrip test presigned PUT/GET (object-level permission)
  const testKey = `_setup-test/roundtrip-${Date.now()}.txt`;
  const testContent = `tsundoku-r2-roundtrip-${Date.now()}`;
  const putUrl = await presignPut({
    key: testKey,
    contentType: "text/plain",
    expiresIn: 300,
  });
  const putRes = await fetch(putUrl, {
    method: "PUT",
    body: testContent,
    headers: { "Content-Type": "text/plain" },
  });
  if (!putRes.ok) {
    throw new Error(`Roundtrip PUT that bai: ${putRes.status} ${await putRes.text()}`);
  }
  console.log("[3/4] Presigned PUT (object): OK");

  const getUrl = await presignGet(testKey, 300);
  const getRes = await fetch(getUrl);
  const body = await getRes.text();
  if (!getRes.ok || body !== testContent) {
    throw new Error(`Roundtrip GET that bai: ${getRes.status}`);
  }
  console.log("[3/4] Presigned GET (object): OK (noi dung khop)");

  // 4) Cleanup
  const del = await deleteObjects([testKey]);
  if (del.errors.length > 0) {
    console.warn("[4/4] Cleanup canh bao:", del.errors);
  } else {
    console.log("[4/4] Cleanup test object: OK");
  }

  console.log("");
  console.log("=> R2 SAN SANG. Bucket private, truy cap object qua presigned URL co han.");
}

main().catch((err) => {
  console.error("R2 SETUP THAT BAI:", err);
  process.exit(1);
});
