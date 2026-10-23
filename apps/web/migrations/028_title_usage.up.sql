alter table chat_request_usage
  add column title_model text,
  add column title_status text not null default 'not_requested'
    check (title_status in ('not_requested', 'running', 'completed', 'failed')),
  add column title_input_tokens integer check (title_input_tokens is null or title_input_tokens >= 0),
  add column title_output_tokens integer check (title_output_tokens is null or title_output_tokens >= 0);
