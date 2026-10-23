create index chat_pdf_page_cache_updated_at_idx
  on chat_pdf_page_cache (updated_at);

create index chat_pdf_page_cache_user_updated_at_idx
  on chat_pdf_page_cache (user_id, updated_at);
