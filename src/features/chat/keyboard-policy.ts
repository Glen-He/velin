type ChatKey = {
  key: string
  isComposing: boolean
  shiftKey: boolean
  metaKey: boolean
  ctrlKey: boolean
}

// 输入法优先处理确认与取消；只有组词结束后才执行消息快捷键。
export function chatKeyAction(event: ChatKey, sendOnEnter: boolean) {
  if (event.isComposing) return 'none'
  if (event.key === 'Escape') return 'cancel'
  if (event.key !== 'Enter') return 'none'
  const submit = sendOnEnter ? !event.shiftKey : event.metaKey || event.ctrlKey
  return submit ? 'submit' : 'none'
}
