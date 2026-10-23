update chat_message set status = 'failed' where status = 'incomplete';
update chat_request_usage set status = 'failed' where status = 'incomplete';
alter table chat_message drop constraint chat_message_status_check;
alter table chat_message add constraint chat_message_status_check
  check (status in ('streaming', 'completed', 'failed', 'cancelled'));
alter table chat_request_usage drop constraint chat_request_usage_status_check;
alter table chat_request_usage add constraint chat_request_usage_status_check
  check (status in ('running', 'completed', 'failed', 'cancelled'));
