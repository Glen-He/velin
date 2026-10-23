import { chatLimits } from '@velin/contracts/policy'

export function boundedDelta(value: string, used: number) {
  const available = Math.max(0, chatLimits.responseCharacters - used)
  let end = Math.min(value.length, available)
  if (
    end > 0 &&
    end < value.length &&
    /[\uD800-\uDBFF]/.test(value[end - 1]) &&
    /[\uDC00-\uDFFF]/.test(value[end])
  )
    end--
  return { text: value.slice(0, end), limited: value.length > available }
}
export function* splitChatDelta(value: string) {
  let start = 0
  while (start < value.length) {
    let end = Math.min(value.length, start + chatLimits.deltaCharacters)
    if (
      end < value.length &&
      /[\uD800-\uDBFF]/.test(value[end - 1]) &&
      /[\uDC00-\uDFFF]/.test(value[end])
    )
      end--
    yield value.slice(start, end)
    start = end
  }
}
