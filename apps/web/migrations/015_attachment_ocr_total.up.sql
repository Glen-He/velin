alter table chat_attachment
  add column ocr_total_pages integer
    check (ocr_total_pages is null or ocr_total_pages >= 0);
