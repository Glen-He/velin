create table chat_conversation (
  id uuid primary key,
  user_id text not null references "user" (id) on delete cascade,
  title text not null,
  model text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_conversation_user_updated_idx
  on chat_conversation (user_id, updated_at desc);

create table chat_message (
  id uuid primary key,
  sequence bigint generated always as identity unique,
  conversation_id uuid not null references chat_conversation (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  status text not null check (status in ('streaming', 'completed', 'failed', 'cancelled')),
  request_id uuid unique,
  model text,
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chat_message_conversation_sequence_idx
  on chat_message (conversation_id, sequence);
