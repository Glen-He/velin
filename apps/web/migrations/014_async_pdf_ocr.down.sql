drop table if exists chat_pdf_page_cache;
drop table if exists chat_attachment_page;
drop table if exists chat_attachment_source;

alter table chat_attachment
  drop column if exists ocr_cancel_requested,
  drop column if exists ocr_error,
  drop column if exists ocr_completed_pages,
  drop column if exists ocr_page_range,
  drop column if exists page_count,
  drop column if exists status;
