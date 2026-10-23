create table chat_branch_message (
  branch_id uuid not null references chat_branch(id) on delete cascade,
  message_id uuid not null references chat_message(id) on delete cascade,
  content text not null,
  reasoning text not null,
  status text not null,
  context_metadata jsonb,
  model text,
  reasoning_effort text,
  primary key(branch_id, message_id)
);
insert into chat_branch_message(branch_id,message_id,content,reasoning,status,context_metadata,model,reasoning_effort)
select b.id,m.id,case when m.id = b.anchor_id then b.anchor_content else m.content end,
  m.reasoning,m.status,m.context_metadata,m.model,m.reasoning_effort
from chat_branch b join chat_message m on m.conversation_id = b.conversation_id
join chat_message anchor on anchor.id = b.anchor_id
where m.sequence <= anchor.sequence or m.id = any(b.message_ids);
alter table chat_branch drop column message_ids;
