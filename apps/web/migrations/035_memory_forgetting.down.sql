create table chat_memory_suppression (
  user_id text not null references "user"(id) on delete cascade,
  source_message_id uuid not null references chat_message(id) on delete cascade,
  topic text not null,
  primary key(user_id,source_message_id,topic)
);
drop table chat_memory_topic_tombstone;
