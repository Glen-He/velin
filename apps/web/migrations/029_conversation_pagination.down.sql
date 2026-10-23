alter table chat_conversation drop constraint chat_conversation_user_order_unique;
alter table chat_conversation alter column sort_order set default 0;
drop sequence chat_conversation_sort_order_seq;
