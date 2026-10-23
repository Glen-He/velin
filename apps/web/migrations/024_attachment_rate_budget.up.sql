create table attachment_rate_budget (
  user_id text primary key references "user" (id) on delete cascade,
  window_start timestamptz not null default now(),
  attempts integer not null default 1 check (attempts > 0)
);
