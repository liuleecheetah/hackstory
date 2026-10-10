// ui 層：輸入框的小工具

/** 改名的輸入框一出現就把舊名稱整個選起來：直接打字就取代，不會接在舊名稱後面 */
export function selectAllOnMount(el: HTMLInputElement | null) {
  if (!el) return
  window.setTimeout(() => {
    el.focus()
    el.select()
  }, 0)
}
