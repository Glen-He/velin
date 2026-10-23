drop index chat_attachment_draft_lookup_idx;

alter table chat_attachment
  drop column draft_conversation_id;
