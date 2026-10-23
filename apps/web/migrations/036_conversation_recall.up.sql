-- 原文索引由数据库事务维护，编辑、恢复分支与删除不会留下旧内容。
create function chat_recall_terms(value text) returns text[] language sql immutable strict parallel safe as $$
  with words as (
    select part[1] as word from regexp_matches(lower(normalize(value, NFKC)), '[a-z0-9_-]{2,64}|[一-鿿㐀-䶿]{2,}', 'g') part
  ), tokens as (
    select left(word,64) as term from words
    union all
    select substring(word from n for 2) from words cross join lateral generate_series(1,length(word)-1) n where word ~ '[一-鿿㐀-䶿]'
  ) select coalesce(array_agg(distinct term), '{}'::text[]) from tokens
$$;

create table chat_recall_chunk (
  message_id uuid not null references chat_message(id) on delete cascade,
  position integer not null,
  content text not null,
  terms text[] not null,
  primary key(message_id,position)
);
create index chat_recall_chunk_terms_idx on chat_recall_chunk using gin(terms);

create function chat_refresh_recall() returns trigger language plpgsql as $$
begin
  -- 流式 checkpoint 不重复建立索引；只有终态原文参与历史检索。
  if new.status = 'streaming' then return new; end if;
  delete from chat_recall_chunk where message_id = new.id;
  if new.active and new.status = 'completed' and length(trim(new.content)) > 0 then
    insert into chat_recall_chunk(message_id,position,content,terms)
    select new.id, n, part, chat_recall_terms(part)
    from generate_series(0, greatest(0,(length(new.content)-1)/800)) n
    cross join lateral (select substring(new.content from n*800+1 for 1000) as part) chunk;
  end if;
  return new;
end $$;
create trigger chat_message_recall after insert or update of content,status,active on chat_message
  for each row execute function chat_refresh_recall();

insert into chat_recall_chunk(message_id,position,content,terms)
select m.id,n,part,chat_recall_terms(part) from chat_message m
cross join lateral generate_series(0,greatest(0,(length(m.content)-1)/800)) n
cross join lateral (select substring(m.content from n*800+1 for 1000) as part) chunk
where m.active and m.status = 'completed' and length(trim(m.content)) > 0;

alter table chat_memory_preference add column reference_history boolean not null default true;

-- 保留自动记忆曾经使用的全部来源，删除或更正时同时排除旧原文的跨对话召回。
create table chat_memory_evidence (
  user_id text not null references "user"(id) on delete cascade,
  topic text not null,
  source_message_id uuid not null references chat_message(id) on delete cascade,
  primary key(user_id,topic,source_message_id)
);
insert into chat_memory_evidence select user_id,topic,source_message_id from chat_memory where source_message_id is not null;
create table chat_recall_exclusion (
  user_id text not null references "user"(id) on delete cascade,
  source_message_id uuid not null references chat_message(id) on delete cascade,
  primary key(user_id,source_message_id)
);

update chat_message set context_metadata = context_metadata || '{"historySources":[],"retrievalDegraded":false}'::jsonb where context_metadata is not null;
update chat_branch_message set context_metadata = context_metadata || '{"historySources":[],"retrievalDegraded":false}'::jsonb where context_metadata is not null;
