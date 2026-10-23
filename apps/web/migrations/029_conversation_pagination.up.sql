with positions as (
  select id, row_number() over (partition by user_id order by sort_order asc, updated_at asc, id asc) as position
  from chat_conversation
)
update chat_conversation c set sort_order = p.position from positions p where c.id = p.id;
create sequence chat_conversation_sort_order_seq;
select setval('chat_conversation_sort_order_seq', greatest(coalesce(max(sort_order), 0) + 1, 1), false) from chat_conversation;
alter sequence chat_conversation_sort_order_seq owned by chat_conversation.sort_order;
alter table chat_conversation alter column sort_order set default nextval('chat_conversation_sort_order_seq');
alter table chat_conversation add constraint chat_conversation_user_order_unique unique (user_id, sort_order) deferrable initially deferred;
