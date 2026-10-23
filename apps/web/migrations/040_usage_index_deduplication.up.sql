-- 026 与 002 建立了相同的用户/时间索引，保留原索引，避免每次预留双重维护。
drop index chat_request_usage_user_time_idx;
