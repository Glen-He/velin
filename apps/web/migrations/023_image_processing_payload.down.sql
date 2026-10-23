delete from chat_attachment where kind = 'image' and thumbnail is null;
alter table chat_attachment drop constraint chat_attachment_kind_payload_check;
alter table chat_attachment add constraint chat_attachment_kind_payload_check check (
  (kind = 'file' and data is null and thumbnail is null)
  or (kind = 'image' and data is not null and thumbnail is not null)
);
