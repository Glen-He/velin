alter table chat_conversation add column sort_order bigint;

update chat_conversation
set sort_order = (extract(epoch from updated_at) * 1000)::bigint;

alter table chat_conversation alter column sort_order set not null;
alter table chat_conversation alter column sort_order set default 0;

create index chat_conversation_user_sort_idx
  on chat_conversation (user_id, sort_order desc);
