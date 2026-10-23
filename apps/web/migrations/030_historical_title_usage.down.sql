update chat_request_usage set title_status = 'not_requested' where title_status = 'unknown';
alter table chat_request_usage drop constraint chat_request_usage_title_status_check;
alter table chat_request_usage add constraint chat_request_usage_title_status_check
  check (title_status in ('not_requested', 'running', 'completed', 'failed'));
