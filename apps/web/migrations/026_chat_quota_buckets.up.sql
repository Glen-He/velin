create table chat_quota_day (
  subject text not null,
  day date not null,
  requests integer not null check (requests >= 0),
  primary key (subject, day)
);
insert into chat_quota_day (subject, day, requests)
  select user_id, (created_at at time zone 'UTC')::date, count(*)::int
  from chat_request_usage group by user_id, (created_at at time zone 'UTC')::date;
insert into chat_quota_day (subject, day, requests)
  select '', (created_at at time zone 'UTC')::date, count(*)::int
  from chat_request_usage group by (created_at at time zone 'UTC')::date;
create index chat_request_usage_running_user_idx on chat_request_usage (user_id, created_at) where status = 'running';
create index chat_request_usage_user_time_idx on chat_request_usage (user_id, created_at desc);
