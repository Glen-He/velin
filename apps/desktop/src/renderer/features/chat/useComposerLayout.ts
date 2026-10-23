import { useLayoutEffect, useRef } from 'react'

// 用单行布局的实际可用宽度判定换行，避免展开后变宽、又收缩形成循环。
export function useComposerLayout(value: string) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const rowRef = useRef<HTMLDivElement>(null)
  const updateRef = useRef<(() => void) | null>(null)
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    const row = rowRef.current
    const form = row?.closest('form')
    if (!textarea || !row || !form) return
    const mirror = textarea.cloneNode(false)
    if (!(mirror instanceof HTMLTextAreaElement)) return
    mirror.removeAttribute('id')
    mirror.removeAttribute('name')
    mirror.removeAttribute('aria-label')
    mirror.setAttribute('aria-hidden', 'true')
    mirror.inert = true
    mirror.tabIndex = -1
    mirror.style.cssText =
      'position:absolute;visibility:hidden;pointer-events:none;inset:0 auto auto 0;min-height:0;height:0;max-height:none;overflow:hidden;'
    form.append(mirror)
    const controls = [...row.children].filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child !== textarea,
    )
    const update = () => {
      const style = getComputedStyle(textarea)
      const rowStyle = getComputedStyle(row)
      const controlsWidth = controls.reduce(
        (width, control) => width + control.getBoundingClientRect().width,
        0,
      )
      const gap = Number.parseFloat(rowStyle.columnGap) || 0
      const available = Math.max(
        1,
        row.clientWidth - controlsWidth - gap * controls.length,
      )
      mirror.style.width = `${available}px`
      mirror.value = textarea.value
      const lineHeight = Number.parseFloat(style.lineHeight)
      // 镜像始终按单行控件的内边距测量，展开后的紧凑留白不会影响换行判定。
      const padding = Math.max(
        0,
        Number.parseFloat(style.getPropertyValue('--composer-control-size')) -
          lineHeight,
      )
      mirror.style.paddingBlock = `${padding / 2}px`
      const expanded =
        textarea.value.length > 0 &&
        mirror.scrollHeight > lineHeight + padding + 1
      form.classList.toggle('is-expanded', expanded)
      const actualStyle = getComputedStyle(textarea)
      const scrollTop = textarea.scrollTop
      textarea.style.height = '0px'
      const maximum = Math.max(
        Number.parseFloat(actualStyle.minHeight),
        Math.min(160, window.innerHeight * 0.25),
      )
      textarea.style.height = `${Math.min(textarea.scrollHeight, maximum)}px`
      textarea.scrollTop = scrollTop
    }
    updateRef.current = update
    update()
    const observer = new ResizeObserver(update)
    observer.observe(row)
    for (const control of controls) observer.observe(control)
    document.fonts.addEventListener('loadingdone', update)
    return () => {
      updateRef.current = null
      observer.disconnect()
      document.fonts.removeEventListener('loadingdone', update)
      mirror.remove()
    }
  }, [])
  useLayoutEffect(() => {
    updateRef.current?.()
  }, [value])
  return { textareaRef, rowRef }
}
