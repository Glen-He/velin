alter table chat_attachment
  drop constraint chat_attachment_kind_payload_check;

alter table chat_attachment
  drop column thumbnail,
  drop column data,
  drop column kind;
