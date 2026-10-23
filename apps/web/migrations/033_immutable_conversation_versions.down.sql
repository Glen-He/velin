alter table chat_branch add column message_ids uuid[] not null default '{}';
update chat_branch b set message_ids = array(select s.message_id from chat_branch_message s where s.branch_id = b.id and s.message_id <> b.anchor_id);
drop table chat_branch_message;
