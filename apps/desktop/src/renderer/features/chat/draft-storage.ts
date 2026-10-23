const draftStoragePrefix = 'velin:chat:draft:v2'
const draftLengthLimit = 64 * 1024
const draftRetentionMs = 24 * 60 * 60_000

function parseDraft(value: string | null) {
  if (!value || value.length > draftLengthLimit * 7) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('text' in parsed) ||
      !('updatedAt' in parsed) ||
      typeof parsed.text !== 'string' ||
      parsed.text.length > draftLengthLimit ||
      typeof parsed.updatedAt !== 'number' ||
      !Number.isFinite(parsed.updatedAt) ||
      parsed.updatedAt > Date.now() ||
      parsed.updatedAt < Date.now() - draftRetentionMs
    )
      return null
    return { text: parsed.text, updatedAt: parsed.updatedAt }
  } catch {
    return null
  }
}

export function pruneChatDrafts() {
  try {
    const retained: Array<{ key: string; updatedAt: number }> = []
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('velin:chat:draft:v1:'))
        window.localStorage.removeItem(key)
      if (!key.startsWith(`${draftStoragePrefix}:`)) continue
      const draft = parseDraft(window.localStorage.getItem(key))
      if (!draft) window.localStorage.removeItem(key)
      else retained.push({ key, updatedAt: draft.updatedAt })
    }
    retained.sort((left, right) => right.updatedAt - left.updatedAt)
    for (const draft of retained.slice(100))
      window.localStorage.removeItem(draft.key)
  } catch {
    /* 存储被系统禁用时不影响当前输入。 */
  }
}

export function chatDraftStorageKey(
  accountId: string | null,
  conversationId?: string,
) {
  if (!accountId) return null
  return `${draftStoragePrefix}:${accountId}:${conversationId ?? 'new'}`
}

export function readChatDraft(key: string | null) {
  if (!key) return ''
  try {
    const draft = parseDraft(window.localStorage.getItem(key))
    if (!draft) window.localStorage.removeItem(key)
    return draft?.text ?? ''
  } catch {
    return ''
  }
}

export function storeChatDraft(key: string | null, value: string) {
  if (!key) return
  try {
    if (!value) {
      window.localStorage.removeItem(key)
      return
    }
    window.localStorage.setItem(
      key,
      JSON.stringify({
        text: value.slice(0, draftLengthLimit),
        updatedAt: Date.now(),
      }),
    )
    pruneChatDrafts()
  } catch {
    // 本地草稿不可用时，当前输入仍可正常发送。
  }
}
