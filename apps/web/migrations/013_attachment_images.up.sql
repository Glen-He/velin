alter table chat_attachment
  add column kind text not null default 'file'
    check (kind in ('file', 'image')),
  add column data bytea,
  add column thumbnail text;

alter table chat_attachment
  add constraint chat_attachment_kind_payload_check
  check (
    (kind = 'file' and data is null and thumbnail is null)
    or (kind = 'image' and data is not null and thumbnail is not null)
  );
