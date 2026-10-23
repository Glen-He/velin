alter table chat_attachment
  add column draft_conversation_id uuid
    references chat_conversation (id) on delete cascade;

create index chat_attachment_draft_lookup_idx
  on chat_attachment (user_id, draft_conversation_id)
  where message_id is null;
