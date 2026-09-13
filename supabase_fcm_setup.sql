-- supabase_fcm_setup.sql — شغّله مرة واحدة في Supabase SQL Editor
-- ينشئ جدول fcm_tokens لتخزين توكنات الأجهزة

-- 1) جدول التوكنات
create table if not exists public.fcm_tokens (
  token text primary key,
  device_id text not null,
  platform text not null default 'android', -- android | web
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- فهرس للبحث السريع
create index if not exists idx_fcm_tokens_device on public.fcm_tokens(device_id);
create index if not exists idx_fcm_tokens_platform on public.fcm_tokens(platform);

-- تفعيل RLS + سياسة سماح كامل (service_role يتجاوزها، anon يحتاجها)
alter table public.fcm_tokens enable row level security;

drop policy if exists "Allow all for service_role" on public.fcm_tokens;
create policy "Allow all for service_role" on public.fcm_tokens
  for all using (true) with check (true);

drop policy if exists "Allow anon all" on public.fcm_tokens;
create policy "Allow anon all" on public.fcm_tokens
  for all using (true) with check (true);

-- 2) تأكد أن Realtime مفعل لجدول products (للمزامنة اللحظية)
-- في Dashboard → Database → Realtime → فعّل products

-- 3) اختبار: أدخل توكن وهمي
-- insert into fcm_tokens(token, device_id, platform) values ('test_token_123', 'dev_test', 'android');

-- 4) عرض التوكنات
-- select * from fcm_tokens order by updated_at desc;

-- ملاحظة: Edge Function سترسل push لكل توكن عند INSERT في products
-- لا تحذف هذا الجدول — FCMManager يعتمد عليه
