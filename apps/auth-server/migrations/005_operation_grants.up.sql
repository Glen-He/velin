create table security_operation_grant (
  id uuid primary key,
  user_id text not null references "user" (id) on delete cascade,
  session_id text not null references "session" (id) on delete cascade,
  operation text not null,
  target text not null default '',
  method text not null,
  created_at timestamptz not null default CURRENT_TIMESTAMP,
  expires_at timestamptz not null
);
create index security_operation_grant_session_idx on security_operation_grant (session_id);
create index security_operation_grant_expiry_idx on security_operation_grant (expires_at);
