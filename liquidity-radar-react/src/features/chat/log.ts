// Appends one message to the chat log. Kept apart from chat.ts so the engine,
// which only needs this for its welcome line, does not pull the whole
// assistant (rule engine, LLM client, actions, scanner) into the first-load
// bundle. chat.ts re-exports it, so every other caller is unchanged.
import { $ } from '../../utils/dom'

export function pushMsg(html: string, who: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'msg ' + who
  if (who === 'user') div.textContent = html
  else div.innerHTML = html
  const log = $('chatLog')
  if (log) {
    log.appendChild(div)
    log.scrollTop = log.scrollHeight
  }
  return div
}
