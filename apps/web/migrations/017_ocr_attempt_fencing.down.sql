alter table chat_attachment
  add column ocr_cancel_requested boolean not null default false,
  drop column ocr_attempt_id,
  drop column ocr_generation;
