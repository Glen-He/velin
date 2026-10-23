alter table chat_request_usage drop constraint chat_request_usage_title_status_check;
alter table chat_request_usage add constraint chat_request_usage_title_status_check
  check (title_status in ('unknown', 'not_requested', 'running', 'completed', 'failed'));
-- 历史调用没有独立标题账本，不能把缺失记录解释成从未调用。
update chat_request_usage set title_status = 'unknown' where title_status = 'not_requested';
