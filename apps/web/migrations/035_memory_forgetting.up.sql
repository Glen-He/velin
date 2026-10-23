create table chat_memory_topic_tombstone (
  user_id text not null references "user"(id) on delete cascade,
  topic text not null,
  forget_before timestamptz not null,
  primary key(user_id,topic)
);
insert into chat_memory_topic_tombstone(user_id,topic,forget_before)
select user_id,topic,now() from chat_memory_suppression group by user_id,topic;
drop table chat_memory_suppression;
