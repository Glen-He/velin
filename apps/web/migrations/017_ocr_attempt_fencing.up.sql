alter table chat_attachment
  add column ocr_generation uuid not null default gen_random_uuid(),
  add column ocr_attempt_id uuid;

update chat_attachment
set status = 'canceled', text_content = '',
    ocr_error = '识别任务已升级，请继续识别。'
where status = 'processing';

alter table chat_attachment drop column ocr_cancel_requested;
