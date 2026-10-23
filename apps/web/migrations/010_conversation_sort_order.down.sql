drop index if exists chat_conversation_user_sort_idx;
alter table chat_conversation drop column sort_order;
