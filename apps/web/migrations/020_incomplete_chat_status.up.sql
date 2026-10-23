alter table chat_message drop constraint chat_message_status_check;
alter table chat_message add constraint chat_message_status_check
  check (status in ('streaming', 'completed', 'incomplete', 'failed', 'cancelled'));

alter table chat_request_usage drop constraint chat_request_usage_status_check;
alter table chat_request_usage add constraint chat_request_usage_status_check
  check (status in ('running', 'completed', 'incomplete', 'failed', 'cancelled'));
