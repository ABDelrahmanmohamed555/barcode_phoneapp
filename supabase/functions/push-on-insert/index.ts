// supabase/functions/push-on-insert — Edge Function تبعت FCM عند إضافة منتج جديد
// تُستدعى تلقائياً عند INSERT في products عبر Database Webhook

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// متغيرات البيئة — ضعها في Supabase Dashboard → Edge Functions → Secrets
// FIREBASE_SERVICE_ACCOUNT = محتوى firebase-private-key.json كـ JSON string
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY متوفرة تلقائياً

const FIREBASE_SERVICE_ACCOUNT = Deno.env.get("FIREBASE_SERVICE_ACCOUNT") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

async function getAccessToken(): Promise<string> {
  if (!FIREBASE_SERVICE_ACCOUNT) throw new Error("FIREBASE_SERVICE_ACCOUNT not set");
  const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
  const header = { alg: "RS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  const b64 = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const unsigned = `${b64(header)}.${b64(payload)}`;
  // توقيع RSA
  const key = sa.private_key;
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToArrayBuffer(key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", cryptoKey, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${arrayBufferToBase64(sig)}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await res.json();
  if (!j.access_token) throw new Error("Failed to get access token: " + JSON.stringify(j));
  return j.access_token;
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem.replace(/-----.*-----/g, "").replace(/\s/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}
function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    // body من webhook يحتوي {record: {name, price, ...}, type: "INSERT"}
    const record = body.record || body.new || body;
    const productName = record?.name || "منتج جديد";
    const productPrice = record?.price ? `${record.price} جنيه` : "";

    // جلب كل التوكنات
    const supaRes = await fetch(`${SUPABASE_URL}/rest/v1/fcm_tokens?select=token`, {
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    const tokens: { token: string }[] = await supaRes.json();
    if (!Array.isArray(tokens) || tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, msg: "no tokens" }), { headers: { "Content-Type": "application/json" } });
    }

    const accessToken = await getAccessToken();
    const sa = JSON.parse(FIREBASE_SERVICE_ACCOUNT);
    const projectId = sa.project_id;

    let sent = 0, failed = 0;
    for (const { token } of tokens) {
      try {
        const fcmRes = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: token,
              notification: {
                title: "منتج جديد ✓",
                body: `${productName} ${productPrice}`.trim(),
              },
              data: {
                name: String(productName),
                price: String(record?.price || ""),
                barcode: String(record?.barcode || ""),
                click_action: "FLUTTER_NOTIFICATION_CLICK",
              },
              android: {
                priority: "HIGH",
                notification: {
                  icon: "ic_notification",
                  color: "#c8943a",
                  channelId: "new-products",
                },
              },
            },
          }),
        });
        if (fcmRes.ok) sent++;
        else {
          failed++;
          const txt = await fcmRes.text();
          console.log("FCM fail", token.slice(0,10), txt.slice(0,200));
          // لو التوكن منتهي، احذفه
          if (txt.includes("NOT_FOUND") || txt.includes("INVALID_ARGUMENT")) {
            await fetch(`${SUPABASE_URL}/rest/v1/fcm_tokens?token=eq.${encodeURIComponent(token)}`, {
              method: "DELETE",
              headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            });
          }
        }
      } catch (e) {
        failed++;
        console.log("FCM error", e);
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, failed, total: tokens.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
