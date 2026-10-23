alter table chat_attachment
  add column status text not null default 'ready'
    check (status in ('processing', 'ready', 'failed', 'canceled')),
  add column page_count integer check (page_count is null or page_count > 0),
  add column ocr_page_range text,
  add column ocr_completed_pages integer not null default 0
    check (ocr_completed_pages >= 0),
  add column ocr_error text,
  add column ocr_cancel_requested boolean not null default false;

create table chat_attachment_source (
  attachment_id uuid primary key references chat_attachment (id) on delete cascade,
  user_id text not null references "user" (id) on delete cascade,
  sha256 text not null,
  data bytea not null,
  created_at timestamptz not null default now()
);

create index chat_attachment_source_user_hash_idx
  on chat_attachment_source (user_id, sha256);

create table chat_attachment_page (
  attachment_id uuid not null references chat_attachment (id) on delete cascade,
  page_number integer not null check (page_number > 0),
  source text not null check (source in ('text', 'ocr', 'empty')),
  text_content text not null default '',
  confidence double precision
    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  updated_at timestamptz not null default now(),
  primary key (attachment_id, page_number)
);

create table chat_pdf_page_cache (
  user_id text not null references "user" (id) on delete cascade,
  sha256 text not null,
  engine_version text not null,
  page_number integer not null check (page_number > 0),
  source text not null check (source in ('text', 'ocr', 'empty')),
  text_content text not null default '',
  confidence double precision
    check (confidence is null or (confidence >= 0 and confidence <= 100)),
  updated_at timestamptz not null default now(),
  primary key (user_id, sha256, engine_version, page_number)
);
