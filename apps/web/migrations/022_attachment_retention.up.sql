alter table chat_attachment add column source_sha256 text;
update chat_attachment a set source_sha256 = s.sha256
from chat_attachment_source s where s.attachment_id = a.id;
create index chat_attachment_source_hash_idx on chat_attachment (user_id, source_sha256)
  where source_sha256 is not null;

-- 旧缓存没有可证明的附件引用；仅清理派生缓存，保留消息与附件原文。
delete from chat_pdf_page_cache c where not exists (
  select 1 from chat_attachment a where a.user_id = c.user_id and a.source_sha256 = c.sha256
);
create table service_heartbeat (
  service text primary key,
  updated_at timestamptz not null default now()
);
