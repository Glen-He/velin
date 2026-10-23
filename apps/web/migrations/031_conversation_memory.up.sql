alter table chat_conversation add column context_revision bigint not null default 1;
alter table chat_message add column active boolean not null default true;
create index chat_message_active_sequence_idx on chat_message (conversation_id, sequence) where active;

create table chat_context_summary (
  conversation_id uuid primary key references chat_conversation(id) on delete cascade,
  revision bigint not null,
  through_sequence bigint not null,
  content text not null,
  updated_at timestamptz not null default now()
);

create table chat_branch (
  id uuid primary key,
  conversation_id uuid not null references chat_conversation(id) on delete cascade,
  anchor_id uuid not null references chat_message(id) on delete cascade,
  anchor_content text not null,
  message_ids uuid[] not null,
  title text not null,
  created_at timestamptz not null default now()
);
create index chat_branch_conversation_idx on chat_branch(conversation_id, created_at desc);

create table chat_memory_preference (
  user_id text primary key references "user"(id) on delete cascade,
  enabled boolean not null default true,
  epoch bigint not null default 1,
  forget_before timestamptz not null default '-infinity'
);
create table chat_memory (
  id uuid primary key,
  user_id text not null references "user"(id) on delete cascade,
  topic text not null,
  content text not null,
  source_message_id uuid references chat_message(id) on delete cascade,
  source_conversation_id uuid references chat_conversation(id) on delete cascade,
  source_quote text,
  origin text not null check (origin in ('manual', 'automatic')),
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, topic)
);
create index chat_memory_owner_idx on chat_memory(user_id, updated_at desc);
create table chat_memory_suppression (
  user_id text not null references "user"(id) on delete cascade,
  source_message_id uuid not null references chat_message(id) on delete cascade,
  topic text not null,
  primary key(user_id, source_message_id, topic)
);
create table chat_document_chunk (
  attachment_id uuid not null references chat_attachment(id) on delete cascade,
  position integer not null,
  page integer,
  content text not null,
  terms text[] not null,
  primary key(attachment_id, position)
);
create index chat_document_chunk_terms_idx on chat_document_chunk using gin(terms);
alter table chat_message add column context_metadata jsonb;
alter table chat_request_usage add column context_input_tokens integer;
alter table chat_request_usage add column context_output_tokens integer;
