create table chat_document_index (
  attachment_id uuid primary key references chat_attachment(id) on delete cascade,
  indexed_at timestamptz not null default now()
);
alter table chat_message add column reasoning_effort text;
