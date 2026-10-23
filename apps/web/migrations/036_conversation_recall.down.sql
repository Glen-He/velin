update chat_message set context_metadata = context_metadata - 'historySources' - 'retrievalDegraded' where context_metadata is not null;
update chat_branch_message set context_metadata = context_metadata - 'historySources' - 'retrievalDegraded' where context_metadata is not null;
drop table chat_recall_exclusion;
drop table chat_memory_evidence;
alter table chat_memory_preference drop column reference_history;
drop trigger chat_message_recall on chat_message;
drop function chat_refresh_recall();
drop table chat_recall_chunk;
drop function chat_recall_terms(text);
