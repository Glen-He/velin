create table chat_request_usage (
  request_id uuid primary key,
  user_id text not null references "user" (id) on delete cascade,
  model text not null,
  status text not null check (status in ('running', 'completed', 'failed', 'cancelled')),
  input_tokens integer,
  output_tokens integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index chat_request_usage_user_created_idx
  on chat_request_usage (user_id, created_at desc);

create index chat_request_usage_created_idx
  on chat_request_usage (created_at desc);
