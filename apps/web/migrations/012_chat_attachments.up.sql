create table chat_attachment (
  id uuid primary key,
  user_id text not null references "user" (id) on delete cascade,
  message_id uuid references chat_message (id) on delete cascade,
  name text not null,
  mime_type text not null,
  size_bytes integer not null check (size_bytes >= 0),
  text_content text not null,
  created_at timestamptz not null default now()
);

create index chat_attachment_user_created_idx
  on chat_attachment (user_id, created_at desc);

create index chat_attachment_message_idx
  on chat_attachment (message_id)
  where message_id is not null;
