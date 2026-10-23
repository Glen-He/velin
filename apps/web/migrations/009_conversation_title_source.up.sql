alter table chat_conversation
  add column title_source text not null default 'auto'
  check (title_source in ('auto', 'generated', 'manual'));
