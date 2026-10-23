create or replace function chat_refresh_recall() returns trigger language plpgsql as $$
begin
  if new.status = 'streaming' then return new; end if;
  delete from chat_recall_chunk where message_id = new.id;
  if new.active and new.status = 'completed' and length(trim(new.content)) > 0 then
    insert into chat_recall_chunk(message_id,position,content,terms)
    select new.id,n,part,chat_recall_terms(part)
    from generate_series(0,greatest(0,(length(new.content)-1)/800)) n
    cross join lateral (select substring(new.content from n*800+1 for 1000) as part) chunk;
  end if;
  return new;
end $$;
