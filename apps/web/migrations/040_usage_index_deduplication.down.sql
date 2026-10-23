create index chat_request_usage_user_time_idx on chat_request_usage (user_id, created_at desc);
