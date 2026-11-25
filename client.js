/* Browser half for @local/dsh-redmark.
 *
 * Contributions:
 *   - sidebar.panellist            -> left-rail entry that opens "All bookmarks"
 *   - main (key: dsh-redmark)     -> the all-sessions bookmarks page
 *   - sidebarRightTabs + sidebar.right.pane.tab -> per-session bookmarks tab
 *   - conversation.chat.assistant-actions -> per-turn bookmark button, rendered
 *     inside the reply's copy / branch / share toolbar
 *   - conversation.session.header.utilities -> right-rail + find buttons
 *   - conversation.composer.dock   -> composer bridge (inputActions) + find bar
 *   - text selection (context menu) -> bookmark a text range, painted with the
 *     CSS Custom Highlight API; ⌘/Ctrl+F opens an in-conversation find bar.
 *
 * Jumping reuses DSH's own turn rail: clicking the rail mark makes ChatView
 * page the history itself and align the row, so the plugin never writes a
 * scroll position to move the transcript. Any long jump therefore goes through
 * DSH's `navigateToTurn`, which pauses bottom-follow and commits the landing as
 * the reading anchor — the two pieces of state that made a search "jump back"
 * later. Plan C fixes that at the state, not at the scroll: the plugin reads
 * ChatView's own `chatScroll {save, read}` anchor store out of the React tree,
 * snapshots it before a search jump and writes the snapshot back afterwards
 * (`rememberPosition: false`), and reaches `reading.followTail()` through the
 * same tree when follow has to be resumed. Values are always DSH's; the plugin
 * only calls them, never synthesises scroll or wheel events.
 *
 * Only `react` / `react-dom` are required: an installed bundle's module table
 * does NOT expose the `host`, `styles` or `console` specifiers, so CSS is
 * injected with a plain <style> element.
 */
window.__ModuleLoader__.load({
  id: '@local/dsh-redmark',

  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef } = React

    let createPortal = null
    try {
      const reactDom = require('react-dom')
      if (reactDom && typeof reactDom.createPortal === 'function') createPortal = reactDom.createPortal
    } catch {
      createPortal = null
    }

    const NS = 'dshRedmark'
    const STORE_PREFIX = 'dsh.dsh-redmark.'
    /* Legacy keys from the Session Bookmarks era, read only for migration. */
    const LEGACY_STORE_PREFIX = 'dsh.session-bookmarks.'
    const LEGACY_ENDPOINT = '/session-bookmarks'
    const ENDPOINT = '/dsh-redmark'
    /* Kept in step with the host cap so the mirror never truncates silently. */
    const MAX_LIST = 500
    const MAX_NOTE = 2000

    /* ------------------------------------------------------------------ */
    /* locale                                                             */
    /* ------------------------------------------------------------------ */

    const DICT = {
      zh: {
        'tab.bookmarks': '书签',
        'view.title': '书签',
        'view.hint': '点击任意一条即可跳回',
        'view.empty': '还没有书签。在任意一轮对话的末尾点击书签图标即可收藏。',
        'view.noNote': '（无备注）',
        'view.turnPrefix': '第 ',
        'view.turnSuffix': ' 轮',
        'view.jump': '跳转到该轮',
        'jump.loading': '正在加载更早的对话…',
        'jump.failed': '无法定位到该轮：已加载 {pages} 页更早的历史，仍未找到它。',
        'jump.failedStart': '已翻到这段对话的最开头，仍没找到该书签所在的位置（可能已被压缩，或属于别的会话）。',
        'jump.loaded': '已自动加载更早的历史，并跳转到该轮',
        'jump.located': '已跳转到该轮',
        'jump.quotePending': '（引用的那段还没加载出来，往下翻一点即可）',
        'view.edit': '编辑备注',
        'view.save': '保存',
        'view.cancel': '取消',
        'view.remove': '删除',
        'tail.add': '收藏此轮',
        'tail.edit': '编辑此轮书签',
        'tail.placeholder': '备注（可选）',
        'tail.save': '保存',
        'tail.cancel': '取消',
        'tail.remove': '删除书签',
        'page.title': '全部书签',
        'page.search': '搜索内容、备注或会话…',
        'page.sortRecent': '最近添加',
        'page.sortTurn': '按轮次',
        'page.sortSession': '按会话',
        'page.empty': '暂无书签。在任意会话中选中文本或表格，右键「收藏选中」即可保存。',
        'page.emptySearch': '没有匹配的书签。',
        'page.back': '返回对话',
        'page.count': '{n} 条',
        'page.textKind': '文本',
        'rightbar.title': '书签',
        'rightbar.all': '全部书签',
        'rightbar.empty': '选中对话中的文本或表格，右键「收藏选中」即可高亮并保存至此处。',
        'rightbar.unavailable': '右侧栏不可用',
        'rightbar.hint': '右侧栏已展开，点「书签」磁贴即可打开',
        'rightbar.guide': '当前会话中保存的段落、表格与注释',
        'find.label': '查找',
        'find.tip': '在当前会话中查找内容 (Ctrl+F)',
        'find.placeholder': '在当前会话中查找…',
        'find.prev': '上一个 (Shift+Enter)',
        'find.next': '下一个 (Enter)',
        'find.close': '关闭 (Esc)',
      'find.offTurn': '第 {turn} 轮 · 导轨没认出来，请手动点',
    'find.unloaded': '当前视图没有匹配 · 滚动加载更多历史后再试',
        'page.openPane': '右侧栏打开',
        'sel.add': '🔖 收藏选中',
        'sel.quote': '引用到对话',
        'sel.noInput': '输入框不可用',
        'rightbar.guide': '当前会话中保存的段落、表格与注释',
        'sel.saved': '已收藏选中的文本',
        'row.open': '在会话中打开',
      },
      en: {
        'tab.bookmarks': 'Bookmarks',
        'view.title': 'Bookmarks',
        'view.hint': 'Click a row to jump back',
        'view.empty': 'No bookmarks yet. Click the bookmark icon at the end of any turn to save one.',
        'view.noNote': '(no note)',
        'view.turnPrefix': 'Turn ',
        'view.turnSuffix': '',
        'view.jump': 'Jump to this turn',
        'jump.loading': 'Loading older messages…',
        'jump.failed': 'Could not reach that turn after loading {pages} page(s) of older history.',
        'jump.failedStart': 'Reached the start of this conversation without finding that bookmark (it may have been compacted or belong to another session).',
        'jump.loaded': 'Loaded older history and jumped to the turn',
        'jump.located': 'Jumped to that turn',
        'jump.quotePending': '(the quoted passage is not loaded yet -- scroll a little and it will appear)',
        'view.edit': 'Edit note',
        'view.save': 'Save',
        'view.cancel': 'Cancel',
        'view.remove': 'Delete',
        'tail.add': 'Bookmark this turn',
        'tail.edit': 'Edit this turn\u2019s bookmark',
        'tail.placeholder': 'Note (optional)',
        'tail.save': 'Save',
        'tail.cancel': 'Cancel',
        'tail.remove': 'Delete bookmark',
        'page.title': 'All bookmarks',
        'page.search': 'Search text, notes or sessions…',
        'page.sortRecent': 'Recently added',
        'page.sortTurn': 'By turn',
        'page.sortSession': 'By session',
        'page.empty': 'No bookmarks yet. Select text or a table in any conversation and press “Bookmark selection”.',
        'page.emptySearch': 'No bookmark matches.',
        'page.back': 'Back to chat',
        'page.count': '{n}',
        'page.textKind': 'Text',
        'rightbar.title': 'Bookmarks',
        'rightbar.all': 'All bookmarks',
        'rightbar.empty': 'Select text or a table in this conversation, then right-click and pick Bookmark selection.',
        'rightbar.unavailable': 'The right sidebar is unavailable',
        'rightbar.hint': 'Right sidebar opened — pick the Bookmarks tile',
        'page.openPane': 'Open in side panel',
        'sel.add': '🔖 Bookmark selection',
        'sel.quote': 'Quote in chat',
        'sel.noInput': 'The composer is unavailable',
        'rightbar.guide': 'Saved passages, tables, and notes in this session',
        'find.label': 'Find',
        'find.tip': 'Find in this conversation (Ctrl+F)',
        'find.placeholder': 'Find in conversation…',
        'find.prev': 'Previous (Shift+Enter)',
        'find.next': 'Next (Enter)',
        'find.close': 'Close (Esc)',
      'find.offTurn': 'Turn {turn} · rail did not resolve, click it',
    'find.unloaded': 'No match in this view · scroll to load more history',
        'sel.saved': 'Saved the selected text',
        'row.open': 'Open in conversation',
      },
    }

    let lang = 'en'

    /* LocaleSnapshot is `{ active, locales, revision }`; older hosts may hand
     * back a plain locale string, so accept both shapes. */
    function detectLang(value) {
      try {
        let probe = ''
        if (typeof value === 'string') {
          probe = value
        } else if (value && typeof value === 'object') {
          probe =
            value.active ||
            value.code ||
            value.id ||
            value.locale ||
            value.language ||
            value.lang ||
            value.current ||
            value.name ||
            ''
          if (!probe) {
            try { probe = JSON.stringify(value) } catch { probe = '' }
          }
        }
        lang = String(probe).toLowerCase().indexOf('zh') >= 0 ? 'zh' : 'en'
      } catch {
        lang = 'en'
      }
    }

    function tt(key) {
      const dict = DICT[lang] || DICT.en
      return dict[key] || DICT.en[key] || key
    }

    function turnLabel(n) {
      return tt('view.turnPrefix') + n + tt('view.turnSuffix')
    }

    const localeListeners = new Set()

    function notifyLocale() {
      for (const fn of Array.from(localeListeners)) {
        try { fn() } catch { /* one broken subscriber must not block the rest */ }
      }
    }

    function useLocaleTick() {
      const [, setVersion] = useState(0)
      useEffect(() => {
        const fn = () => setVersion((x) => x + 1)
        localeListeners.add(fn)
        return () => { localeListeners.delete(fn) }
      }, [])
    }

    /* ------------------------------------------------------------------ */
    /* storage                                                            */
    /* ------------------------------------------------------------------ */

    /* localStorage is unavailable in some privacy modes; the in-memory copy is
     * the authoritative one for this page run, so a failed write never loses
     * what the user just typed. */
    const memory = new Map()
    const listeners = new Set()

    function notify() {
      for (const fn of Array.from(listeners)) {
        try { fn() } catch { /* a broken subscriber must not block the rest */ }
      }
    }

    function subscribe(fn) {
      listeners.add(fn)
      return () => { listeners.delete(fn) }
    }

    function newId() {
      return 'bm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8)
    }

    function clipNote(note) {
      if (typeof note !== 'string') return ''
      return note.length > MAX_NOTE ? note.slice(0, MAX_NOTE) : note
    }

    /* Drop anything that is not a well-formed bookmark: a malformed record from
     * localStorage or from the mirror must never be able to blank the view. */
    function sanitize(list) {
      if (!Array.isArray(list)) return []
      const out = []
      const seen = new Set()
      let truncated = false
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue
        if (!Number.isSafeInteger(raw.turn)) continue
        let id = typeof raw.id === 'string' && raw.id ? raw.id : newId()
        if (seen.has(id)) id = newId()
        seen.add(id)
        out.push({
          id,
          turn: raw.turn,
          seq: Number.isSafeInteger(raw.seq) ? raw.seq : undefined,
          note: clipNote(raw.note),
          createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
          /* Optional text-range anchor. A turn bookmark has none of these. */
          kind: raw.kind === 'text' ? 'text' : 'turn',
          nodeKey: typeof raw.nodeKey === 'string' ? raw.nodeKey : undefined,
          quote: typeof raw.quote === 'string' ? raw.quote.slice(0, 600) : undefined,
          start: Number.isSafeInteger(raw.start) ? raw.start : undefined,
          end: Number.isSafeInteger(raw.end) ? raw.end : undefined,
          prefix: typeof raw.prefix === 'string' ? raw.prefix.slice(0, 40) : undefined,
          suffix: typeof raw.suffix === 'string' ? raw.suffix.slice(0, 40) : undefined,
          sessionTitle: typeof raw.sessionTitle === 'string' ? raw.sessionTitle.slice(0, 120) : undefined,
        })
        if (out.length >= MAX_LIST) {
          /* The comment above promises the mirror never truncates silently; the
             clamp is still needed, so it must at least be visible in the trace. */
          truncated = true
          break
        }
      }
      if (truncated) {
        try { traceForce('store: list truncated to MAX_LIST=' + MAX_LIST) } catch { /* noop */ }
      }
      return out
    }

    function readStore(sessionId) {
      const cached = memory.get(sessionId)
      if (cached) return cached
      let list = []
      let migrated = false
      try {
        const raw = localStorage.getItem(STORE_PREFIX + sessionId)
        if (raw) {
          list = sanitize(JSON.parse(raw))
        } else {
          /* Upgrade path: adopt bookmarks saved under the old Session Bookmarks
           * key, then copy them forward to the new key on the next write/read. */
          const legacyRaw = localStorage.getItem(LEGACY_STORE_PREFIX + sessionId)
          if (legacyRaw) {
            list = sanitize(JSON.parse(legacyRaw))
            migrated = list.length > 0
          }
        }
      } catch (error) {
        /* A corrupt payload must not look like "no bookmarks": log it so the
           loss is at least observable in the trace channel. */
        try { traceForce('store: read failed session=' + sessionId + ' ' + String(error && error.name)) } catch { /* noop */ }
        list = []
      }
      memory.set(sessionId, list)
      if (migrated) {
        /* Persist under the new key right away; keep the legacy copy untouched so
         * an older bundle can still read it until the user explicitly saves. */
        try { localStorage.setItem(STORE_PREFIX + sessionId, JSON.stringify(list)) } catch { /* noop */ }
        try { traceForce('store: migrated legacy key session=' + sessionId + ' count=' + list.length) } catch { /* noop */ }
        mirrorPost(sessionId, list, true)
      }
      return list
    }

    function writeLocal(sessionId, list) {
      memory.set(sessionId, list)
      try {
        localStorage.setItem(STORE_PREFIX + sessionId, JSON.stringify(list))
      } catch (error) {
        /* quota / privacy mode: the in-memory copy still drives this page, but
           the failure must be visible instead of silently degrading to memory
           only (a reload then looks like "my bookmarks vanished"). */
        try { traceForce('store: write failed session=' + sessionId + ' ' + String(error && error.name)) } catch { /* noop */ }
      }
    }

    function writeStore(sessionId, list, explicit) {
      const clean = sanitize(list)
      writeLocal(sessionId, clean)
      notify()
      /* A non-empty write is always safe to mirror; an empty one is only sent
         when the caller says the user really deleted the last bookmark. */
      mirrorPost(sessionId, clean, clean.length === 0 ? explicit === true : true)
    }

    /* Mirrored durability. Requests are serialized so two quick edits cannot
     * land out of order, and a hard 4xx switches the mirror off for a while
     * instead of for the whole page run. */
    let mirrorChain = Promise.resolve()
    let mirrorOffUntil = 0
    /* Set when a write is dropped because the mirror is in backoff, so the next
     * opportunity flushes the whole list instead of leaving the mirror behind. */
    let mirrorDirty = false

    function mirrorEnabled() {
      return Date.now() >= mirrorOffUntil
    }

    function mirrorBackoff() {
      mirrorOffUntil = Date.now() + 60000
    }

    function mirrorUrl(sessionId) {
      return ENDPOINT + '?sessionId=' + encodeURIComponent(sessionId)
    }

    function mirrorPost(sessionId, list, explicit) {
      if (!mirrorEnabled()) { mirrorDirty = true; return }
      /* An empty list is never mirrored on its own: it is exactly what a failed
         localStorage read leaves behind, and posting it has already erased a
         whole session's mirror file once. Only a user's own deletion (which
         passes `explicit`) may write zero bookmarks. */
      if (list.length === 0 && explicit !== true) {
        traceForce('store: refused to mirror an empty list session=' + sessionId)
        return
      }
      let payload = null
      try {
        payload = JSON.stringify({ bookmarks: list, explicit: explicit === true })
      } catch {
        return
      }
      mirrorChain = mirrorChain
        .catch(() => {})
        .then(() => {
          if (!mirrorEnabled()) { mirrorDirty = true; return undefined }
          return fetch(mirrorUrl(sessionId), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: payload,
          })
            .then((r) => {
              if (r.ok) {
                mirrorOffUntil = 0
                mirrorDirty = false
                return
              }
              if (r.status >= 400 && r.status < 500 && r.status !== 429) { mirrorDirty = true; mirrorBackoff() }
            })
            .catch(() => { mirrorDirty = true; mirrorBackoff() })
        })
    }

    /* A write dropped during backoff is retried without waiting for the user to
     * edit again; otherwise the mirror stays permanently behind the local copy.
     * An EMPTY in-memory list is never flushed: that state is what a failed
     * localStorage read leaves behind, and posting it erased the mirror file
     * (observed: the whole session's bookmarks became `[]`). A genuine
     * "user deleted the last bookmark" write still goes out, because it happens
     * through writeStore() with an explicit list. */
    function flushMirror() {
      if (!mirrorDirty || !mirrorEnabled()) return
      mirrorDirty = false
      for (const sessionId of Array.from(memory.keys())) {
        const list = memory.get(sessionId) || []
        if (list.length === 0) continue
        try { mirrorPost(sessionId, list) } catch { /* retried later */ }
      }
    }

    function mirrorGet(sessionId) {
      if (!mirrorEnabled()) return Promise.resolve(null)
      try {
        return fetch(mirrorUrl(sessionId), { method: 'GET' })
          .then((r) => {
            if (r.ok) return r.json()
            if (r.status >= 400 && r.status < 500 && r.status !== 429) mirrorBackoff()
            return null
          })
          .then((body) => {
            const list = body && sanitize(body.bookmarks)
            return list && list.length ? list : null
          })
          .catch(() => {
            mirrorBackoff()
            return null
          })
      } catch {
        return Promise.resolve(null)
      }
    }

    const hydrated = new Set()

    function useBookmarks(sessionId) {
      const [list, setList] = useState(() => (sessionId ? readStore(sessionId) : []))

      useEffect(() => {
        /* The per-turn trigger lives in `conversation.chat.assistant-actions`,
           whose props carry no session id; it resolves the session from the DOM
           on the render after mount, so the first pass arrives here as null. */
        if (!sessionId) { setList([]); return undefined }
        let alive = true
        setList(readStore(sessionId))
        const un = subscribe(() => { if (alive) setList(readStore(sessionId)) })

        if (!hydrated.has(sessionId) && readStore(sessionId).length === 0) {
          /* `hydrated` doubles as the in-flight latch, so it is set before the
             request; a FAILED attempt deletes it again (the old code left it set
             for the whole page run after one transient error, and logged
             nothing). */
          hydrated.add(sessionId)
          mirrorGet(sessionId).then((remote) => {
            if (!remote) { hydrated.delete(sessionId); return }
            if (!alive) return
            if (readStore(sessionId).length > 0) return
            writeLocal(sessionId, remote)
            notify()
            if (alive) setList(remote)
          }).catch(() => { hydrated.delete(sessionId) })
        }

        return () => { alive = false; un() }
      }, [sessionId])

      return list
    }

    function addBookmark(sessionId, am) {
      const next = readStore(sessionId).filter((x) => x.id !== am.id).concat([am])
      writeStore(sessionId, next)
    }

    function updateBookmark(sessionId, id, patch) {
      writeStore(
        sessionId,
        readStore(sessionId).map((x) => (x.id === id ? Object.assign({}, x, patch) : x)),
      )
    }

    function removeBookmark(sessionId, id) {
      writeStore(
        sessionId,
        readStore(sessionId).filter((x) => x.id !== id),
        true,
      )
    }

    /* Every session that has bookmarks, newest bookmark first. Used by the
     * all-sessions page. Reads localStorage AND the in-memory copy: in a privacy
     * mode (or after the quota is hit) localStorage is empty while `memory`
     * holds everything the user just saved, so the page used to come up blank
     * even though the per-session tab was correct. */
    function allBookmarks() {
      const out = []
      const keys = new Set(memory.keys())
      try {
        for (let i = 0; i < localStorage.length; i += 1) {
          const k = localStorage.key(i)
          if (k && k.indexOf(STORE_PREFIX) === 0) keys.add(k.slice(STORE_PREFIX.length))
          /* Sessions not opened since the rename still live under the old key. */
          else if (k && k.indexOf(LEGACY_STORE_PREFIX) === 0) keys.add(k.slice(LEGACY_STORE_PREFIX.length))
        }
      } catch { /* localStorage unavailable: memory alone decides */ }
      for (const sid of keys) {
        const items = readStore(sid)
        for (const it of items) out.push(Object.assign({ sessionId: sid }, it))
      }
      out.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      return out
    }

    /* ------------------------------------------------------------------ */
    /* jump                                                               */
    /* ------------------------------------------------------------------ */

    function reducedMotion() {
      try {
        return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      } catch {
        return false
      }
    }

    function frame() {
      return new Promise((resolve) => {
        try { requestAnimationFrame(() => resolve()) } catch { resolve() }
      })
    }

    function sleep(ms) {
      return new Promise((resolve) => {
        try { setTimeout(resolve, ms) } catch { resolve() }
      })
    }

    /* The conversation shell renders `<div data-conversation-scroll>` and owns
     * the transcript scrollport — but it wraps WHICHEVER view is active, so
     * right after `openView('chat')` it still hosts the Bookmarks list. The
     * scroller only counts once the Chat flow is mounted inside it, otherwise
     * the jump reads (and scrolls) the wrong subtree. */
    const SCROLLER_SELECTOR = '[data-conversation-scroll]'
    const HISTORY_EDGE_SELECTOR = '[data-chat-history]'
    const CHAT_FLOW_SELECTOR = '[data-chat-flow]'
    const SESSION_CONTENT_SELECTOR = '[data-conversation-session]'

    /* The shell wraps every conversation body in
     * `[data-conversation-session="<sessionId>"]` (ConversationContent.tsx:195)
     * and the transcript scrollport sits INSIDE it. With several conversations
     * mounted at once, a bare document.querySelector grabs whichever Chat flow
     * comes first in the document — the wrong conversation — which made the
     * jump centre the wrong rows and read a scrollport that was not the visible
     * one. Every jump query is therefore scoped to the bookmark's own session. */
    function sessionRoot(sessionId) {
      if (sessionId) {
        const escaped = String(sessionId).replace(/["\\]/g, '\\$&')
        try {
          const root = document.querySelector(SESSION_CONTENT_SELECTOR + '="' + escaped + '"')
          if (root) return root
        } catch { /* fall through to document */ }
      }
      return document
    }

    function q(sel, sessionId) {
      const root = sessionRoot(sessionId)
      try { return root.querySelector(sel) } catch { return null }
    }

    function qa(sel, sessionId) {
      const root = sessionRoot(sessionId)
      try { return root.querySelectorAll(sel) } catch { return [] }
    }

    function findScroller(sessionId) {
      const flow = q(CHAT_FLOW_SELECTOR, sessionId)
      if (flow === null) return null
      let owner = null
      try { owner = flow.closest(SCROLLER_SELECTOR) } catch { owner = null }
      if (owner) return owner
      const edge = q(HISTORY_EDGE_SELECTOR, sessionId)
      if (edge && edge.parentElement) return edge.parentElement
      return flow.parentElement
    }

    /* A scrollport that was captured before ChatView re-rendered can stay alive
     * as a detached node: reads keep returning the last offset while every
     * write silently does nothing — the "stuck at 52450" failure in the trace.
     * So the jump never trusts a cached element: it re-resolves the scrollport
     * and proves it is the rendered, scrollable one before writing to it. */
    function scrollerLive(sessionId) {
      const scroller = findScroller(sessionId)
      if (scroller === null) return null
      try {
        if (!scroller.isConnected) return null
        if (scroller.offsetParent === null) return null
        if (scroller.clientHeight <= 0) return null
        if (scroller.scrollHeight <= scroller.clientHeight + 4) return null
      } catch {
        return null
      }
      return scroller
    }

    /* ChatView puts this attribute on its root while the transcript is still
     * pinned to the newest row; a programmatic scroll is reverted while it is
     * present, so the jump has to watch it instead of guessing. */
    const FOLLOW_TAIL_SELECTOR = '[data-chat-following-tail]'
    const TURN_ROW_SELECTOR = '[data-chat-turn]'

    function followTailPinned(sessionId) {
      try { return q(FOLLOW_TAIL_SELECTOR, sessionId) !== null } catch { return false }
    }

    /* ── Plan C: DSH's own reading handles, reached through the React tree ────
     * Two pieces of Chat state decide whether a search "jumps back" later:
     *
     *   1. the reading anchor — `ChatView` receives `chatScroll {save, read}`,
     *      whose `save(null)` means "no anchor, reopen at the tail" and
     *      `save(position)` pins the reopen position. `navigateToTurn` commits
     *      the landing through it, so a search rewrote where the reader was.
     *   2. bottom-follow — the returned `scroll` handle's `returnToBottom()`,
     *      which is `reading.followTail()`: it scrolls to the newest row AND
     *      clears the anchor.
     *
     * The chat package exports neither, so they are read off the rendered
     * element (`__reactFiber$` / `__reactProps$` own keys; the chat component's
     * `memoizedProps` carry `chatScroll`). The plugin still only *calls* DSH's
     * own functions — it never writes a scroll position or fakes an event. */
    function reactOwn(node, prefix) {
      if (!node) return null
      try {
        for (const key in node) if (key.lastIndexOf(prefix, 0) === 0) return node[key]
      } catch { /* noop */ }
      return null
    }

    function anchorStore(sessionId) {
      const candidates = [q(CHAT_FLOW_SELECTOR, sessionId), q(TURN_ROW_SELECTOR, sessionId), q(SCROLLER_SELECTOR, sessionId)]
      for (const node of candidates) {
        let fiber = reactOwn(node, '__reactFiber$')
        for (let depth = 0; fiber && depth < 80; depth++) {
          const props = fiber.memoizedProps
          const store = props ? props.chatScroll : null
          if (store && typeof store.save === 'function' && typeof store.read === 'function') return store
          fiber = fiber.return
        }
      }
      return null
    }

    /* `undefined` = the API is unreachable; `null` = the reader was following
       the tail (no anchor); an object = a pinned reading position. */
    function readAnchor(sessionId) {
      const store = anchorStore(sessionId)
      if (store === null) return undefined
      try { return store.read() } catch { return undefined }
    }

    function restoreAnchor(sessionId, value) {
      if (value === undefined) return false
      const store = anchorStore(sessionId)
      if (store === null) return false
      try {
        store.save(value)
        trace('anchor: restored ' + (value === null ? 'tail' : 'turn=' + value.turn))
        return true
      } catch { return false }
    }

    /* Reach ChatView's own `scroll` handle (it carries `returnToBottom`, i.e.
       `reading.followTail`) out of the React tree. Prefer this over the button:
       the button's CSS-module class is minified and its label is localised, so
       a DOM selector is fragile. This still only *calls* DSH's own function. */
    function scrollHandle(sessionId) {
      const candidates = [q(CHAT_FLOW_SELECTOR, sessionId), q(TURN_ROW_SELECTOR, sessionId), q(SCROLLER_SELECTOR, sessionId)]
      for (const node of candidates) {
        let fiber = reactOwn(node, '__reactFiber$')
        for (let depth = 0; fiber && depth < 80; depth++) {
          const props = fiber.memoizedProps
          const scroll = props ? props.scroll : null
          if (scroll && typeof scroll.returnToBottom === 'function') return scroll
          fiber = fiber.return
        }
      }
      return null
    }

    /* Resume bottom-follow through DSH's `returnToBottom`. The control only
       exists while follow is paused, which is exactly when this is needed. */
    function resumeFollowing(sessionId) {
      const scroll = scrollHandle(sessionId)
      if (scroll) {
        try {
          scroll.returnToBottom()
          trace('follow: resumeFollowing() via scroll handle')
          return true
        } catch { /* fall through to the DOM control */ }
      }
      const button = (() => { try { return q('button[class*="toBottom"]', sessionId) } catch { return null } })()
      const fiber = reactOwn(button, '__reactFiber$')
      const props = reactOwn(button, '__reactProps$') || (fiber ? fiber.memoizedProps : null)
      if (props && typeof props.onClick === 'function') {
        try {
          props.onClick()
          trace('follow: resumeFollowing()')
          return true
        } catch { /* fall through to a plain click */ }
      }
      if (button) {
        try {
          button.click()
          trace('follow: resumeFollowing click()')
          return true
        } catch { /* noop */ }
      }
      trace('follow: no toBottom control')
      return false
    }

    /* ── Follow guard ────────────────────────────────────────────────────────
     * The reported symptom: while a reply streams, the transcript silently
     * stops following and the view slides back up to the user's own message.
     *
     * Measurement (dsh-redmark trace, 2026-11-23) showed the pin drop
     * carrying no reader gesture at all -- `intentAge=none`, i.e. no wheel,
     * touch, pointer or key event anywhere near it -- while scrollHeight was
     * still growing. DSH's viewport reads any scrollTop movement as reader
     * movement and drops `followingTail`; a reflow while content grows above
     * the viewport produces exactly that movement without any JS write.
     *
     * This guard is deliberately narrow. It re-pins ONLY when all of these
     * hold, so a reader who deliberately scrolls up is never fought:
     *   - the pin was on a moment ago and is gone now;
     *   - nothing the reader touched caused it (no intent within 700ms);
     *   - the view is still near the tail (< 600px), i.e. it drifted rather
     *     than being taken somewhere on purpose;
     *   - the last repair was more than 1.2s ago (no thrashing).
     * Whether content is still arriving is recorded in the trace line but is
     * NOT part of the condition: the measured drop lands 0.62s after this
     * plugin arms, when the per-turn triggers mount and add height at the
     * tail, which is before the reply has grown -- so requiring "streaming"
     * would decline the exact event the guard exists to repair.
     */
    /* Non-zero while a rail jump owns the viewport. */
    let jumpInFlight = 0

    function startFollowGuard() {
      const STATE = { timer: 0, alive: true }
      let lastHeight = 0
      let lastGrowth = 0
      let pinnedBefore = false
      let lastIntentAt = 0
      let restores = 0
      let cooldownUntil = 0
      let dropWasIntentless = false
      let dropWasNearTail = false
      /* While a repair is running, DSH's own follow animation moves the
         scrollport itself. Sampling during that window reads the animation as
         reader movement and schedules another repair, which is the
         drop/repair/drop loop the reader sees as flicker. */
      /* Which session the counters below belong to. Without this, switching
         sessions carried the previous session's height/pin/cooldown over: the
         first poll in the new session saw a bogus "drop" and the cooldown
         window was inherited. */
      let guardSession = null

      /* Only a gesture aimed at the transcript counts as reader intent. A wheel
         over the sidebar or a floating panel used to stamp `lastIntentAt` too,
         which made the guard misread a genuine drop as deliberate. */
      const stampIntent = (event) => {
        try {
          const target = event && event.target
          const sessionId = currentSessionOnScreen()
          const scroller = sessionId === null ? null : findScroller(sessionId)
          if (scroller && target && target.nodeType &&
            (scroller === target || scroller.contains(target))) {
            lastIntentAt = Date.now()
          }
        } catch { /* intent tracking must never throw */ }
      }

      const scrollerNow = () => {
        try {
          const sid = currentSessionOnScreen()
          return sid === null ? null : findScroller(sid)
        } catch { return null }
      }

      /* Cheap probes used only when a drop is being judged, not per tick. */
      const countInjected = (sessionId) => {
        try { return sessionId === null ? -1 : qa('.dsh-bm-add', sessionId).length } catch { return -1 }
      }
      const countRows = (sessionId) => {
        try { return sessionId === null ? -1 : qa(TURN_ROW_SELECTOR, sessionId).length } catch { return -1 }
      }

      const resetState = () => {
        lastHeight = 0
        lastGrowth = 0
        pinnedBefore = false
        dropWasIntentless = false
        dropWasNearTail = false
        restores = 0
        cooldownUntil = 0
      }

      const poll = () => {
        if (!STATE.alive) return
        try {
          const scroller = scrollerNow()
          if (scroller && scroller.isConnected) {
            const sid = currentSessionOnScreen()
            if (sid !== guardSession) {
              guardSession = sid
              resetState()
            }
            const height = scroller.scrollHeight
            const now = Date.now()
            if (height !== lastHeight) {
              if (height > lastHeight && lastHeight > 0) lastGrowth = now
              lastHeight = height
            }
            /* A freshly armed guard has never seen a growth, which used to
               read as "not streaming" and made it decline the very drop it
               exists to repair. Seed the clock on the first observation. */
            if (lastGrowth === 0) lastGrowth = now

            const pinned = followTailPinned(sid)
            const gap = height - scroller.clientHeight - scroller.scrollTop
            const quiet = lastIntentAt === 0 || now - lastIntentAt > 700
            const streaming = now - lastGrowth < 2500

            /* Judge the DROP at the moment it happens. Deciding later would
               yank back a reader who scrolled up a little while a reply was
               still arriving -- the reading this guard must never disturb. */
            if (pinnedBefore && !pinned) {
              dropWasIntentless = quiet
              dropWasNearTail = gap < 600
              /* Record the verdict even when the guard declines to act: a
                 silent refusal is indistinguishable from a broken guard. */
              /* The extra fields exist to answer "what changed at the drop".
                 bm = number of injected per-turn triggers, rows = mounted Turn
                 rows, grew = ms since the transcript last got taller. A drop
                 that coincides with a bm increase blames the injection; one
                 with plain growth blames DSH's own reader heuristic. */
              traceForce('guard drop: gap=' + Math.round(gap) + ' intentless=' + quiet
                + ' nearTail=' + dropWasNearTail + ' streaming=' + streaming
                + ' cooldown=' + (now <= cooldownUntil) + ' jumping=' + (jumpInFlight > 0)
                + ' grew=' + (lastGrowth === 0 ? -1 : Math.round(now - lastGrowth))
                + ' bm=' + countInjected(sid) + ' rows=' + countRows(sid)
                + ' top=' + Math.round(scroller.scrollTop) + ' sh=' + height)
            }

            /* NOTE: no gap-based repair here. `gap` is
               scrollHeight - clientHeight - scrollTop, which includes the room
               DSH reserves below the viewport for its input fold; measured while
               pinned and idle it sits at ~240px, so treating "gap > 0" as
               "the reader was pushed up" fired on every tick and fought the
               viewport for no reason. The source of the drop is fixed at
               injection time instead (see the turn-trigger overlay); the block
               below only repairs a drop that actually happened. */

            /* Streaming is deliberately NOT required. Measurement showed the
               drop arriving 0.62s after the plugin arms, when the injected
               per-turn buttons land and add height at the tail; the reply then
               grows below an already-unpinned viewport, which is the reported
               "jumps back to my own message". Intent + near-tail + cooldown
               already keep a deliberate reader safe. */
            if (pinnedBefore && !pinned && dropWasIntentless && dropWasNearTail
              && gap < 600 && now > cooldownUntil && jumpInFlight === 0) {
              restores += 1
              if (restores <= 200) {
                cooldownUntil = now + 220
                traceForce('guard: re-pin after intentless drop (gap=' + Math.round(gap)
                  + ' restore#' + restores + ' streaming=' + streaming + ')')
                const restoreId = sid
                if (restoreId !== null) resumeFollowing(restoreId)
              } else if (restores === 201) {
                /* The cap is a safety valve, not a silent stop: say so once, so
                   "the guard stopped repairing" is distinguishable from "the
                   guard never fired" in the log. */
                traceForce('guard: repair cap reached (200), staying pass-through until reload')
              }
            }
            pinnedBefore = pinned
          }
        } catch { /* guard must never throw into the render path */ }
        if (STATE.alive) STATE.timer = setTimeout(poll, 150)
      }

      const intents = ['wheel', 'touchstart', 'pointerdown', 'keydown']
      for (const type of intents) {
        try { window.addEventListener(type, stampIntent, { passive: true, capture: true }) } catch { /* gone */ }
      }

      STATE.timer = setTimeout(poll, 400)
      /* One line per load: with the diagnostics probe retired this is the only
         way to tell from the log that THIS build is the one running. */
      traceForce('guard: armed (follow-on-drop repair active) pinned='
        + (() => { try { const s = currentSessionOnScreen(); return s === null ? 'no-session' : String(followTailPinned(s)) } catch { return '?' } })())

      /* Arm-time growth probe. Mounting the per-turn triggers used to add
         32-80px to the transcript within ~0.6s of arming, which was the whole
         cause of the dropped follow pin. This measures that window directly so
         the zero-layout change can be verified instead of inferred from a drop
         that no longer happens. */
      try {
        const armSid = currentSessionOnScreen()
        const armScroller = armSid === null ? null : findScroller(armSid)
        const armHeight = armScroller === null ? -1 : armScroller.scrollHeight
        setTimeout(() => {
          try {
            if (!STATE.alive) return
            const sc = findScroller(armSid)
            if (sc === null) return
            const anchors = qa('.dsh-bm-add', armSid)
            /* growth must be 0: the trigger is out of flow, so mounting it adds
               no height and DSH's 24px follow tolerance is never crossed.
               spots proves the button still lands on its own Turn row (offset
               from that row's top-right corner, negative = inset). */
            let spots = 'none'
            try {
              const parts = []
              for (let i = 0; i < anchors.length; i += 1) {
                const row = anchors[i].closest(TURN_ROW_SELECTOR)
                const rb = row ? row.getBoundingClientRect() : null
                if (!rb || rb.height <= 0) continue
                const box = anchors[i].getBoundingClientRect()
                parts.push(Math.round(box.top - rb.top) + ',' + Math.round(box.right - rb.right))
                if (parts.length >= 3) break
              }
              if (parts.length > 0) spots = parts.join(' ')
            } catch { /* measurement only */ }
            traceForce('guard: arm growth=' + Math.max(0, sc.scrollHeight - armHeight)
              + ' bm=' + anchors.length + ' spots=' + spots
              + ' rows=' + qa(TURN_ROW_SELECTOR, armSid).length
              + ' pinned=' + followTailPinned(armSid))
          } catch { /* measurement only */ }
        }, 1300)
      } catch { /* measurement only */ }

      return () => {
        STATE.alive = false
        try { clearTimeout(STATE.timer) } catch { /* gone */ }
        for (const type of intents) {
          try { window.removeEventListener(type, stampIntent, true) } catch { /* gone */ }
        }
      }
    }

    /* Every mounted Chat row carries its Turn number, so the visible window
     * says on which side of the target the viewport currently sits. Rows with no
     * box (collapsed groups, hidden tool output, detached wrappers) are skipped:
     * counting them widened the window and made the paging direction wrong. */
    function mountedTurnRange(sessionId) {
      let rows = null
      try { rows = qa(TURN_ROW_SELECTOR, sessionId) } catch { return { lo: null, hi: null } }
      let lo = null
      let hi = null
      for (const row of Array.from(rows)) {
        if (row.offsetParent === null) continue
        let rect = null
        try { rect = row.getBoundingClientRect() } catch { continue }
        if (rect === null || rect.height <= 0) continue
        const value = Number(row.getAttribute('data-chat-turn'))
        if (!Number.isSafeInteger(value)) continue
        if (lo === null || value < lo) lo = value
        if (hi === null || value > hi) hi = value
      }
      return { lo, hi }
    }

    function findTurnRow(turn, sessionId) {
      let rows = null
      try { rows = qa('[data-chat-turn="' + String(turn) + '"]', sessionId) } catch { return null }
      if (rows === null || rows.length === 0) return null
      /* A turn produces MANY `data-chat-turn="N"` elements: the user message,
       * each assistant step, tool-call rows, the turn-tail, plus collapsed
       * group wrappers. A zero-height or unmounted row can never be centered,
       * so prefer one that is painted AND has real height. */
      let first = null
      let painted = null
      for (const row of Array.from(rows)) {
        if (first === null) first = row
        if (row.offsetParent === null) continue
        if (painted === null) painted = row
        let rect = null
        try { rect = row.getBoundingClientRect() } catch { rect = null }
        if (rect && rect.height > 0) return row
      }
      return painted || first
    }

    /* `data-chat-history` mirrors SessionSnapshot['historyLoadStatus']:
     * 'idle' | 'loading' | 'pendingConsumption' | 'error'. Absent while the
     * Session reports no more history. */
    function historyEdgeState(sessionId) {
      let edge = null
      try { edge = q(HISTORY_EDGE_SELECTOR, sessionId) } catch { edge = null }
      if (!edge) return null
      const raw = edge.getAttribute('data-chat-history')
      return raw === null ? '' : raw
    }

    function loadOlderButton(sessionId) {
      let edge = null
      try { edge = q(HISTORY_EDGE_SELECTOR, sessionId) } catch { edge = null }
      if (!edge) return null
      try {
        return edge.querySelector('button:not([disabled])') || null
      } catch {
        return null
      }
    }

    /* A programmatic scrollTop write is not a reader gesture, so the Chat
     * viewport may keep `followingTail` on and snap straight back to the
     * newest row — which made the old jump look like a silent no-op. A
     * synthetic wheel intent marks the reader as having left the tail first. */
    /* Release DSH's tail pin with the smallest possible reader movement.
     * Deliberately NO synthetic wheel event and NO multi-screen pre-scroll:
     * the wheel cancels ChatView's follow animation and the pin is then dropped
     * for good (the transcript stops following new messages), while the 0.6×
     * viewport walk-up moved the view several screens before anything was
     * centred. A 1px upward write is already sampled as reader movement, so the
     * caller's own positioning is the only visible motion. */
    async function unpin(scroller, sessionId) {
      if (!followTailPinned(sessionId)) return true
      try { scroller.scrollTop = Math.max(0, scroller.scrollTop - 1) } catch { return false }
      await frame()
      await sleep(60)
      return true
    }

    /* Detached nodes report zero rects; logging must not throw on them. */
    function safeTop(node) {
      try { const r = node.getBoundingClientRect(); return r ? r.top : 0 } catch { return 0 }
    }

    function safeHeight(node) {
      try { const r = node.getBoundingClientRect(); return r ? r.height : 0 } catch { return 0 }
    }

    function centerOn(scroller, row, maxShift) {
      if (!scroller) {
        try { row.scrollIntoView({ block: 'center', behavior: 'instant' }) } catch {}
        return true
      }
      const box = scroller.getBoundingClientRect()
      const rect = row.getBoundingClientRect()
      const delta = rect.top - box.top - box.height / 2 + Math.min(rect.height, box.height * 0.4) / 2
      if (!(Math.abs(delta) > 2)) return 'ok'
      /* A row more than one viewport away is history the scrollport does not
         hold yet: writing the whole distance in one go fights DSH's restore and
         lands nowhere. Refusing outright was worse -- the caller gave up on a
         row that was plainly mounted a few screens down, which is the
         "landing-failed" the reader sees. So walk one viewport at a time and
         report 'stepped' so the caller comes back for the next step. */
      let shift = delta
      if (typeof maxShift === 'number' && Math.abs(delta) > maxShift) {
        shift = Math.sign(delta) * maxShift
      }
      const floor = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = Math.max(0, Math.min(floor, scroller.scrollTop + shift))
      /* `behavior: 'instant'` overrides any inherited `scroll-behavior: smooth`.
       * With smooth, `scrollTop` reads back the OLD position for several frames,
       * so a landing check would loop forever and every retry restarts the
       * animation — which is exactly the visible flicker. */
      try {
        if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: target, behavior: 'instant' })
        else scroller.scrollTop = target
      } catch {
        try { scroller.scrollTop = target } catch {}
      }
      /* A write that leaves `scrollTop` untouched means this element is not the
       * live scrollport (detached, hidden, or clipped). `scrollIntoView` works
       * from the row upwards and is the only remaining knob. */
      let after = 0
      try { after = scroller.scrollTop } catch { after = target }
      if (Math.abs(after - target) > 2) {
        try { row.scrollIntoView({ block: 'center', behavior: 'instant' }) } catch {}
      }
      return true
    }

    /* Rows currently carrying the jump flash; the pending removal timers are
     * lost if the plugin unloads, so they are tracked and cleared on dispose. */
    const flashTimers = new Set()

    function flash(row) {
      try {
        row.classList.add('dsh-bm-flash')
        flashTimers.add(row)
        setTimeout(() => {
          flashTimers.delete(row)
          try { row.classList.remove('dsh-bm-flash') } catch { /* detached */ }
        }, 1700)
      } catch { /* class decoration only */ }
    }

    /* A `scrollTop` write is not proof of a landing: the viewport may re-pin to
     * the tail, the virtualizer re-measures the moment a row mounts, and a row
     * can sit inside a collapsed container with no height at all. Verify the
     * rect against the scrollport, then correct once more — reporting success
     * without this check is exactly how the jump used to look like a no-op. */
    function rowLanded(scroller, row) {
      if (row === null || !row.isConnected) return false
      if (row.offsetParent === null) return false
      let box = null
      let rect = null
      try {
        box = scroller.getBoundingClientRect()
        rect = row.getBoundingClientRect()
      } catch {
        return false
      }
      if (!box || !rect || rect.height <= 0 || box.height <= 0) return false
      return rect.bottom > box.top + 2 && rect.top < box.bottom - 2
    }

    /* Landing is not instantaneous even when the write sticks: ChatView can
     * re-pin to the tail a beat later (a settle, a fold, a tip change), which
     * is exactly why a second manual click used to be needed. So the write is
     * repeated with real time between attempts, the pin is broken again when
     * it comes back, and only a rect that survives the wait counts. */
    async function settleOn(scroller, turn, sessionId) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const pinned = followTailPinned(sessionId)
        /* Re-resolve before touching anything: ChatView can re-render the flow
         * between attempts, and a cached node then reads fine but never scrolls. */
        const live = scrollerLive(sessionId)
        const stale = live === null || live !== scroller
        if (live !== null) scroller = live
        if (stale) trace('settle #' + attempt + ' scroller stale=' + stale + ' live=' + (live !== null))
        /* No live scrollport this frame (hidden panel, mid re-render): writing
           the old node is a no-op that only costs a landing check, so wait for
           the next frame instead of retrying against a detached element. */
        if (live === null) { await frame(); continue }
        if (pinned) await unpin(scroller, sessionId)
        /* The row reference from the caller can be a node the virtualizer
         * already unmounted the moment a scroll write moved the window — so
         * re-find it fresh each attempt, by turn. */
        let row = findTurnRow(turn, sessionId)
        if (row === null) { trace('settle #' + attempt + ' no row'); continue }
        const before = Math.round(scroller.scrollTop)
        /* A row more than one viewport away is history the scrollport does not
           hold yet; one cross-screen scrollTop write is undone by DSH's restore
           and lands nowhere, so the distance is walked a viewport at a time
           until the row is inside the box. This is what makes a mounted-but-far
           row reachable instead of ending in "landing-failed". */
        const viewport = scroller.clientHeight || 600
        let walked = 0
        let live2 = row
        let outcome = centerOn(scroller, live2, viewport)
        while (outcome !== 'ok' && walked < 12) {
          await frame()
          /* The row must be re-resolved every step: a scroll write moves the
             virtualiser window, so the node captured before the loop can be
             unmounted (zero rect) and would report the same huge distance
             forever. */
          const fresh = findTurnRow(turn, sessionId)
          if (fresh === null) { await sleep(40); walked += 1; continue }
          live2 = fresh
          const moved = Math.abs(Math.round(scroller.scrollTop) - before) >= 2
          const again = centerOn(scroller, live2, viewport)
          if (again === 'ok') { outcome = 'ok'; break }
          if (!moved) break
          outcome = again
          walked += 1
        }
        if (outcome !== 'ok' && walked > 0) trace('settle #' + attempt + ' walked ' + walked + ' viewport(s)')
        /* Everything below must use the freshly resolved node: `row` may be a
           detached element once a scroll write moved the virtualiser window,
           and a detached node reports rect 0 forever. */
        row = live2
        const afterWrite = Math.round(scroller.scrollTop)
        await frame()
        await frame()
        const first = rowLanded(scroller, row)
        if (first) {
          await sleep(160)
          const fresh = findTurnRow(turn, sessionId)
          if (fresh !== null) row = fresh
          const kept = rowLanded(scroller, row)
          trace('settle #' + attempt + ' pinned=' + pinned + ' first=' + first + ' kept=' + kept
            + ' top=' + Math.round(scroller.scrollTop) + ' rowTop=' + Math.round(safeTop(row))
            + ' boxTop=' + Math.round(scroller.getBoundingClientRect().top))
          if (kept) return row
          continue
        }
        if (centerOn(scroller, row, viewport) !== 'ok') {
          /* One more pass at the row now that a frame has settled; if it still
             is not centred, keep walking rather than abandoning the jump. */
          for (let extra = 0; extra < 4; extra++) {
            await frame()
            if (centerOn(scroller, row, viewport) === 'ok') break
          }
        }
        await frame()
        const fresh2 = findTurnRow(turn, sessionId)
        if (fresh2 !== null) row = fresh2
        const second = rowLanded(scroller, row)
        trace('settle #' + attempt + ' pinned=' + pinned + ' before=' + before + ' afterWrite=' + afterWrite
          + ' first=false retry=' + second + ' top=' + Math.round(scroller.scrollTop)
          + ' rowTop=' + Math.round(safeTop(row))
          + ' rowH=' + Math.round(safeHeight(row))
          + ' boxTop=' + Math.round(scroller.getBoundingClientRect().top)
          + ' boxH=' + Math.round(scroller.getBoundingClientRect().height)
          + ' sh=' + Math.round(scroller.scrollHeight))
        if (second) {
          await sleep(160)
          if (rowLanded(scroller, row)) return row
        }
      }
      trace('settle failed after 3 attempts')
      return null
    }

    /* ------------------------------------------------------------------ */
    /* rail-driven jump                                                     */
    /* ------------------------------------------------------------------ */
    /* ChatView's fixed-pitch rail exposes every Turn and its `navigateToTurn`
     * is the ONLY jump DSH performs itself: it pauses bottom-follow, keeps the
     * reading anchor while history grows (`loadThrough(seq)` pages in one
     * operation), and finally aligns the row through the viewport's own
     * `write()` — which records the new offset as `observation.top`, so the
     * follow/reading policy does not treat it as reader movement.
     *
     * Writing `scrollTop` from the outside skips all of that: the viewport
     * keeps restoring its paging anchor, each write is undone, and the retry
     * loop shows up as the flicker the user reported. So the plugin asks the
     * rail to navigate and merely waits for ChatView's result — through the
     * rail's own `onNavigate` prop, never by clicking (and never by scrolling)
     * the rail. */
    function railMarks(sessionId) {
      const marks = []
      try {
        for (const mark of qa('button[data-index]', sessionId)) {
          if (mark.closest('nav') !== null) marks.push(mark)
        }
      } catch { return [] }
      return marks
    }

    /* The Turn a rail mark jumps to, read off its own (localised) label. DSH
     * builds the rail by merging the loaded window with the host outline, so
     * `turn - data-index` is not a reliable offset; the label is. */
    function railTurnOf(mark) {
      const label = mark ? mark.getAttribute('aria-label') || '' : ''
      const numbers = label.match(/\d+/g)
      if (numbers === null || numbers.length === 0) return null
      /* DSH renders the label from a localised template whose only number is the
         Turn (`Jump to turn 12` / `跳转到第 12 轮`). A locale that ALSO contains a
         digit — a count, an ordinal suffix, a version — yields two candidates;
         rejecting the whole label used to kill every cross-turn search jump
         (`reveal rail failed`), so fall back to the trailing number: the template
         always ends with the Turn placeholder. */
      const turn = Number(numbers[numbers.length - 1])
      return Number.isSafeInteger(turn) ? turn : null
    }

    /* ── the rail, without touching the rail ────────────────────────────────
     * Looking a mark up used to mean scrolling the rail itself (up to 14 writes
     * per probe) to force the virtualiser to render it, while DSH's own effect
     * kept re-centring the active mark on the same scrollport. Two writers, one
     * scrollport — that is the flicker the reader saw.
     *
     * `TurnNavigator` receives `{ items, onNavigate }` as props, so the very
     * call its `onClick` makes is reachable through the React tree. It works
     * for every item, rendered or not, and it never touches the rail's DOM. */
    function railHandle(sessionId) {
      const candidates = [q('nav[aria-label] button[data-index]', sessionId), q('nav[aria-label]', sessionId)]
      for (const node of candidates) {
        let fiber = reactOwn(node, '__reactFiber$')
        for (let depth = 0; fiber && depth < 30; depth++) {
          const props = fiber.memoizedProps
          if (props && Array.isArray(props.items) && typeof props.onNavigate === 'function') {
            return { items: props.items, onNavigate: props.onNavigate, activeTurn: props.activeTurn }
          }
          fiber = fiber.return
        }
      }
      return null
    }

    /* Fallback for a build where the rail props are not reachable: accept only a
     * mark that is ALREADY rendered (never scroll the rail to conjure one). */
    function railMarkFor(turn, sessionId) {
      for (const mark of railMarks(sessionId)) {
        try {
          if (railTurnOf(mark) === turn) return mark
        } catch { /* one unreadable mark must not stop the scan */ }
      }
      return null
    }

    /* Returns `{ row, reason }`. `row` is set only on a confirmed landing;
       otherwise `reason` names the failure so the caller can decide instead of
       guessing. `no-handle` is the one case that also means "this build exposes
       no rail API", where the legacy pager is still allowed to try. */
    async function jumpViaRail(turn, sessionId, aborted) {
      const abortedNow = () => typeof aborted === 'function' && aborted()
      if (abortedNow()) return { row: null, reason: 'aborted' }

      const handle = railHandle(sessionId)
      let mark = null
      let expectsPaging = false
      /* The follow guard must stand down for the WHOLE request, including the
         synchronous `onNavigate`/`click` itself: a re-pin racing that call would
         run `navigation.cancel()`, null ChatView's pending jump and silently
         swallow the landing. */
      jumpInFlight += 1
      try {
      if (handle !== null) {
        const item = handle.items.find((entry) => entry && entry.turn === turn) || null
        if (item === null) {
          trace('rail: turn ' + turn + ' is not one of ' + handle.items.length + ' rail items')
          return { row: null, reason: 'not-in-items' }
        }
        const kind = item.anchor ? item.anchor.kind : 'loaded'
        expectsPaging = kind === 'unloaded'
        trace('rail: fiber items=' + handle.items.length + ' turn=' + turn + ' anchor=' + kind)
        try { handle.onNavigate(item) } catch { trace('rail: onNavigate threw'); return { row: null, reason: 'threw' } }
      } else {
        mark = railMarkFor(turn, sessionId)
        if (mark === null) { trace('rail: unreachable and no rendered mark for ' + turn); return { row: null, reason: 'no-handle' } }
        trace('rail: click fallback turn=' + turn)
        try { mark.click() } catch { return { row: null, reason: 'no-handle' } }
      }

      /* From here until this function returns, DSH owns the viewport: a jump is
         either in flight or being confirmed. */
      /* ChatView's `navigateToTurn` runs the whole operation itself: it pauses
       * bottom-follow, keeps the reading anchor, pages history through
       * `loadThrough(seq)` and then aligns the row. Paging ~35 pages of a long
       * transcript takes tens of seconds, and while that jump is in flight
       * `checkHistory()` refuses any other pager, so the plugin must wait here
       * instead of starting its own paging (which is what produced the endless
       * "loading earlier conversations"). */
      const started = Date.now()
      let busy = expectsPaging
      let lastBusy = expectsPaging ? started : 0
      while (Date.now() - started < 60000) {
        await frame()
        /* Typing another query supersedes this landing. The navigation already
         * started, so stop polling instead of queueing a second one. */
        if (abortedNow()) { trace('rail: aborted mid-flight'); return { row: null, reason: 'aborted' } }
        const live = scrollerLive(sessionId)
        if (live !== null) {
          const row = findTurnRow(turn, sessionId)
          if (row !== null && rowLanded(live, row)) {
            await sleep(220)
            const again = findTurnRow(turn, sessionId)
            if (again !== null && rowLanded(live, again)) {
              trace('rail: landed after ' + (Date.now() - started) + 'ms paging=' + expectsPaging)
              return { row: again, reason: null }
            }
          }
        }
        const edge = historyEdgeState(sessionId)
        const markBusy = mark !== null && mark.getAttribute('aria-busy') === 'true'
        if (markBusy || edge === 'loading' || edge === 'pendingConsumption') {
          busy = true
          lastBusy = Date.now()
        }
        /* A Turn that is already loaded lands synchronously, so nothing busy
         * after 4s means this navigation never started. A Turn that still needs
         * paging gets a longer grace: its first page request is not observable
         * immediately. Once busy, the jump is DSH's own and abandoning it
         * mid-flight would leave the transcript half-paged. */
        if (!busy && Date.now() - started > (expectsPaging ? 8000 : 4000)) {
          trace('rail: no navigation started after ' + (Date.now() - started) + 'ms paging=' + expectsPaging)
          return { row: null, reason: 'no-landing' }
        }
        if (busy && Date.now() - lastBusy > 12000) {
          trace('rail: navigation went quiet without landing (state=' + edge + ')')
          return { row: null, reason: 'no-landing' }
        }
        await sleep(110)
      }
      trace('rail: landing timeout paging=' + expectsPaging)
      return { row: null, reason: 'no-landing' }
      } finally {
        jumpInFlight -= 1
      }
    }

    const JUMP_MAX_PAGES = 240
    const JUMP_PAGE_WAIT_MS = 220
    const JUMP_PROBES = 48

    /* ------------------------------------------------------------------ */
    /* temporary jump diagnostics                                          */
    /* ------------------------------------------------------------------ */
    /* A click that goes wrong leaves nothing behind to inspect, so each
     * jump posts a short trace that the host half appends to
     * `~/.dsh/dsh-redmark-trace.log`. Remove this block and the
     * `/session-bookmarks/trace` route when the jump is settled. */

    /* Jump/find diagnostics (report v3 §D): kept ON so a regression can be
     * proven from a log instead of inferred from code. The browser half posts a
     * compact trace and the host half appends it to
     * `~/.dsh/dsh-redmark-trace.log`. Never affects behaviour: every
     * failure path is swallowed. */
    let traceLines = []
    let traceTimer = 0
    let traceBudget = 0

    function trace(line) {
      try {
        if (traceBudget <= 0) return
        traceBudget -= 1
        traceLines.push(String(line).slice(0, 300))
        if (traceTimer) return
        traceTimer = setTimeout(flushTrace, 200)
      } catch {
        /* diagnostics must never affect behaviour */
      }
    }

    function traceForce(line) {
      try {
        traceLines.push(String(line).slice(0, 300))
        if (!traceTimer) traceTimer = setTimeout(flushTrace, 120)
      } catch {
        /* diagnostics must never affect behaviour */
      }
    }

    function flushTrace() {
      traceTimer = 0
      const lines = traceLines
      traceLines = []
      if (!lines.length) return
      try {
        fetch('/dsh-redmark/trace', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ lines }),
        }).catch(() => {})
      } catch {
        /* endpoint may be absent: keep jumping anyway */
      }
    }

    /* Sweep a few screens around the current position looking for the row.
     * `hi < turn` means everything visible is older, so the target is below. */
    async function sweepNear(turn, scroller, budget, sessionId) {
      const limit = budget || 30
      let stalled = 0
      for (let i = 0; i < limit; i++) {
        const live = scrollerLive(sessionId)
        if (live !== null) scroller = live
        const row = findTurnRow(turn, sessionId)
        if (row !== null) return row
        const viewport = scroller.clientHeight || 600
        const range = mountedTurnRange(sessionId)
        const down = range.hi !== null && range.hi < turn
        const next = Math.max(0, scroller.scrollTop + (down ? viewport * 0.75 : viewport * -0.75))
        if (Math.abs(next - scroller.scrollTop) < 1) {
          stalled += 1
          if (stalled >= 3) return null
        } else {
          stalled = 0
        }
        try { scroller.scrollTop = next } catch { return null }
        await frame()
      }
      return null
    }

    /* Reveal `turn`, paging older history in when its row is not loaded yet.
     *
     * Phase 1 parks at the very top until the loaded head reaches the target:
     * history only arrives there, and the Session pages it in on its own as
     * soon as the scrollport reports a top position, so a page is counted
     * whenever the loaded head actually grew — no matter who asked for it.
     * Phase 2 bisects the scrollport: Turn numbers increase downwards, so the
     * mounted window tells which half still holds the target, then a short
     * sweep lands on the row. Resolves `{ ok, pages, reason }`. */
    async function jumpToTurn(turn, sessionId, seq, landTurn) {
      const n = Number(turn)
      if (!Number.isSafeInteger(n)) return { ok: false, pages: 0, reason: 'bad-turn' }
      /* `landTurn === false` is the text-bookmark case: the caller will centre
       * the quoted passage itself afterwards, so landing on the whole turn row
       * here would be a visible intermediate step (jump to the turn, then to the
       * passage). We still page/rail to get the row MOUNTED, but skip the row
       * centring so the passage pass owns the single visible motion. */
      const centerRow = landTurn !== false
      /* A newer jump (or a view change) supersedes this one: the phases below
       * page history and write scrollTop, so they must stop as soon as the
       * reader has asked for something else instead of fighting it. */
      const jumpTag = jumpSequence
      const stale = () => jumpTag !== jumpSequence
      traceBudget = 220
      trace('jump begin turn=' + n + ' session=' + sessionId + ' seq=' + seq + ' centerRow=' + centerRow)

      /* The Chat flow has to be the mounted view before any of this means
       * anything; a heavy transcript can take a while to replace the previous
       * view, so the wait is generous rather than a fixed guess. */
      let scroller = null
      let waited = 0
      for (let i = 0; i < 180 && scroller === null; i++) {
        await frame()
        scroller = findScroller(sessionId)
        waited = i + 1
      }
      if (scroller === null) {
        trace('no scroller after ' + waited + ' frames, flow=' + (q(CHAT_FLOW_SELECTOR, sessionId) !== null))
        return { ok: false, pages: 0, reason: 'no-scroller' }
      }
      trace('scroller at frame ' + waited + ' sh=' + scroller.scrollHeight + ' ch=' + scroller.clientHeight
        + ' top=' + Math.round(scroller.scrollTop) + ' pinned=' + followTailPinned(sessionId))

      /* Measured landing, not a hopeful write: `landedOnce` keeps whether the
       * row was ever found so a final failure can name the right phase. */
      let landedOnce = false
      let pages = 0

      /* Already mounted: land on it without touching history at all. */
      await unpin(scroller, sessionId)
      if (findTurnRow(n, sessionId) !== null) {
        if (centerRow) {
          const landed = await settleOn(scroller, n, sessionId)
          trace('fast path row found settle=' + (landed !== null))
          if (landed) { flash(landed); return { ok: true, pages } }
          landedOnce = true
        } else {
          /* Row is mounted; leave it where it is and let the caller centre the
             passage. Confirm mount without centring. */
          trace('fast path row mounted (text), deferring to passage centre')
          return { ok: true, pages }
        }
      }
      trace('fast path miss')

      /* Let ChatView's own rail navigation page the history and land the row —
       * the only path that also keeps the reading anchor coherent, which is
       * what stops the write/undo flicker. No `unpin()` here on purpose: the
       * rail navigation already handles follow/anchor, and the 1px write would
       * only drop the pin a second time for no gain. */
      const rail = await jumpViaRail(n, sessionId, stale)
      if (stale()) { trace('jump superseded after rail'); return { ok: false, pages, reason: 'superseded' } }
      if (rail.row !== null) { if (centerRow) flash(rail.row); return { ok: true, pages: Math.max(pages, 1) } }
      /* Only an unreachable rail may hand over to the legacy pager: that loop
         writes `scrollTop` and clicks `loadOlder`, which the viewport samples as
         reader movement and undoes — the sweep the reader sees as flicker
         (report v3 §五, audit S3). Every other failure is reported as it
         happened, so the caller can say where the jump stopped. */
      if (rail.reason !== 'no-handle') {
        trace('rail gave up (' + rail.reason + '), no blind paging')
        return { ok: false, pages, reason: 'rail-' + rail.reason }
      }
      trace('rail unreachable, falling back to the legacy pager')

      /* Phase 1 — make sure the turn is loaded. */
      let stalls = 0
      /* A wall-clock deadline as well as a stall counter: while the edge state
       * reads 'loading'/'pendingConsumption' the stall counter never advances, so
       * a history page that never arrives used to burn all JUMP_MAX_PAGES
       * iterations (240 x 220ms) before giving up. */
      let lastGrowthAt = Date.now()
      for (let guard = 0; guard < JUMP_MAX_PAGES; guard++) {
        if (stale()) { trace('p1 superseded at #' + guard); return { ok: false, pages, reason: 'superseded' } }
        if (Date.now() - lastGrowthAt > 20000) {
          trace('p1 no page for 20s at #' + guard + ', giving up')
          return { ok: false, pages, reason: 'no-progress' }
        }
        const live = scrollerLive(sessionId)
        if (live !== null) scroller = live
        await unpin(scroller, sessionId)
        /* Two writes, not one: sitting still at 0 fires no scroll event, and
         * the history check that consumes a page runs off those events. */
        try { scroller.scrollTop = 1 } catch { break }
        await frame()
        try { scroller.scrollTop = 0 } catch { break }
        await frame()
        await frame()

        const row = findTurnRow(n, sessionId)
        if (row !== null) {
          if (!centerRow) { trace('p1 mounted (text) at #' + guard); return { ok: true, pages } }
          const landed = await settleOn(scroller, n, sessionId)
          if (landed) { flash(landed); trace('p1 landed at #' + guard); return { ok: true, pages } }
          landedOnce = true
        }

        const range = mountedTurnRange(sessionId)
        if (guard < 30 || guard % 10 === 0) {
          trace('p1 #' + guard + ' lo=' + range.lo + ' hi=' + range.hi + ' target=' + n
            + ' state=' + historyEdgeState(sessionId) + ' pages=' + pages + ' stalls=' + stalls)
        }
        if (range.lo !== null && range.lo <= n) { trace('p1 head reached at #' + guard); break }

        const height = scroller.scrollHeight
        const state = historyEdgeState(sessionId)
        if (state === 'error') return { ok: false, pages, reason: 'history-error' }
        if (state === 'loading') {
          /* A page is already being fetched: nothing to click, just wait. */
          await sleep(150)
        } else {
          /* 'pendingConsumption' means a page arrived and DSH is waiting for a
           * consumption trigger — a button click (loadEarlier -> requestHistoryCheck
           * -> consumeHistory) is exactly that trigger, so sleeping on it dead-locks
           * paging. Click on ANY state that is not 'loading' and not 'error'. */
          const button = loadOlderButton(sessionId)
          if (state !== null && button !== null) { try { button.click() } catch { /* the growth check decides */ } }
          await sleep(JUMP_PAGE_WAIT_MS)
        }

        const after = mountedTurnRange(sessionId)
        const grew = scroller.scrollHeight > height + 8
          || (range.lo !== null && after.lo !== null && after.lo < range.lo)
        if (grew) {
          pages += 1
          stalls = 0
          lastGrowthAt = Date.now()
        } else if (state !== 'loading' && state !== 'pendingConsumption') {
          /* A page in flight is not a stall; only a settled edge is. */
          stalls += 1
        }
        if (stalls >= 10) return { ok: false, pages, reason: 'exhausted' }
      }

      /* Phase 2 — bisect the scrollport. */
      {
        const live = scrollerLive(sessionId)
        if (live !== null) scroller = live
      }
      await unpin(scroller, sessionId)
      let low = 0
      let high = Math.max(0, scroller.scrollHeight - (scroller.clientHeight || 0))
      try { scroller.scrollTop = 0 } catch { /* bounded below anyway */ }
      await frame()

      for (let i = 0; i < JUMP_PROBES; i++) {
        if (stale()) { trace('p2 superseded at #' + i); return { ok: false, pages, reason: 'superseded' } }
        const live = scrollerLive(sessionId)
        if (live !== null) scroller = live
        const row = findTurnRow(n, sessionId)
        if (row !== null) {
          if (!centerRow) { trace('p2 mounted (text) at probe #' + i); return { ok: true, pages } }
          const landed = await settleOn(scroller, n, sessionId)
          if (landed) { flash(landed); trace('p2 landed row at probe #' + i); return { ok: true, pages } }
          landedOnce = true
        }

        const range = mountedTurnRange(sessionId)
        if (range.lo === null || range.hi === null) { trace('p2 #' + i + ' no range'); await sleep(50); continue }
        trace('p2 #' + i + ' top=' + Math.round(scroller.scrollTop) + ' lo=' + range.lo + ' hi=' + range.hi
          + ' low=' + Math.round(low) + ' high=' + Math.round(high))

        if (range.lo > n) high = scroller.scrollTop
        else if (range.hi < n) low = scroller.scrollTop
        else {
          const near = await sweepNear(n, scroller, 26, sessionId)
          trace('p2 bracketed sweep=' + (near !== null))
          if (near !== null) {
            if (!centerRow) { trace('p2 mounted (text) via sweep'); return { ok: true, pages } }
            const landed = await settleOn(scroller, n, sessionId)
            if (landed) { flash(landed); trace('p2 swept landed'); return { ok: true, pages } }
            landedOnce = true
          }
          break
        }

        if (high - low <= 4) { trace('p2 bracket collapsed'); break }
        const next = low + (high - low) / 2
        if (Math.abs(next - scroller.scrollTop) < 1) { trace('p2 stuck'); break }
        try { scroller.scrollTop = next } catch { break }
        await frame()
      }

      const near = await sweepNear(n, scroller, 40, sessionId)
      trace('final sweep=' + (near !== null) + ' landedOnce=' + landedOnce)
      if (stale()) return { ok: false, pages, reason: 'superseded' }
      if (near !== null) {
        if (!centerRow) { trace('final sweep mounted (text)'); return { ok: true, pages } }
        const landed = await settleOn(scroller, n, sessionId)
        if (landed) { flash(landed); return { ok: true, pages } }
        landedOnce = true
      }
      return { ok: false, pages, reason: landedOnce ? 'landing-failed' : 'not-mounted' }
    }

    /* ------------------------------------------------------------------ */
    /* toast: feedback that outlives the view switch                      */
    /* ------------------------------------------------------------------ */

    let toastEl = null
    let toastTimer = 0

    function hideToast() {
      if (toastTimer) { try { clearTimeout(toastTimer) } catch {} }
      toastTimer = 0
      if (toastEl && toastEl.parentNode) {
        try { toastEl.parentNode.removeChild(toastEl) } catch {}
      }
      toastEl = null
    }

    function showToast(kind, text) {
      try {
        if (!toastEl || !toastEl.isConnected) {
          toastEl = document.createElement('div')
          toastEl.className = 'dsh-bm-toast'
          toastEl.setAttribute('data-dsh-dsh-redmark', '')
          toastEl.setAttribute('role', 'status')
          toastEl.setAttribute('aria-live', 'polite')
          document.body.appendChild(toastEl)
        }
        toastEl.setAttribute('data-kind', kind)
        toastEl.textContent = text
        if (toastTimer) { try { clearTimeout(toastTimer) } catch {} }
        toastTimer = setTimeout(hideToast, kind === 'error' ? 6000 : kind === 'loading' ? 20000 : 2600)
      } catch {
        /* no document: nothing to show */
      }
    }

    let jumpSequence = 0

    /* The bookmarks view unmounts the moment the chat view activates, so an
     * in-view hint disappears with it — the toast lives on <body> and is the
     * only place the reader can actually observe the outcome. */
    async function jumpTo(openView, turn, sessionId, seq, bm) {
      const seq0 = ++jumpSequence
      if (typeof openView === 'function') {
        try { openView('chat', '') } catch { /* chat view may not be registered */ }
      }

      /* Feedback must start immediately: a click that looks ignored is worse
       * than a jump that is merely slow, and this toast is the only signal a
       * reader has while the view is being replaced. */
      let slow = 0
      try {
        slow = setTimeout(() => {
          if (seq0 === jumpSequence) showToast('loading', tt('jump.loading'))
        }, 120)
      } catch { slow = 0 }

      let result = { ok: false, pages: 0 }
      const isText = Boolean(bm && bm.kind === 'text' && bm.nodeKey)
      const landTurn = isText ? false : true
      try {
        result = await jumpToTurn(turn, sessionId, seq, landTurn)
      } catch {
        result = { ok: false, pages: 0 }
      }
      /* One immediate retry: the first attempt is the one that pages history
       * in, so the second usually finds the row already mounted (this is what
       * readers ended up doing by hand when the first pass gave up).
       * Reasons that CANNOT improve on a second pass are excluded: `exhausted`
       * and `history-error` would just repeat the whole 240-page sweep (two
       * visible sweeps, twice the flicker), and `superseded` means a newer
       * jump owns the viewport now. */
      const retryable = !result.ok
        && result.reason !== 'exhausted'
        && result.reason !== 'history-error'
        && result.reason !== 'superseded'
        && result.reason !== 'no-progress'
      if (retryable && seq0 === jumpSequence) {
        /* If the Chat flow never took over the scrollport, ask again: the view
         * switch can be swallowed while the previous view is still unmounting. */
        if (result.reason === 'no-scroller' && typeof openView === 'function') {
          try { openView('chat', '') } catch { /* not registered */ }
          await sleep(120)
        }
        try {
          const again = await jumpToTurn(turn, sessionId, seq, landTurn)
          const loaded = Math.max(again.pages || 0, result.pages || 0)
          result = again.ok
            ? { ok: true, pages: loaded }
            : { ok: false, pages: loaded, reason: again.reason || result.reason }
        } catch { /* keep the first diagnosis */ }
      }
      if (slow) { try { clearTimeout(slow) } catch {} }
      if (seq0 !== jumpSequence) return result

      trace('jump end ok=' + result.ok + ' pages=' + result.pages + ' reason=' + (result.reason || '-')
        + ' flow=' + (q(CHAT_FLOW_SELECTOR, sessionId) !== null)
        + ' pinned=' + followTailPinned(sessionId))
      flushTrace()

      /* A text bookmark also names the quoted node; landing on the Turn alone
         leaves the quote wherever it happens to sit inside a long Turn. The
         quote pass also runs when the Turn landing failed: the saved passage
         usually sits in a row that IS mounted even though the Turn-level
         paging gave up, and reaching the passage is what the reader asked for. */
      let quoteOk = true
      let landedByQuote = false
      if (bm && bm.kind === 'text' && bm.nodeKey) {
        const el = await revealQuotedNode(bm, sessionId)
        if (el === null) {
          const found = locateQuoteByText(bm, sessionId)
          if (found !== null) {
            const scroller = findScroller(sessionId)
            if (scroller !== null) {
              const viewport = scroller.clientHeight || 600
              for (let step = 0; step < 10; step += 1) {
                if (centerOn(scroller, found.row, viewport) === 'ok') break
                await frame()
              }
              if (found.range !== null) {
                let outcome = centerQuoteRange(scroller, found.range, viewport)
                for (let step = 0; step < 12 && outcome !== 'ok'; step += 1) {
                  await frame()
                  outcome = centerQuoteRange(scroller, found.range, viewport)
                }
                traceForce('jump: quote centred by text ok=' + (outcome === 'ok') + ' turn=' + String(bm.turn))
              }
              landedByQuote = true
            }
          } else {
            quoteOk = false
            traceForce('jump: quote node ' + bm.nodeKey + ' not mounted after landing turn=' + turn)
          }
        } else {
          landedByQuote = true
        }
        const paint = paintHighlights(sessionId)
        if (paint && paint.missing) {
          traceForce('jump: highlight repaint painted=' + paint.painted + ' missing=' + paint.missing)
        }
      }
      if (landedByQuote && !result.ok) {
        result = { ok: true, pages: result.pages || 0, viaQuote: true }
      }

      if (!result.ok) {
        const key = result.reason === 'exhausted' ? 'jump.failedStart' : 'jump.failed'
        /* The trailing code is a diagnostic: it names the phase that gave up so
         * a screenshot is enough to tell which step needs attention. */
        const code = result.reason ? ' [' + result.reason + ']' : ''
        showToast('error', tt(key).replace('{pages}', String(result.pages)) + code)
      } else {
        /* Always acknowledge, so "nothing happened" can never be ambiguous. */
        const base = tt(result.pages > 0 ? 'jump.loaded' : 'jump.located')
        showToast('ok', quoteOk ? base : base + ' ' + tt('jump.quotePending'))
      }
      return result
    }

    function fmtTime(iso) {
      try {
        const d = new Date(iso)
        if (isNaN(d.getTime())) return ''
        const p = (n) => (n < 10 ? '0' : '') + n
        return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes())
      } catch {
        return ''
      }
    }

    /* ------------------------------------------------------------------ */
    /* text-range bookmarks (selection capture + CSS Custom Highlight)     */
    /* ------------------------------------------------------------------ */

    const HIGHLIGHT_NAME = 'dsh-bm-mark'
    const SEL_BTN_ATTR = 'data-dsh-bm-selbtn'

    function closestTurn(node) {
      let el = node && node.nodeType === 1 ? node : node && node.parentElement
      while (el && el.nodeType === 1) {
        if (el.hasAttribute && el.hasAttribute('data-chat-turn')) return el
        el = el.parentElement
      }
      return null
    }

    function closestNodeKey(node) {
      let el = node && node.nodeType === 1 ? node : node && node.parentElement
      while (el && el.nodeType === 1) {
        if (el.hasAttribute && el.hasAttribute('data-chat-node-key')) return el
        el = el.parentElement
      }
      return null
    }

    /* Look a stored `nodeKey` up in the live transcript. Quoted attribute
       selectors need the quotes escaped; a session with several conversations
       mounted would otherwise resolve the key in the wrong one. */
    function nodeElByKey(sessionId, nodeKey) {
      if (typeof nodeKey !== 'string' || nodeKey === '') return null
      const sel = '[data-chat-node-key="' + nodeKey.replace(/["\\]/g, '\\$&') + '"]'
      const direct = q(sel, sessionId)
      if (direct) return direct
      /* The transcript virtualizer can re-key a row it remounted; fall back to
         a scan so a persisted range still finds its host after a restart. */
      try {
        for (const el of Array.from(qa('[data-chat-node-key]', sessionId))) {
          if (el.getAttribute('data-chat-node-key') === nodeKey) return el
        }
      } catch { /* not mounted yet */ }
      return null
    }

    function sessionIdOf(node) {
      let el = node && node.nodeType === 1 ? node : node && node.parentElement
      while (el && el.nodeType === 1) {
        if (el.hasAttribute && el.hasAttribute('data-conversation-session')) {
          return el.getAttribute('data-conversation-session')
        }
        el = el.parentElement
      }
      return null
    }

    /* Character offsets of a DOM selection measured from the start of `root`. */
    function measureOffsets(root, range) {
      const pre = document.createRange()
      pre.selectNodeContents(root)
      const from = (container, offset) => {
        const r = document.createRange()
        r.setStart(root, 0)
        r.setEnd(container, offset)
        return r.toString().length
      }
      const start = from(range.startContainer, range.startOffset)
      const end = from(range.endContainer, range.endOffset)
      return start <= end ? { start, end } : { start: end, end: start }
    }

    /* Inverse of measureOffsets: a Range covering [start, end) of `root`'s text. */
    function rangeFromOffsets(root, start, end) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
      let seen = 0
      let first = null
      let last = null
      let node = walker.nextNode()
      while (node) {
        const len = node.nodeValue ? node.nodeValue.length : 0
        if (first === null && seen + len >= start) first = { node, offset: start - seen }
        if (last === null && seen + len >= end) last = { node, offset: end - seen }
        if (first !== null && last !== null) break
        seen += len
        node = walker.nextNode()
      }
      if (!first || !last) return null
      try {
        const r = document.createRange()
        r.setStart(first.node, Math.max(0, Math.min(first.offset, first.node.nodeValue.length)))
        r.setEnd(last.node, Math.max(0, Math.min(last.offset, last.node.nodeValue.length)))
        return r
      } catch {
        return null
      }
    }

    /* Collapse whitespace the same way the saved quote was collapsed, while
     * remembering where every surviving character came from. Without this map a
     * quote that spans a line break can never be found again: the saved string
     * is `a b`, the DOM is `a\nb`, and a plain indexOf misses it -- the bookmark
     * then "lands somewhere else" because the offset path is the one that
     * happened to succeed, with stale numbers. */
    function flattenWithMap(text) {
      const flat = []
      const map = []
      let gap = false
      for (let i = 0; i < text.length; i += 1) {
        const ch = text[i]
        if (ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r' || ch === '\u00a0') {
          gap = true
          continue
        }
        if (gap && flat.length > 0) { flat.push(' '); map.push(i) }
        gap = false
        flat.push(ch)
        map.push(i)
      }
      return { flat: flat.join(''), map }
    }

    /* Resolve a saved text bookmark to a live Range inside `root`.
     *
     * The stored `start`/`end` are offsets measured when the passage was picked.
     * A reply that is still streaming (or that re-renders its markdown) inserts
     * text above the quote, so those numbers drift and the range lands a
     * paragraph early -- which is exactly "it jumps somewhere else". So the
     * offsets are used only when they actually point at the quote; otherwise the
     * quote string is searched for, with the saved prefix/suffix as tie-breakers
     * because a short quote can appear more than once. */
    function quoteRange(root, bm) {
      if (!root || !bm) return null
      const quote = typeof bm.quote === 'string' ? bm.quote.trim() : ''
      if (quote === '') return null
      const full = root.textContent || ''
      if (full === '') return null
      const start = Number(bm.start)
      const end = Number(bm.end)
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && end > start && end <= full.length) {
        const atOffsets = full.slice(start, end)
        if (atOffsets === quote) return rangeFromOffsets(root, start, end)
        if (flattenWithMap(atOffsets).flat === flattenWithMap(quote).flat) return rangeFromOffsets(root, start, end)
      }
      const here = flattenWithMap(full)
      const needle = flattenWithMap(quote).flat
      if (needle === '') return null
      let at = here.flat.indexOf(needle)
      if (at < 0) {
        /* Saved quotes are truncated to 600 chars and may end mid-word. */
        const short = needle.slice(0, Math.min(needle.length, 40))
        at = short === '' ? -1 : here.flat.indexOf(short)
        if (at < 0) {
          /* Not a failure yet: the caller retries every node of the Turn. The
             per-bookmark report happens there, once, instead of on every paint. */
          return null
        }
      }
      const prefix = typeof bm.prefix === 'string' ? flattenWithMap(bm.prefix).flat : ''
      if (prefix !== '' && here.flat.slice(Math.max(0, at - prefix.length), at) !== prefix) {
        /* Quoted text repeats in the node: prefer the hit whose prefix matches. */
        let cursor = -1
        while ((cursor = here.flat.indexOf(needle, cursor + 1)) >= 0) {
          if (here.flat.slice(Math.max(0, cursor - prefix.length), cursor) === prefix) { at = cursor; break }
        }
      }
      const from = here.map[at]
      const last = Math.min(here.flat.length - 1, at + needle.length - 1)
      const to = here.map[last]
      if (from === undefined || to === undefined || to <= from) return null
      return rangeFromOffsets(root, from, to + 1)
    }

    /* NOTE: the stylesheet constant in this module is named `CSS`, which shadows
     * the browser's `CSS` namespace. Highlight lookups must therefore go through
     * `globalThis`, or every `CSS.highlights` reference silently resolves to
     * undefined (that bug made all highlighting a no-op). */
    function hlApi() {
      try {
        const api = typeof globalThis !== 'undefined' ? globalThis.CSS : undefined
        return api && api.highlights ? api.highlights : null
      } catch { return null }
    }

    function highlightCtor() {
      try {
        if (typeof globalThis !== 'undefined' && typeof globalThis.Highlight === 'function') return globalThis.Highlight
      } catch { /* noop */ }
      try {
        if (typeof Highlight === 'function') return Highlight
      } catch { /* noop */ }
      return null
    }

    function highlightSupported() {
      return !!hlApi() && typeof highlightCtor() === 'function'
    }

    function makeHighlight(ranges) {
      const ctor = highlightCtor()
      if (typeof ctor !== 'function' || !ranges || !ranges.length) return null
      try { return new ctor(...ranges) } catch { return null }
    }

    /* Repaint every stored text range of one session. Cheap enough to redo on
     * each bookmark write: a session has at most MAX_LIST ranges.
     *
     * A virtualised transcript only mounts the rows near the viewport, so a
     * range whose host row is not mounted yet cannot be painted. That is not a
     * failure: `missing` counts them so the caller can retry after the row is
     * scrolled into view (a restart used to drop the highlight for good because
     * nothing ever retried and the missing rows were never reported). */
    function paintHighlights(sessionId) {
      const empty = { painted: 0, missing: 0 }
      if (!highlightSupported()) return empty
      try {
        const items = (sessionId ? readStore(sessionId) : []).filter((x) => x.kind === 'text' && x.nodeKey)
        const ranges = []
        let missing = 0
        for (const it of items) {
          let r = null
          const el = nodeElByKey(sessionId, it.nodeKey)
          if (el) r = quoteRange(el, it)
          /* A re-rendered reply mints a new key for the same text, so a key that
             resolves but no longer holds the quote (or a key that no longer
             resolves at all) is retried against every node of its Turn. */
          if (r === null) {
            const found = findQuoteInTurn(it, sessionId)
            if (found !== null) r = found.range
          }
          if (r) ranges.push(r)
          else missing += 1
        }
        if (!ranges.length) {
          const reg = hlApi(); if (reg) reg.delete(HIGHLIGHT_NAME)
          return { painted: 0, missing }
        }
        const highlight = makeHighlight(ranges)
        if (!highlight) return { painted: 0, missing }
        const reg = hlApi(); if (reg) reg.set(HIGHLIGHT_NAME, highlight)
        return { painted: ranges.length, missing }
      } catch { return empty }
    }

    /* ---- find in conversation (floating bar, Ctrl/Cmd+F) ----------------- */
    const FIND_ALL = 'dsh-bm-find'
    const FIND_ACTIVE = 'dsh-bm-find-active'
    const findSubs = new Set()
    const findState = {
      open: false, query: '', index: 0, ranges: [], turns: [], ordinals: [], logical: [],
      count: 0, sessionId: null, hint: null, wasFollowing: false, savedAnchor: undefined, navigated: false,
      /* The Turn the last rail navigation went to. Stepping between matches that
         share a Turn must not restart that navigation: each start pauses
         bottom-follow, re-centres the rail's active mark and (for an unloaded
         Turn) pages history, which is what the rail looked like it was
         "flickering" while the reader stepped through a long result list. */
      lastNavTurn: null, lastNavAt: 0,
    }

    function setFindHint(hint) {
      const prev = findState.hint
      const same = (prev === null && hint === null) ||
        (prev !== null && hint !== null && prev.turn === hint.turn)
      if (same) return
      findState.hint = hint
      notifyFind()
    }
    let findRevealToken = 0
    /* Last scanned match count, so the unbudgeted scan trace only logs changes. */
    let lastScanCount = -1

    function findSnapshot() {
      return { open: findState.open, query: findState.query, index: findState.index, count: findState.count, hint: findState.hint }
    }

    function notifyFind() {
      for (const fn of findSubs) { try { fn() } catch { /* noop */ } }
    }

    function computeFindRanges(sessionId) {
      findState.ranges = []
      findState.turns = []
      findState.sessionId = sessionId || findState.sessionId
      if (!findState.open) return
      const needle = findState.query.trim().toLowerCase()
      if (!needle) return
      const root = sessionId ? sessionRoot(sessionId) : document
      const flow = root && root.querySelector ? root.querySelector(CHAT_FLOW_SELECTOR) : null
      if (!flow) return
      const found = []
      const turns = []
      const walker = document.createTreeWalker(flow, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const value = node.nodeValue
          if (!value || !value.trim()) return NodeFilter.FILTER_REJECT
          const el = node.parentElement
          if (!el) return NodeFilter.FILTER_REJECT
          if (el.closest('[data-dsh-bm-ui]') || el.closest('[data-dsh-bm-selbtn]')) return NodeFilter.FILTER_REJECT
          if (el.closest('[hidden], [aria-hidden="true"]')) return NodeFilter.FILTER_REJECT
          return NodeFilter.FILTER_ACCEPT
        },
      })
      let node = walker.nextNode()
      while (node && found.length < 500) {
        const hay = node.nodeValue.toLowerCase()
        let from = 0
        while (from <= hay.length - needle.length) {
          const at = hay.indexOf(needle, from)
          if (at < 0) break
          const range = document.createRange()
          range.setStart(node, at)
          range.setEnd(node, at + needle.length)
          found.push(range)
          turns.push(turnOfNode(node))
          from = at + needle.length
          if (found.length >= 500) break
        }
        node = walker.nextNode()
      }
      /* Remember WHICH match is active before the list is rebuilt: after history
         pages in or the virtualizer recycles rows, the same array index points at
         a different match, so Enter used to jump somewhere else. */
      const anchorMatch = findState.logical && findState.logical.length
        ? findState.logical[Math.min(findState.index, findState.logical.length - 1)]
        : null
      findState.ranges = found
      findState.turns = turns
      const ordinals = []
      const seenPerTurn = new Map()
      for (let i = 0; i < turns.length; i += 1) {
        const t = turns[i]
        const n = seenPerTurn.get(t) || 0
        ordinals.push(n)
        seenPerTurn.set(t, n + 1)
      }
      findState.ordinals = ordinals
      /* The list is recomputed from the mounted rows on every scan, so it is the
         live truth: `count` follows it exactly (like the reference plugin). The
         index is clamped INSIDE the list instead of being reset to 0, so a
         recycle that briefly shortens the list never jumps the cursor back to
         the first match. */
      findState.count = found.length
      /* An empty scan is NOT an answer: it means the match lives in history this
         viewport has not loaded yet. Keeping `logical`/`index` lets the cursor
         come back to the same match once more rows mount, instead of dropping
         the reader at match #1 of a fresh list. */
      if (findState.count > 0) findState.logical = turns.map((t, i) => ({ turn: t, ordinal: ordinals[i] }))
      if (findState.count === 0) {
        if (!findState.query.trim()) { findState.index = 0; findState.hint = null }
      } else {
        /* Re-find the same MATCH (turn + ordinal within that turn) instead of
           keeping the same array index: a re-scan after paging or row recycling
           otherwise moved the cursor to whatever now sits at that index. */
        const restored = anchorMatch === null ? -1
          : findState.logical.findIndex((m) => m.turn === anchorMatch.turn && m.ordinal === anchorMatch.ordinal)
        findState.index = restored >= 0 ? restored : Math.min(findState.index, findState.count - 1)
      }
      /* `traceForce` ignores the budget, and this runs on every scroll/mutation
         rescan (~240ms) — logging only a CHANGE keeps the signal without
         writing a line every quarter second for as long as find stays open. */
      if (found.length !== lastScanCount) {
        lastScanCount = found.length
        traceForce('scan ranges=' + found.length + ' idx=' + findState.index)
      }
    }

    function paintFindRanges() {
      if (!highlightSupported()) return
      try {
        if (findState.ranges.length) {
          const all = makeHighlight(findState.ranges)
          const reg1 = hlApi(); if (all && reg1) reg1.set(FIND_ALL, all)
        } else { const reg2 = hlApi(); if (reg2) reg2.delete(FIND_ALL) }
        const activeRange = findState.ranges[findState.index]
        const active = activeRange ? makeHighlight([activeRange]) : null
        const reg3 = hlApi(); if (active && reg3) reg3.set(FIND_ACTIVE, active)
        else { const reg4 = hlApi(); if (reg4) reg4.delete(FIND_ACTIVE) }
      } catch { /* decoration only */ }
    }

    /* Bring a match into the comfortable reading band with the SMALLEST movement.
     * Deliberately no `unpin`/synthetic wheel here: a fake wheel cancels DSH's
     * follow animation and the pin is then dropped for good, which is what made
     * the transcript stop following new messages after using find. A plain
     * scroll write is enough — the reading policy samples it by itself. */
    function alignRangeInScroller(range, scroller) {
      try {
        const rect = range.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        if (!rect.height && !rect.width) return false
        const topBand = box.top + box.height * 0.3
        const bottomBand = box.top + box.height * 0.7
        if (rect.top >= topBand && rect.bottom <= bottomBand) return true
        const delta = rect.top < topBand
          ? rect.top - topBand
          : rect.top - (box.top + box.height * 0.45)
        /* Correction only — one screen at most. Anything longer belongs to the
           rail: a large bare `scrollTop` write is judged as reader movement by
           the viewport, which then restores its saved anchor (the snap-back). */
        if (Math.abs(delta) > box.height) return false
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        const top = Math.max(0, Math.min(max, scroller.scrollTop + delta))
        if (Math.abs(top - scroller.scrollTop) < 2) return true
        try { scroller.scrollTo({ top, behavior: 'instant' }) } catch { scroller.scrollTop = top }
        return true
      } catch { return false }
    }

    /* Unbounded centring of an ALREADY MOUNTED match. The one-screen cap in
       `alignRangeInScroller` exists because a long bare write is sampled as
       reader movement; the caller therefore takes a reading-anchor snapshot
       first and writes it back afterwards, so the viewport keeps the reader's
       old position while the view moves to the match. */
    function centerRangeInScroller(range, scroller) {
      try {
        const rect = range.getBoundingClientRect()
        const box = scroller.getBoundingClientRect()
        if (!rect.height && !rect.width) return false
        const delta = rect.top - box.top - box.height / 2 + Math.min(rect.height, box.height * 0.4) / 2
        if (!(Math.abs(delta) > 2)) return true
        const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
        const top = Math.max(0, Math.min(max, scroller.scrollTop + delta))
        try { scroller.scrollTo({ top, behavior: 'instant' }) } catch { scroller.scrollTop = top }
        return true
      } catch { return false }
    }

    /* The turn a match belongs to — captured while the node is still attached,
       because a recycled row leaves a Range without a usable geometry. */
    function turnOfNode(node) {
      try {
        const el = node && node.nodeType === 1 ? node : (node && node.parentElement) || null
        const row = el && el.closest ? el.closest('[data-chat-turn]') : null
        if (!row) return null
        const n = Number(row.getAttribute('data-chat-turn'))
        return Number.isSafeInteger(n) ? n : null
      } catch { return null }
    }

    function turnOfRange(range) {
      return range ? turnOfNode(range.startContainer) : null
    }

    function liveScroller(sessionId) {
      return findScroller(sessionId) || (sessionId ? sessionRoot(sessionId) : document).querySelector(SCROLLER_SELECTOR)
    }

    async function revealFindMatch(sessionId) {
      /* Invalidate any in-flight reveal FIRST, before any early return: a
         pending rail click for a previous query must not land after the user
         has typed a different one (the log showed a stale `rail landed turn=52`
         firing right after a query that had zero matches). */
      const revealToken = ++findRevealToken
      const index = findState.index
      const range = findState.ranges[index]
      const turn = findState.turns[index]
      const ordinal = findState.ordinals[index]
      traceForce('reveal idx=' + index + '/' + findState.count + ' turn=' + turn + ' ord=' + ordinal + ' have=' + !!range)
      if (!findState.open || !findState.count) return
      if (!range) { setFindHint(typeof turn === 'number' ? { turn } : null); return }

      const scroller = liveScroller(sessionId)
      if (!scroller) return
      const box = scroller.getBoundingClientRect()
      const rect = (() => { try { return range.getBoundingClientRect() } catch { return null } })()
      const comfortablyVisible = rect && rect.height > 0 &&
        rect.top >= box.top + box.height * 0.15 && rect.bottom <= box.bottom - box.height * 0.15
      if (comfortablyVisible) {
        traceForce('reveal already-visible idx=' + index)
        setFindHint(null)
        paintFindRanges()
        return
      }

      const mounted = mountedTurnRange(sessionId)
      const inWindow = typeof turn === 'number' && mounted.lo !== null && turn >= mounted.lo && turn <= mounted.hi

      /* A match whose Turn is mounted has its row in the DOM: there is no
         history to page and no rail to animate, so the reveal is a plain scroll.
         It used to hand far-but-mounted matches to `navigateToTurn`, which
         pauses bottom-follow, commits a reading position and re-centres the
         rail's active mark — for every step through the result list. That is
         what made the rail flicker and left some matches on an unchanged view
         (the trace: `reveal align ok=false` then rail for every far Turn). */
      let moved = false
      /* While the transcript is pinned, DSH answers any non-reader scroll with
         `followTail()` on the spot (`use-chat-reading.ts:162`), so a local write
         would be undone by design. Skip straight to the rail in that case: it
         navigates through the viewport instead of against it. */
      const pinned = followTailPinned(sessionId)
      if (inWindow && !pinned) {
        const before = scroller.scrollTop
        moved = alignRangeInScroller(range, scroller)
        traceForce('reveal align ok=' + moved + ' turn=' + turn + ' before=' + Math.round(before) + ' after=' + Math.round(scroller.scrollTop))
        if (revealToken !== findRevealToken) return
        if (!moved) {
          /* Take the reader's anchor BEFORE the long write and put it back after:
             the viewport then keeps "the reader was here" memory while the view
             follows the match, so reopening the session does not land on the
             search result. Verified two frames later — if DSH restored anyway,
             fall through to the rail instead of leaving the view put. */
          const anchor = findState.savedAnchor !== undefined ? findState.savedAnchor : readAnchor(sessionId)
          if (findState.savedAnchor === undefined) findState.savedAnchor = anchor
          centerRangeInScroller(range, scroller)
          await frame()
          await frame()
          if (revealToken !== findRevealToken) return
          restoreAnchor(sessionId, anchor)
          setTimeout(() => restoreAnchor(sessionId, anchor), 700)
          const seen = (() => { try { return range.getBoundingClientRect() } catch { return null } })()
          const view = scroller.getBoundingClientRect()
          moved = !!seen && seen.height > 0 && seen.bottom > view.top && seen.top < view.bottom
          traceForce('reveal local ok=' + moved + ' turn=' + turn + ' top=' + Math.round(scroller.scrollTop))
          if (revealToken !== findRevealToken) return
        }
        if (moved) {
          /* Even a local move flips `followingTail` off within ~500ms (a bare
             write is sampled as reader movement), so it is recorded exactly like
             a rail jump: closing find restores follow and the pre-search
             anchor. */
          findState.navigated = true
          findState.lastNavTurn = null
          setFindHint(null)
          paintFindRanges()
          return
        }
      }

      /* Off-window: only now does history have to be loaded, so only now does
         DSH's own navigation run. Snapshot the reader's follow state so a search
         jump can be undone on close — `navigateToTurn` pauses bottom-follow
         permanently, which is what made the transcript stop following new
         messages after a search. */
      if (typeof turn !== 'number') {
        setFindHint(null)
        paintFindRanges()
        return
      }
      /* Several matches live in one Turn. Re-running the navigation for the same
         Turn restarts DSH's active-mark centring and, for an unloaded Turn,
         pages history again — visible as the rail jumping around while the
         reader steps through results. One navigation per Turn per second. */
      if (findState.lastNavTurn === turn && Date.now() - findState.lastNavAt < 1200) {
        traceForce('reveal same-turn skip turn=' + turn)
        paintFindRanges()
        return
      }
      findState.navigated = true
      findState.lastNavTurn = turn
      findState.lastNavAt = Date.now()
      const anchor = findState.savedAnchor !== undefined ? findState.savedAnchor : readAnchor(sessionId)
      traceForce('reveal rail turn=' + turn + ' anchor=' + (anchor === undefined ? 'unreachable' : anchor === null ? 'tail' : 'turn=' + anchor.turn) + ' wasFollowing=' + findState.wasFollowing)
      setFindHint(null)
      paintFindRanges()
      const rail = await jumpViaRail(turn, sessionId, () => revealToken !== findRevealToken)
      if (revealToken !== findRevealToken) return
      if (rail.row === null) {
        /* Let the next step retry the same Turn instead of being skipped. */
        findState.lastNavTurn = null
        traceForce('reveal rail failed turn=' + turn + ' reason=' + rail.reason)
        setFindHint({ turn })
        paintFindRanges()
        return
      }
      if (restoreAnchor(sessionId, anchor)) {
        /* `commit` runs again on the landing's follow-up resize/scroll samples,
           so the snapshot is written twice: once now, once after the layout
           settles. */
        setTimeout(() => restoreAnchor(sessionId, anchor), 700)
      }
      paintFindRanges()
    }

    function refreshFind(reveal) {
      computeFindRanges(findState.sessionId)
      paintFindRanges()
      notifyFind()
      if (reveal) void revealFindMatch(findState.sessionId)
    }

    function currentSessionOnScreen() {
      const root = document.querySelector(SESSION_CONTENT_SELECTOR)
      return root ? root.getAttribute('data-conversation-session') : null
    }

    function toggleFind(open) {
      const next = typeof open === 'boolean' ? open : !findState.open
      if (findState.open === next) return
      findState.sessionId = currentSessionOnScreen() || findState.sessionId
      if (next) {
        /* Snapshot the reader's state BEFORE find scrolls anything. This is the
           only moment the real follow/pin state is still intact. */
        findState.wasFollowing = followTailPinned(findState.sessionId)
        findState.savedAnchor = readAnchor(findState.sessionId)
        findState.navigated = false
      } else if (findState.navigated) {
        /* A find jump called `navigateToTurn`, which paused bottom-follow and
           pinned the landing as the reading anchor. Undo BOTH on close so the
           transcript resumes following new messages and reopens at the tail —
           this is the "会话回跳" the user reported. Use DSH's own handles. */
        trace('find close: wasFollowing=' + findState.wasFollowing + ' restoring follow')
        restoreAnchor(findState.sessionId, findState.savedAnchor)
        if (findState.wasFollowing) resumeFollowing(findState.sessionId)
        findState.navigated = false
      }
      findState.open = next
      if (!next) {
        /* Bumping the token cancels any landing still in flight: a jump that
         * completes after the bar closed would otherwise pin its own reading
         * anchor again, undoing the restore above. */
        findRevealToken += 1
        findState.query = ''
        findState.index = 0
        findState.count = 0
        findState.logical = []
        findState.hint = null
      }
      refreshFind(next)
    }

    /* Typing always re-reveals the first match again — that is what makes a
       search feel like a search. The jump itself is anchored (see
       revealFindMatch), so it can no longer move the reading position. */
    function setFindQuery(value) {
      findState.query = value
      findState.index = 0
      findState.count = 0
      findState.logical = []
      findState.hint = null
      traceForce('query="' + String(value).slice(0, 24) + '" reset idx=0')
      refreshFind(true)
    }

    function stepFind(delta) {
      const total = findState.count
      traceForce('step entry delta=' + delta + ' total=' + total + ' idx=' + findState.index)
      if (!total) return
      findState.index = (findState.index + delta + total) % total
      traceForce('step delta=' + delta + ' idx=' + findState.index + ' total=' + total)
      paintFindRanges()
      notifyFind()
      void revealFindMatch(findState.sessionId)
    }

    function toBody(node) {
      if (createPortal) {
        try { return createPortal(node, document.body) } catch { /* fall through */ }
      }
      return node
    }

    function SearchIcon(size) {
      const px = size || 14
      return h('svg', {
        className: 'dsh-bm-icon', width: px, height: px, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', focusable: 'false',
      }, h('circle', { cx: 11, cy: 11, r: 7 }), h('path', { d: 'M20 20l-3.6-3.6' }))
    }

    function FindBar(props) {
      const sessionId = props.sessionId
      const [snap, setSnap] = useState(() => findSnapshot())
      const inputRef = useRef(null)
      useEffect(() => {
        /* Switching sessions while the bar is open used to keep the old
           session's ranges and saved anchor alive: the next close restored that
           anchor into the NEW session. Close the bar and let it reopen clean. */
        if (sessionId) {
          if (findState.open && findState.sessionId && findState.sessionId !== sessionId) toggleFind(false)
          findState.sessionId = sessionId
        }
        const fn = () => setSnap(findSnapshot())
        findSubs.add(fn)
        return () => { findSubs.delete(fn) }
      }, [sessionId])
      useEffect(() => {
        if (snap.open && inputRef.current) {
          inputRef.current.focus()
          try { inputRef.current.select() } catch { /* noop */ }
        }
      }, [snap.open])
      const barRef = useRef(null)
      useEffect(() => {
        if (!snap.open) return undefined
        let alive = true
        let raf = 0
        const place = () => {
          if (!alive) return
          const el = barRef.current
          const anchor = findBarAnchor()
          if (el && anchor) {
            const right = anchor.right + 'px'
            const top = anchor.top + 'px'
            if (el.style.right !== right) el.style.right = right
            if (el.style.top !== top) el.style.top = top
            if (el.style.left !== 'auto') {
              el.style.left = 'auto'
              el.style.transform = 'none'
            }
          }
          raf = requestAnimationFrame(place)
        }
        raf = requestAnimationFrame(place)
        /* The transcript grows in three ways while the bar is open: history pages
           load, streamed turns append, and the virtualizer recycles rows. Every
           one of them invalidates the painted ranges, so re-scan on scroll and on
           DOM mutation instead of forcing the user to retype the query. */
        let scrollTimer = 0
        const rescan = () => {
          const beforeCount = findState.count
          const beforeSig = findState.turns.join(',')
          computeFindRanges(findState.sessionId)
          /* Re-paint unconditionally (the CSS Highlight API is atomic and keeps
             ranges bound to the live nodes) but only wake the bar when the
             numbers actually change — idle transcript mutations would otherwise
             re-render the bar every couple of seconds. */
          paintFindRanges()
          if (findState.count !== beforeCount || findState.turns.join(',') !== beforeSig) notifyFind()
        }
        const onScroll = () => {
          if (scrollTimer) return
          scrollTimer = setTimeout(() => {
            scrollTimer = 0
            rescan()
          }, 240)
        }
        window.addEventListener('scroll', onScroll, true)
        let observer = null
        let mutationTimer = 0
        try {
          const root = (findState.sessionId ? sessionRoot(findState.sessionId) : document) || document
          const flow = root.querySelector ? root.querySelector(CHAT_FLOW_SELECTOR) : null
          const target = flow || root
          if (target && typeof MutationObserver === 'function') {
            observer = new MutationObserver((records) => {
              /* Highlights are painted through the CSS Custom Highlight API and
                 insert no DOM, so any mutation coming from our own bar/menu is
                 noise — filtering it keeps the observer from feeding itself. */
              let relevant = false
              for (const rec of records) {
                const t = rec.target
                if (t && t.nodeType === 1 && t.closest && t.closest('[data-dsh-bm-ui]')) continue
                relevant = true
                break
              }
              if (!relevant) return
              if (mutationTimer) return
              mutationTimer = setTimeout(() => {
                mutationTimer = 0
                rescan()
              }, 260)
            })
            observer.observe(target, { childList: true, subtree: true, characterData: true })
          }
        } catch { /* observation is best effort */ }
        return () => {
          alive = false
          cancelAnimationFrame(raf)
          if (scrollTimer) clearTimeout(scrollTimer)
          if (mutationTimer) clearTimeout(mutationTimer)
          if (observer) observer.disconnect()
          window.removeEventListener('scroll', onScroll, true)
        }
      }, [snap.open])
      if (!snap.open) return null
      const typed = snap.query.trim() !== ''
      /* `0 / 0` claimed "no match anywhere" while the truth was "nothing matched
         in the rows this viewport happens to hold". Say what is actually true. */
      const progress = typed ? (snap.count ? (snap.index + 1) + ' / ' + snap.count : '') : ''
      const hint = snap.hint && typed
        ? h('span', { className: 'dsh-bm-findhint', title: tt('find.offTurn') },
          tt('find.offTurn').replace('{turn}', String(snap.hint.turn)))
        : (typed && snap.count === 0
          ? h('span', { className: 'dsh-bm-findhint', title: tt('find.unloaded') }, tt('find.unloaded'))
          : null)
      const bar = h('div', { ref: barRef, className: 'dsh-bm-findbar', 'data-dsh-bm-ui': 'true', role: 'search' },
        SearchIcon(14),
        h('input', {
          ref: inputRef,
          type: 'text',
          className: 'dsh-bm-findinput',
          value: snap.query,
          placeholder: tt('find.placeholder'),
          'aria-label': tt('find.placeholder'),
          onChange: (e) => setFindQuery(e.target.value),
          onKeyDown: (e) => {
            if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1) }
            else if (e.key === 'Escape') { e.stopPropagation(); toggleFind(false) }
          },
        }),
        hint,
        progress ? h('span', { className: 'dsh-bm-findcount' }, progress) : null,
        h('button', { type: 'button', className: 'dsh-bm-findbtn', disabled: snap.count === 0, title: tt('find.prev'), 'aria-label': tt('find.prev'), onClick: () => stepFind(-1) }, '↑'),
        h('button', { type: 'button', className: 'dsh-bm-findbtn', disabled: snap.count === 0, title: tt('find.next'), 'aria-label': tt('find.next'), onClick: () => stepFind(1) }, '↓'),
        h('button', { type: 'button', className: 'dsh-bm-findbtn', title: tt('find.close'), 'aria-label': tt('find.close'), onClick: () => toggleFind(false) }, '×'))
      return toBody(bar)
    }

    function HeaderFindButton() {
      return h('button', {
        type: 'button',
        className: 'dsh-bm-headbtn',
        'data-dsh-bm-findbtn': 'true',
        title: tt('find.tip'),
        'aria-label': tt('find.label'),
        onClick: () => toggleFind(),
      }, SearchIcon(15))
    }

    /* Where the find bar parks: its right edge sits just left of the session
     * header's icon cluster, so it never covers a tool and it follows the
     * cluster when the layout shifts (right panel, window resize). */
    function findBarAnchor() {
      let btn = null
      try { btn = document.querySelector('[data-dsh-bm-findbtn]') } catch { btn = null }
      if (!btn) btn = document.querySelector('.dsh-bm-headbtn')
      if (!btn) return null
      let best = null
      let node = btn.parentElement
      for (let depth = 0; depth < 4 && node; depth += 1) {
        const rect = node.getBoundingClientRect()
        if (rect.height > 0 && rect.height <= 64 && rect.width >= 60 && rect.width <= 460) best = rect
        node = node.parentElement
      }
      if (!best) return null
      const right = Math.max(10, Math.round(window.innerWidth - best.left + 8))
      const top = Math.round(best.top + (best.height - 26) / 2)
      return { right, top, leftOf: Math.round(best.left) }
    }

    /* A single floating "bookmark this selection" control. It is appended to
     * <body> because a text selection can straddle any slot boundary, and it is
     * removed with the plugin. */
    /* Reads the current DOM selection when it sits inside one chat message of
     * the open conversation. Returns null when there is nothing usable. */
    function readSelection() {
      let sel = null
      try { sel = window.getSelection() } catch { sel = null }
      if (!sel || sel.isCollapsed || !sel.rangeCount) return null
      const range = sel.getRangeAt(0)
      const flow = (range.commonAncestorContainer.nodeType === 1
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement)
      if (!flow || !flow.closest || !flow.closest(CHAT_FLOW_SELECTOR)) return null
      const turnEl = closestTurn(range.commonAncestorContainer)
      const nodeEl = closestNodeKey(range.commonAncestorContainer)
      const sid = sessionIdOf(range.commonAncestorContainer)
      if (!turnEl || !nodeEl || !sid) return null
      const turnNo = parseInt(turnEl.getAttribute('data-chat-turn'), 10)
      if (!Number.isSafeInteger(turnNo)) return null
      const quote = String(range.toString() || '').replace(/\s+/g, ' ').trim()
      if (quote.length < 1) return null
      const offs = measureOffsets(nodeEl, range)
      const full = nodeEl.textContent || ''
      return {
        sessionId: sid,
        quote,
        rect: range.getBoundingClientRect(),
        item: {
          id: newId(),
          kind: 'text',
          turn: turnNo,
          nodeKey: nodeEl.getAttribute('data-chat-node-key'),
          start: offs.start,
          end: offs.end,
          quote: quote.slice(0, 600),
          prefix: full.slice(Math.max(0, offs.start - 32), offs.start),
          suffix: full.slice(offs.end, offs.end + 32),
          note: '',
          sessionTitle: currentSessionTitle() || resolveSessionTitle(sid),
          createdAt: new Date().toISOString(),
        },
      }
    }

    /* Two affordances on a text selection, matching the reference plugin's
     * split: a plain (left) selection offers 引用, a right click offers 收藏. */
    function mountSelectionTools() {
      let ui = null
      const hide = () => { if (ui) ui.style.display = 'none' }
      const ensure = () => {
        if (ui) return ui
        ui = document.createElement('div')
        ui.className = 'dsh-bm-selmenu'
        ui.setAttribute(SEL_BTN_ATTR, '1')
        ui.style.display = 'none'
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'dsh-bm-selbtn'
        b.setAttribute('data-mode', 'save')
        b.textContent = tt('sel.add')
        b.addEventListener('mousedown', (e) => e.preventDefault())
        b.addEventListener('click', (e) => {
          e.preventDefault()
          e.stopPropagation()
          const pending = ui.__dsh_bm_sel
          if (!pending) return
          addBookmark(pending.sessionId, pending.item)
          paintHighlights(pending.sessionId)
          showToast('ok', tt('sel.saved'))
          hide()
          try { window.getSelection().removeAllRanges() } catch { /* ignore */ }
        })
        ui.appendChild(b)
        document.body.appendChild(ui)
        return ui
      }

      const place = (rect) => {
        const el = ensure()
        el.setAttribute('data-mode', 'save')
        const x = Math.min(window.innerWidth - 170, Math.max(8, rect.left + rect.width / 2 - 56))
        const y = rect.top > 48 ? rect.top - 38 : rect.bottom + 10
        el.style.left = x + 'px'
        el.style.top = y + 'px'
        el.style.display = 'flex'
      }

      /* Left-drag selection keeps the shell's own quote action; only the
       * context menu offers bookmarking, so the two never stack. */
      const onUp = () => { hide() }

      const onContext = (e) => {
        const picked = readSelection()
        if (!picked) return
        e.preventDefault()
        ensure().__dsh_bm_sel = picked
        place(picked.rect)
      }

      const onDown = (e) => {
        if (e && e.target && e.target.closest && e.target.closest('[' + SEL_BTN_ATTR + ']')) return
        hide()
      }

      document.addEventListener('mouseup', onUp, true)
      document.addEventListener('contextmenu', onContext, true)
      document.addEventListener('mousedown', onDown, true)
      window.addEventListener('scroll', hide, true)
      return () => {
        document.removeEventListener('mouseup', onUp, true)
        document.removeEventListener('contextmenu', onContext, true)
        document.removeEventListener('mousedown', onDown, true)
        window.removeEventListener('scroll', hide, true)
        if (ui && ui.parentNode) ui.parentNode.removeChild(ui)
        ui = null
      }
    }

    /* The composer's inputActions only reach slot components, so a headless
     * dock entry hands them to the imperative selection tooling. */
    let composerBridge = { sessionId: null, draft: '', actions: null }
    function ComposerBridge(props) {
      const draft = props && props.useInput ? props.useInput((s) => s.draft) : ''
      useEffect(() => {
        composerBridge = {
          sessionId: (props && props.sessionId) || null,
          draft: typeof draft === 'string' ? draft : '',
          actions: (props && props.inputActions) || null,
        }
        return () => { composerBridge = { sessionId: null, draft: '', actions: null } }
      }, [props && props.sessionId, draft, props && props.inputActions])
      return null
    }

    function quoteIntoComposer(quote) {
      const text = String(quote || '').trim()
      if (!text) return false
      const actions = composerBridge.actions
      /* `insertQuote` is the composer's own quote face: the sent message carries
       * the selection as a Markdown blockquote and the composer shows a chip. */
      try {
        if (actions && typeof actions.insertQuote === 'function') {
          if (actions.insertQuote(text)) return true
        }
      } catch { /* fall through to a plain draft write */ }
      const body = text.split(/\n+/).map((line) => '> ' + line.trim()).join('\n') + '\n\n'
      try {
        if (actions && typeof actions.setDraft === 'function') {
          const base = String(composerBridge.draft || '')
          actions.setDraft(base.trim() ? base.replace(/\s+$/, '') + '\n\n' + body : body)
          return true
        }
        if (actions && typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
          if (actions.insertText(body, actions.captureInsertion())) return true
        }
      } catch { /* fall through */ }
      showToast('error', tt('sel.noInput'))
      return false
    }

    /* Last session title a session-scoped component saw. The selection button
     * lives outside React, so it stamps new bookmarks from here. */
    let lastSessionTitle = ''
    function currentSessionTitle() { return lastSessionTitle }
    function rememberSessionTitle(title) {
      if (typeof title === 'string' && title.trim()) lastSessionTitle = title.trim()
    }

    /* ------------------------------------------------------------------ */
    /* icons                                                              */
    /* ------------------------------------------------------------------ */
    /* Emoji are the shipped look here (the header, popover and empty state all
     * render this one glyph), so the comment describes what the code does. */
    const BOOKMARK_EMOJI = '\uD83D\uDD16'

const ICON_PATHS = {
      bookmark: 'M6.5 3.75h11a.75.75 0 0 1 .75.75v15.4a.75.75 0 0 1-1.15.63L12 16.9l-5.1 3.63a.75.75 0 0 1-1.15-.63V4.5a.75.75 0 0 1 .75-.75Z',
      pencil: 'M4 20h4.2L19 9.2a1.6 1.6 0 0 0 0-2.26l-1.94-1.94a1.6 1.6 0 0 0-2.26 0L4 15.8V20Zm9.6-13.3 3.7 3.7',
      trash: 'M4.5 6.75h15M9.5 6.75V4.5h5v2.25M6.75 6.75 7.6 20.1a.9.9 0 0 0 .9.84h7a.9.9 0 0 0 .9-.84l.85-13.35M10.2 10.5v6.6M13.8 10.5v6.6',
      close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
      check: 'M5 12.6l4.6 4.6L19 7.4',
    }

    function Icon(name, size, filled) {
      const d = ICON_PATHS[name]
      if (!d) return null
      const px = size || 16
      return h('svg', {
        className: 'dsh-bm-icon',
        width: px,
        height: px,
        viewBox: '0 0 24 24',
        fill: filled ? 'currentColor' : 'none',
        stroke: 'currentColor',
        strokeWidth: 1.7,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, h('path', { d }))
    }

    /* ------------------------------------------------------------------ */
    /* view: the bookmark list                                            */
    /* ------------------------------------------------------------------ */

    function BookmarkView(props) {
      const sessionId = props.sessionId
      const openView = props.openView
      useLocaleTick()
      const list = useBookmarks(sessionId)
      const [editing, setEditing] = useState(null)
      const [draft, setDraft] = useState('')
      const editRef = useRef(null)

      /* Grow the row editor with its content where the engine has no
       * `field-sizing` support: 0 height to measure, then the scrollHeight. */
      useEffect(() => {
        const el = editRef.current
        if (!el || typeof el.scrollHeight !== 'number') return
        /* `CSS` in this module is the injected style-sheet string, which shadows
         * the browser's global `CSS` object: the old `typeof CSS !== 'undefined'
         * && CSS.supports(...)` guard was therefore always false and the manual
         * measurement below always ran. Reach the real object explicitly. */
        const engine = globalThis.CSS
        if (engine && typeof engine.supports === 'function' && engine.supports('field-sizing', 'content')) return
        el.style.height = 'auto'
        el.style.height = Math.min(180, Math.max(30, el.scrollHeight)) + 'px'
      }, [draft, editing])

      const sorted = useMemo(
        () => list
          .filter((bm) => bm && bm.sessionId ? bm.sessionId === sessionId : true)
          .slice()
          .sort((a, b) => a.turn - b.turn),
        [list, sessionId],
      )

      const beginEdit = (am) => { setEditing(am.id); setDraft(am.note || '') }
      const cancelEdit = () => { setEditing(null); setDraft('') }
      const commitEdit = () => {
        if (editing) updateBookmark(sessionId, editing, { note: clipNote(draft.trim()) })
        cancelEdit()
      }

      /* The outcome is reported through the body-level toast: this view
       * unmounts as soon as the chat view activates. */
      const jump = (am) => { void jumpTo(openView, am.turn, sessionId, am.seq, am) }

      const rows = sorted.map((am) => {
        const label = turnLabel(am.turn)
        if (editing === am.id) {
          return h('li', { key: am.id, className: 'dsh-bm-item is-editing' },
            h('div', { className: 'dsh-bm-edit-body' },
              h('div', { className: 'dsh-bm-meta' },
                h('span', { className: 'dsh-bm-turn' }, label),
                h('span', { className: 'dsh-bm-time' }, fmtTime(am.createdAt)),
              ),
              h('textarea', {
                className: 'dsh-bm-input dsh-bm-note-input dsh-bm-edit-input',
                ref: editRef,
                value: draft,
                rows: 1,
                autoFocus: true,
                spellCheck: false,
                placeholder: tt('tail.placeholder'),
                'aria-label': tt('view.edit'),
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit() }
                  if (e.key === 'Escape') cancelEdit()
                },
              }),
              h('div', { className: 'dsh-bm-actions' },
                h('button', {
                  type: 'button',
                  className: 'dsh-bm-btn dsh-bm-btn-primary',
                  title: tt('view.save'),
                  'aria-label': tt('view.save'),
                  onClick: commitEdit,
                }, Icon('check')),
                h('button', {
                  type: 'button',
                  className: 'dsh-bm-btn',
                  title: tt('view.cancel'),
                  'aria-label': tt('view.cancel'),
                  onClick: cancelEdit,
                }, Icon('close')),
              ),
            ),
          )
        }
        return h('li', { key: am.id, className: 'dsh-bm-item' },
          h('button', {
            type: 'button',
            className: 'dsh-bm-line',
            title: tt('view.jump'),
            onClick: () => jump(am),
          },
            h('div', { className: 'dsh-bm-meta' },
              h('span', { className: 'dsh-bm-turn' }, label),
              h('span', { className: 'dsh-bm-time' }, fmtTime(am.createdAt)),
            ),
            h('span', {
              className: 'dsh-bm-note' + (am.note ? '' : ' is-empty'),
              title: am.note || '',
            }, am.note || tt('view.noNote')),
          ),
          h('div', { className: 'dsh-bm-actions' },
            h('button', {
              type: 'button',
              className: 'dsh-bm-btn',
              title: tt('view.edit'),
              'aria-label': tt('view.edit'),
              onClick: () => beginEdit(am),
            }, Icon('pencil')),
            h('button', {
              type: 'button',
              className: 'dsh-bm-btn dsh-bm-del',
              title: tt('view.remove'),
              'aria-label': tt('view.remove'),
              onClick: () => removeBookmark(sessionId, am.id),
            }, Icon('trash')),
          ),
        )
      })

      return h('div', { className: 'dsh-bm-view' },
        h('div', { className: 'dsh-bm-head' },
          h('span', { className: 'dsh-bm-head-icon dsh-bm-emoji', style: { fontSize: '15px' } }, BOOKMARK_EMOJI),
          h('span', { className: 'dsh-bm-view-title' }, tt('view.title')),
          h('span', { className: 'dsh-bm-count' }, String(sorted.length)),
          h('span', { className: 'dsh-bm-head-hint' }, tt('view.hint')),
        ),

        sorted.length === 0
          ? h('div', { className: 'dsh-bm-empty' },
              h('div', { className: 'dsh-bm-empty-icon' }, h('span', { className: 'dsh-bm-emoji', style: { fontSize: '30px' } }, BOOKMARK_EMOJI)),
              h('div', { className: 'dsh-bm-empty-text' }, tt('view.empty')),
            )
          : h('ul', { className: 'dsh-bm-list' }, rows),
      )
    }

    /* ------------------------------------------------------------------ */
    /* per-turn bookmark button (turn tail)                               */
    /* ------------------------------------------------------------------ */

    const POP_WIDTH = 224

    /* The placement proof only needs to be logged once per build, not once per
       Turn row (a long session mounts dozens of triggers). */
    let placementLogged = false

    function AddBookmarkButton(props) {
      /* Two hosts render this component and they hand over different props.
         `conversation.chat.turnTail` (the old placement, below the turn) passes
         {sessionId, turn, seq}; `conversation.chat.assistant-actions` -- the
         copy / branch / share toolbar -- passes only {messageId}. The toolbar is
         the placement we want: it already reserves a fixed 28px row, so the
         trigger is a flex item inside it and cannot grow the transcript. A slot
         box mounted in the flow did (measured 32-96px per mount, past DSH's 24px
         follow tolerance, which is what silently unpinned the view). */
      const propSession = typeof props.sessionId === 'string' ? props.sessionId : null
      const propTurn = props.turn && Number.isSafeInteger(props.turn.turn) ? props.turn.turn : undefined

      const hostRef = useRef(null)
      const [resolved, setResolved] = useState(
        propSession !== null && propTurn !== undefined ? { sessionId: propSession, turn: propTurn } : null,
      )

      /* In the toolbar there is no session id and no turn number in the props, so
         read both off the DOM once the wrapper is in the turn row. */
      useEffect(() => {
        if (propSession !== null && propTurn !== undefined) {
          setResolved({ sessionId: propSession, turn: propTurn })
          return
        }
        const el = hostRef.current
        if (!el) return
        let row = null
        try { row = el.closest(TURN_ROW_SELECTOR) } catch { row = null }
        /* The tail node renders `data-turn-tail="<turn>"` on its own root; it is
           the reliable nearby carrier if this reply has no data-chat-turn row. */
        let turn = row ? Number(row.getAttribute('data-chat-turn')) : NaN
        if (!Number.isSafeInteger(turn)) {
          let tail = null
          try { tail = el.closest('[data-turn-tail]') } catch { tail = null }
          if (tail) turn = Number(tail.getAttribute('data-turn-tail'))
        }
        const owner = sessionIdOf(el) || currentSessionOnScreen()
        if (!owner || !Number.isSafeInteger(turn)) {
          try { traceForce('trigger: unresolved turn=' + turn + ' owner=' + owner + ' msg=' + String(props.messageId)) } catch { /* noop */ }
          return
        }
        setResolved((prev) => (prev && prev.sessionId === owner && prev.turn === turn ? prev : { sessionId: owner, turn }))
      }, [propSession, propTurn, props.messageId])

      const sessionId = resolved ? resolved.sessionId : null
      const turnNo = resolved ? resolved.turn : undefined
      const seq = Number.isSafeInteger(props.seq) ? props.seq : undefined

      useLocaleTick()
      const list = useBookmarks(sessionId)
      const [anchor, setAnchor] = useState(null)
      const [note, setNote] = useState('')
      const btnRef = useRef(null)
      const popRef = useRef(null)
      const noteRef = useRef(null)
      const placeRef = useRef(null)

      /* Stamp the session title for the out-of-React selection tool, which has no
         access to this session-scoped prop bag. */
      useEffect(() => {
        if (!sessionId) return
        rememberSessionTitle(resolveSessionTitle(sessionId))
      }, [sessionId, list.length])

      /* One-shot placement proof: log which toolbar the trigger actually landed
         in, so "moved into the actions row" is verified rather than assumed. */
      useEffect(() => {
        if (turnNo === undefined) return
        if (placementLogged) return
        placementLogged = true
        let chain = 'none'
        try {
          const parts = []
          let el = hostRef.current ? hostRef.current.parentElement : null
          for (let i = 0; el && i < 4; i += 1) {
            const cls = typeof el.className === 'string' ? el.className : ''
            parts.push(cls ? cls.slice(0, 40) : '(host)')
            el = el.parentElement
          }
          chain = parts.join(' < ')
        } catch { chain = 'error' }
        try { traceForce('trigger: placement turn=' + turnNo + ' chain=' + chain) } catch { /* noop */ }
      }, [turnNo])

      /* Only a TURN bookmark counts as "this turn already has one". A text
       * bookmark on the same turn lives in the same array, and matching it here
       * made the tail button overwrite (or delete) the passage bookmark. */
      const existing = turnNo !== undefined ? list.filter((x) => x.turn === turnNo && x.kind !== 'text')[0] : undefined
      /* ...but the button still has to LOOK saved when the turn only carries
       * passage bookmarks, otherwise clicking it looks like nothing happened.
       * The two states are drawn differently: a filled glyph means "this turn
       * has a turn bookmark", a tinted outline means "this turn has saved
       * passages". */
      const turnMarks = turnNo !== undefined ? list.filter((x) => x.turn === turnNo) : []
      const hasPassages = turnMarks.some((x) => x.kind === 'text')
      const markCount = turnMarks.length
      const open = anchor !== null

      /* Auto-grow fallback for engines without `field-sizing:content`: reset the
       * height so the box can shrink again, then fit the content (capped). */
      useEffect(() => {
        const el = noteRef.current
        if (!el) return
        try {
          /* Native field-sizing already sizes this box; measuring on top of it
           * only fights the layout engine (and clipped descenders before). */
          /* See the note on the editor above: `CSS` here is this module's style
           * string, so the global object must be reached explicitly. */
          const engine = globalThis.CSS
          if (!(engine && typeof engine.supports === 'function' && engine.supports('field-sizing', 'content'))) {
            el.style.height = 'auto'
            /* Same cap as the stylesheet's `max-height` so a long note scrolls
               inside the field instead of being clipped by the popover. */
            const max = Math.max(96, Math.min(240, Math.round((window.innerHeight || 800) * 0.4)))
            el.style.height = Math.min(max, Math.max(28, el.scrollHeight)) + 'px'
            el.style.overflowY = el.scrollHeight > max ? 'auto' : 'hidden'
          }
        } catch { /* measurement unavailable */ }
        if (open && placeRef.current) placeRef.current()
      }, [note, open])

      useEffect(() => {
        if (!open) return undefined

        const place = () => {
          const box = btnRef.current ? btnRef.current.getBoundingClientRect() : null
          if (!box) return
          const height = popRef.current ? popRef.current.offsetHeight : 140
          const width = popRef.current ? popRef.current.offsetWidth : POP_WIDTH
          const vw = window.innerWidth || 1200
          const vh = window.innerHeight || 800
          const left = Math.max(8, Math.min(box.left, vw - width - 8))
          let top = box.bottom + 6
          if (top + height > vh - 8) top = Math.max(8, box.top - height - 6)
          setAnchor({ left, top })
        }

        const onDoc = (event) => {
          const insidePop = popRef.current && popRef.current.contains(event.target)
          const onButton = btnRef.current && btnRef.current.contains(event.target)
          if (!insidePop && !onButton) setAnchor(null)
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          setAnchor(null)
          try { if (btnRef.current) btnRef.current.focus() } catch { /* detached */ }
        }

        placeRef.current = place
        place()
        document.addEventListener('mousedown', onDoc, true)
        document.addEventListener('keydown', onKey, true)
        window.addEventListener('scroll', place, true)
        window.addEventListener('resize', place)
        return () => {
          placeRef.current = null
          document.removeEventListener('mousedown', onDoc, true)
          document.removeEventListener('keydown', onKey, true)
          window.removeEventListener('scroll', place, true)
          window.removeEventListener('resize', place)
        }
      }, [open])

      /* Render the wrapper before the turn number is known: the resolve effect
         above needs this element in the DOM to read its row, so bailing out here
         would deadlock the lookup. Only the trigger waits for the turn. */
      const start = () => {
        if (open) { setAnchor(null); return }
        setNote(existing ? (existing.note || '') : '')
        const box = btnRef.current ? btnRef.current.getBoundingClientRect() : null
        const vw = window.innerWidth || 1200
        const vh = window.innerHeight || 800
        const left = Math.max(8, Math.min(box ? box.left : 12, vw - POP_WIDTH - 8))
        let top = box ? box.bottom + 6 : 12
        if (box && top + 150 > vh) top = Math.max(8, box.top - 150 - 6)
        setAnchor({ left, top })
      }

      const save = () => {
        const text = clipNote(note.trim())
        if (existing) {
          updateBookmark(sessionId, existing.id, { note: text })
        } else {
          addBookmark(sessionId, {
            id: newId(),
            sessionId,
            turn: turnNo,
            seq: Number.isSafeInteger(seq) ? seq : undefined,
            note: text,
            createdAt: new Date().toISOString(),
          })
        }
        setAnchor(null)
      }

      const remove = () => {
        if (existing) removeBookmark(sessionId, existing.id)
        setAnchor(null)
      }

      const popup = open
        ? h('div', {
            ref: popRef,
            className: 'dsh-bm-pop',
            role: 'dialog',
            'aria-label': turnLabel(turnNo),
            style: { position: 'fixed', left: anchor.left + 'px', top: anchor.top + 'px', width: POP_WIDTH + 'px' },
          },
            h('div', { className: 'dsh-bm-pop-head' },
              h('span', { className: 'dsh-bm-pop-badge' }, h('span', { className: 'dsh-bm-emoji', style: { fontSize: '12px' } }, BOOKMARK_EMOJI)),
              h('span', { className: 'dsh-bm-pop-label' }, turnLabel(turnNo)),
              h('button', {
                type: 'button',
                className: 'dsh-bm-pop-close',
                title: tt('tail.cancel'),
                'aria-label': tt('tail.cancel'),
                onClick: () => setAnchor(null),
              }, Icon('close', 14)),
            ),
            h('textarea', {
              className: 'dsh-bm-input dsh-bm-note-input',
              ref: noteRef,
              value: note,
              rows: 1,
              autoFocus: true,
              spellCheck: false,
              placeholder: tt('tail.placeholder'),
              'aria-label': tt('tail.placeholder'),
              onChange: (e) => setNote(e.target.value),
              onKeyDown: (e) => {
                e.stopPropagation()
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save()
                if (e.key === 'Escape') { setAnchor(null); try { if (btnRef.current) btnRef.current.focus() } catch { /* detached */ } }
              },
            }),
            h('div', { className: 'dsh-bm-pop-actions' },
              h('button', { type: 'button', className: 'dsh-bm-btn dsh-bm-btn-primary', onClick: save }, tt('tail.save')),
              h('button', { type: 'button', className: 'dsh-bm-btn', onClick: () => setAnchor(null) }, tt('tail.cancel')),
              existing
                ? h('button', { type: 'button', className: 'dsh-bm-btn dsh-bm-del', onClick: remove }, tt('tail.remove'))
                : null,
            ),
          )
        : null

      let popover = null
      if (popup) {
        if (createPortal) {
          try {
            popover = createPortal(popup, document.body)
          } catch {
            popover = popup
          }
        } else {
          popover = popup
        }
      }

      /* Outermost node carries the host ref used to resolve the turn row. */
      if (turnNo === undefined) return h('div', { ref: hostRef, className: 'dsh-bm-add is-idle' })

      return h('div', { ref: hostRef, className: 'dsh-bm-add' },
        h('button', {
          type: 'button',
          ref: btnRef,
          className: 'dsh-bm-add-btn' + (existing ? ' is-on' : '') + (!existing && hasPassages ? ' has-marks' : ''),
          title: existing ? tt('tail.edit') : tt('tail.add'),
          'aria-label': existing ? tt('tail.edit') : tt('tail.add'),
          'data-marks': markCount > 0 ? String(markCount) : undefined,
          'aria-haspopup': 'dialog',
          'aria-expanded': open ? 'true' : 'false',
          onClick: start,
        }, Icon('bookmark', 15, Boolean(existing))),
        popover,
      )
    }

    /* ------------------------------------------------------------------ */
    /* styles                                                            */
    /* ------------------------------------------------------------------ */

    /* ------------------------------------------------------------------ */
    /* sidebars: left rail entry (main panel) and right pane tab           */
    /* ------------------------------------------------------------------ */

    const PANEL_ID = 'dsh-redmark'
    const RIGHT_KIND = 'dsh-redmark'
    const TAB_SLOT_KEY = '@local/dsh-redmark'

    let appCtx = null

    function openPanel(id) {
      try {
        if (appCtx && appCtx.layout && typeof appCtx.layout.selectPanel === 'function') appCtx.layout.selectPanel(id)
      } catch { /* panel selection is best effort */ }
    }

    /* The Conversation is the layout's *null* panel: the right rail is only
     * rendered while no other main panel is selected (`usePanelInfo(info =>
     * info.activePanelId === null)`), so returning to the chat must clear the
     * panel instead of selecting the reserved `conversation` key. */
    function backToConversation() {
      openPanel(null)
    }

    function activePanelId() {
      try {
        const info = appCtx && appCtx.layout && appCtx.layout.panelInfo
        return info && typeof info.getSnapshot === 'function' ? info.getSnapshot().activePanelId : null
      } catch { return null }
    }

    function sessionIdList() {
      try { return Object.keys(memory) } catch { return [] }
    }

    /* Navigate to another conversation and land on its bookmark. */
    function openSessionAndJump(sessionId, turn, seq, bm) {
      try {
        if (appCtx && appCtx.uiWorkspace && typeof appCtx.uiWorkspace.openSession === 'function') {
          appCtx.uiWorkspace.openSession(sessionId)
        }
      } catch { /* the session may already be open */ }
      void jumpInPlace(turn, sessionId, seq, bm)
    }

    /* Centre a Range (the quoted passage itself) rather than its host row.
     * Same one-viewport-at-a-time walk as `centerOn`: a single long write is
     * read as reader movement by DSH and gets restored, which lands nowhere. */
    function centerQuoteRange(scroller, range, maxShift) {
      if (!scroller || !range) return 'lost'
      let rect = null
      let box = null
      try {
        rect = range.getBoundingClientRect()
        box = scroller.getBoundingClientRect()
      } catch { return 'lost' }
      if (!rect || !box) return 'lost'
      if (!rect.height && !rect.width) return 'lost'
      const delta = rect.top - box.top - box.height / 2 + Math.min(rect.height, box.height * 0.4) / 2
      if (!(Math.abs(delta) > 2)) return 'ok'
      let shift = delta
      if (typeof maxShift === 'number' && Math.abs(delta) > maxShift) {
        shift = Math.sign(delta) * maxShift
      }
      const floor = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
      const target = Math.max(0, Math.min(floor, scroller.scrollTop + shift))
      try {
        if (typeof scroller.scrollTo === 'function') scroller.scrollTo({ top: target, behavior: 'instant' })
        else scroller.scrollTop = target
      } catch {
        try { scroller.scrollTop = target } catch {}
      }
      return true
    }

    /* A saved `nodeKey` names one rendered node, and a reply that re-renders
     * while streaming mints new keys: the old key can still resolve to a node of
     * the same turn whose text no longer contains the quote (observed:
     * `quote text not found in node ... key=14:assistant-step17:93`). So when the
     * saved key misses, every node of that turn is searched for the quote. */
    function findQuoteInTurn(bm, sessionId) {
      let rows = null
      try { rows = qa(TURN_ROW_SELECTOR, sessionId) } catch { return null }
      if (rows === null) return null
      const wanted = String(bm.turn)
      for (const row of Array.from(rows)) {
        if (row.getAttribute('data-chat-turn') !== wanted) continue
        for (const el of Array.from(row.querySelectorAll('[data-chat-node-key]'))) {
          const range = quoteRange(el, bm)
          if (range !== null) return { el, range }
        }
        /* The quote may sit in the row itself rather than in a keyed child. */
        const range = quoteRange(row, bm)
        if (range !== null) return { el: row, range }
      }
      return null
    }

    /* A text bookmark stores both a Turn and the DOM key of the quoted node.
     * Landing on the Turn is not landing on the quote: a long Turn scrolls its
     * host row to the top and the quoted paragraph can sit several screens
     * below, which reads as "bookmark lost". So the row is settled first and
     * the quoted PASSAGE is then centred (not the row), retrying while the
     * virtualizer mounts it. `null` means the quote could not be resolved. */
    async function revealQuotedNode(bm, sessionId) {
      if (!bm || bm.kind !== 'text' || !bm.nodeKey) return null
      const deadline = Date.now() + 2500
      for (let i = 0; i < 90 && Date.now() < deadline; i += 1) {
        const el = nodeElByKey(sessionId, bm.nodeKey)
        if (el) {
          const scroller = findScroller(sessionId)
          if (scroller === null) { await frame(); continue }
          const viewport = scroller.clientHeight || 600
          let range = quoteRange(el, bm)
          let anchor = el
          if (range === null) {
            /* Key drift: look for the text anywhere in the same turn. */
            const found = findQuoteInTurn(bm, sessionId)
            if (found === null) {
              traceForce('jump: quote text not found in turn=' + String(bm.turn) + ' key=' + bm.nodeKey)
              return el
            }
            range = found.range
            anchor = found.el
            traceForce('jump: quote recovered by text turn=' + String(bm.turn))
          }
          /* The quoted node is already painted (nodeElByKey resolved it), so
             the passage rect is valid now. Centre the passage DIRECTLY instead
             of first centring its whole turn row: that intermediate row-centre
             is the visible two-step the reader saw ("jump to the turn, then to
             the content"). `centerQuoteRange` walks one viewport at a time so a
             far passage still scrolls in a short run instead of one big write. */
          let outcome = centerQuoteRange(scroller, range, viewport)
          for (let step = 0; step < 12 && outcome !== 'ok'; step += 1) {
            await frame()
            outcome = centerQuoteRange(scroller, range, viewport)
          }
          traceForce('jump: quote centred ok=' + (outcome === 'ok') + ' turn=' + String(bm.turn) + ' key=' + bm.nodeKey)
          return anchor
        }
        await frame()
      }
      return null
    }

    /* True when the quoted text can be found in the mounted transcript even if
     * its exact node key is gone (a remounted row can be re-keyed). The quote is
     * matched on its first line so a trailing truncation cannot break it. */
    function locateQuoteByText(bm, sessionId) {
      if (!bm || bm.kind !== 'text' || typeof bm.quote !== 'string') return null
      const needle = bm.quote.trim().split('\n')[0].trim().slice(0, 60)
      if (needle === '') return null
      try {
        for (const row of Array.from(qa(TURN_ROW_SELECTOR, sessionId))) {
          const text = row.textContent || ''
          if (text.indexOf(needle) < 0) continue
          /* Prefer the narrowest node that actually holds the passage, so the
             reader lands on the paragraph rather than the top of the Turn. */
          for (const el of Array.from(row.querySelectorAll('[data-chat-node-key]'))) {
            const range = quoteRange(el, bm)
            if (range !== null) return { row, range }
          }
          return { row, range: quoteRange(row, bm) }
        }
      } catch { /* not mounted */ }
      return null
    }

    async function jumpInPlace(turn, sessionId, seq, bm) {
      for (let i = 0; i < 150; i += 1) {
        if (sessionRoot(sessionId) && findScroller(sessionId)) break
        await frame()
      }
      const isText = Boolean(bm && bm.kind === 'text' && bm.nodeKey)
      let res = await jumpToTurn(turn, sessionId, seq, isText ? false : true)
      const pages = res && Number.isFinite(res.pages) ? res.pages : 0
      traceForce('jump: turn=' + turn + ' ok=' + (res && res.ok) + ' pages=' + pages
        + ' reason=' + String((res && res.reason) || '-') + ' kind=' + String((bm && bm.kind) || '-')
        + ' key=' + String((bm && bm.nodeKey) || '-'))
      /* Landing on the Turn is only half of a text bookmark: narrow it down to
         the quote the reader actually saved, and repaint its highlight. The
         quote pass also runs when the Turn landing failed: the saved passage
         usually sits in a row that IS mounted even though the Turn-level
         paging gave up, and reaching the passage is what the reader asked for. */
      let quoteOk = true
      let landedByQuote = false
      if (bm && bm.kind === 'text' && bm.nodeKey) {
        const el = await revealQuotedNode(bm, sessionId)
        if (el === null) {
          const found = locateQuoteByText(bm, sessionId)
          if (found !== null) {
            const scroller = findScroller(sessionId)
            if (scroller !== null) {
              const viewport = scroller.clientHeight || 600
              for (let step = 0; step < 10; step += 1) {
                if (centerOn(scroller, found.row, viewport) === 'ok') break
                await frame()
              }
              if (found.range !== null) {
                let outcome = centerQuoteRange(scroller, found.range, viewport)
                for (let step = 0; step < 12 && outcome !== 'ok'; step += 1) {
                  await frame()
                  outcome = centerQuoteRange(scroller, found.range, viewport)
                }
                traceForce('jump: quote centred by text ok=' + (outcome === 'ok') + ' turn=' + String(bm.turn))
              }
              landedByQuote = true
            }
          } else {
            quoteOk = false
            traceForce('jump: quote node ' + bm.nodeKey + ' not mounted after landing turn=' + turn)
          }
        } else {
          landedByQuote = true
        }
        const paint = paintHighlights(sessionId)
        if (paint && paint.missing) {
          traceForce('jump: highlight repaint painted=' + paint.painted + ' missing=' + paint.missing)
        }
      }
      const ok = Boolean(res && res.ok) || landedByQuote
      if (landedByQuote && !(res && res.ok)) {
        res = { ok: true, pages, viaQuote: true }
        traceForce('jump: landed via quoted node turn=' + turn)
      }
      if (ok) {
        if (quoteOk) showToast('ok', tt(pages > 0 ? 'jump.loaded' : 'jump.located'))
        else showToast('ok', tt(pages > 0 ? 'jump.loaded' : 'jump.located') + ' ' + tt('jump.quotePending'))
      } else {
        const key = res && res.reason === 'exhausted' ? 'jump.failedStart' : 'jump.failed'
        showToast('error', tt(key).replace('{pages}', String(pages)) + ' [' + String((res && res.reason) || 'unknown') + ']')
      }
      return res
    }

    function bookmarkTitle(bm) {
      if (bm.kind === 'text' && bm.quote) return bm.quote
      return turnLabel(bm.turn)
    }

    /* Session titles for the all-sessions page. Resolved once per session and
     * cached; a session the shell cannot describe falls back to its id. */
    const titleCache = new Map()

    function resolveSessionTitle(sessionId) {
      if (titleCache.has(sessionId)) return titleCache.get(sessionId)
      let title = ''
      try {
        const sessions = appCtx && (appCtx.sessions || (appCtx.get && appCtx.get('sessions')))
        const binding = sessions && typeof sessions.binding === 'function' ? sessions.binding(sessionId) : null
        const snap = binding && binding.session && typeof binding.session.getSnapshot === 'function'
          ? binding.session.getSnapshot()
          : null
        if (snap) title = String(snap.title || snap.name || snap.displayTitle || '')
      } catch { /* fall back to the id */ }
      /* Only a real title is cached: caching '' pinned the id fallback forever,
         even after the shell learned the title (a brand-new session has none at
         first render). */
      if (title) titleCache.set(sessionId, title)
      return title
    }

    function useStoreTick() {
      const [tick, setTick] = useState(0)
      useEffect(() => subscribe(() => setTick((n) => n + 1)), [])
      return tick
    }

    /* Left rail glyph: the sidebar owns the button, this is its icon.
     * It has to be the same stroke SVG as the shell's own rail icons -- an emoji
     * has a font-dependent em box and baseline, so it never lines up with them. */
    function PanellistIcon(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 18
      const px = Math.max(14, Math.round(size))
      return h('span', {
        className: 'dsh-bm-rail' + (props && props.active ? ' is-active' : ''),
        'aria-hidden': 'true',
      }, Icon('bookmark', px, false))
    }

    /* Tile icon for the right pane's start guide. */
    function GuideIcon(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 16
      return h('span', {
        className: 'dsh-bm-emoji',
        style: { fontSize: Math.max(12, Math.round(size * 0.92)) + 'px', lineHeight: 1 },
        'aria-hidden': 'true',
      }, BOOKMARK_EMOJI)
    }

    function MarkRow(props) {
      const bm = props.bm
      const onOpen = props.onOpen
      const onDelete = props.onDelete
      const showSession = !!props.showSession
      return h('li', { className: 'dsh-bm-item' },
        h('button', {
          type: 'button',
          className: 'dsh-bm-line',
          title: tt('row.open'),
          onClick: () => onOpen(bm),
        },
          h('div', { className: 'dsh-bm-meta' },
            h('span', { className: 'dsh-bm-turn' },
              bm.kind === 'text' ? tt('page.textKind') : turnLabel(bm.turn)),
            showSession
              ? h('span', { className: 'dsh-bm-session' }, bm.sessionTitle || resolveSessionTitle(bm.sessionId))
              : null,
            h('span', { className: 'dsh-bm-time' }, fmtTime(bm.createdAt)),
          ),
          bm.kind === 'text' && bm.quote
            ? h('div', { className: 'dsh-bm-quote' }, bm.quote)
            : h('span', { className: 'dsh-bm-note' + (bm.note ? '' : ' is-empty') },
                bm.note || tt('view.noNote')),
          bm.kind === 'text' && bm.quote && bm.note
            ? h('span', { className: 'dsh-bm-note' }, bm.note)
            : null,
        ),
        onDelete
          ? h('div', { className: 'dsh-bm-actions' },
              h('button', {
                type: 'button',
                className: 'dsh-bm-btn',
                title: tt('view.remove'),
                'aria-label': tt('view.remove'),
                onClick: () => onDelete(bm),
              }, Icon('trash')))
          : null,
      )
    }

    /* The all-sessions page: search, sort, grouped by session. */
    function BookmarksPage() {
      useLocaleTick()
      const tick = useStoreTick()
      const [query, setQuery] = useState('')
      const [sort, setSort] = useState('recent')
      const all = useMemo(() => allBookmarks(), [tick])

      const rows = useMemo(() => {
        const needle = query.trim().toLowerCase()
        let out = all
        if (needle) {
          out = out.filter((bm) => {
            /* `sessionTitle` is empty on old rows and the placeholder promises
               the session name is searchable, so fall back to the resolved one. */
            const hay = [bm.note, bm.quote, bm.sessionTitle || resolveSessionTitle(bm.sessionId), String(bm.turn)]
              .filter(Boolean).join(' ').toLowerCase()
            return hay.indexOf(needle) >= 0
          })
        }
        if (sort === 'turn') return out.slice().sort((a, b) => a.turn - b.turn)
        if (sort === 'session') {
          return out.slice().sort((a, b) => {
            const ka = String(a.sessionTitle || a.sessionId)
            const kb = String(b.sessionTitle || b.sessionId)
            return ka.localeCompare(kb) || a.turn - b.turn
          })
        }
        return out
      }, [all, query, sort])

      const groups = useMemo(() => {
        const map = new Map()
        for (const bm of rows) {
          let g = map.get(bm.sessionId)
          if (!g) { g = { sessionId: bm.sessionId, title: '', items: [] }; map.set(bm.sessionId, g) }
          if (!g.title && bm.sessionTitle) g.title = bm.sessionTitle
          g.items.push(bm)
        }
        return Array.from(map.values())
      }, [rows])

      const open = (bm) => openSessionAndJump(bm.sessionId, bm.turn, bm.seq, bm)
      const drop = (bm) => { removeBookmark(bm.sessionId, bm.id); paintHighlights(bm.sessionId) }

      return h('section', { className: 'dsh-bm-page' },
        h('div', { className: 'dsh-bm-page-wrap' },
          h('header', { className: 'dsh-bm-page-header' },
            h('div', { className: 'dsh-bm-page-title-row' },
              h('h1', null, tt('page.title')),
            ),
            h('button', {
              type: 'button',
              className: 'dsh-bm-text-btn',
              onClick: backToConversation,
            }, tt('page.back')),
          ),
          h('div', { className: 'dsh-bm-toolbar' },
          h('input', {
            className: 'dsh-bm-search',
            type: 'search',
            value: query,
            placeholder: tt('page.search'),
            'aria-label': tt('page.search'),
            onChange: (e) => setQuery(e.target.value),
          }),
          h('select', {
            className: 'dsh-bm-select',
            value: sort,
            'aria-label': tt('page.sortRecent'),
            onChange: (e) => setSort(e.target.value),
          },
            h('option', { value: 'recent' }, tt('page.sortRecent')),
            h('option', { value: 'turn' }, tt('page.sortTurn')),
              h('option', { value: 'session' }, tt('page.sortSession')),
            ),
          ),
        ),
        h('div', { className: 'dsh-bm-page-body' },
          rows.length === 0
            ? h('div', { className: 'dsh-bm-empty' },
                h('p', null, all.length === 0 ? tt('page.empty') : tt('page.emptySearch')),
              )
            : h('div', { className: 'dsh-bm-page-list' },
                groups.map((g) => h('div', { key: g.sessionId, className: 'dsh-bm-group' },
                h('div', { className: 'dsh-bm-group-head' },
                  h('span', { className: 'dsh-bm-group-title' }, g.title || resolveSessionTitle(g.sessionId) || String(g.sessionId).slice(0, 12)),
                  h('span', { className: 'dsh-bm-count' }, tt('page.count').replace('{n}', String(g.items.length))),
                ),
                h('ul', { className: 'dsh-bm-list' },
                    g.items.map((bm) => h(MarkRow, {
                      key: bm.sessionId + ':' + bm.id,
                      bm,
                      onOpen: open,
                      onDelete: drop,
                    }))),
                )),
              ),
        ),
      )
    }

    /* Right rail body: this session's bookmarks. */
    function RightbarBody(props) {
      useLocaleTick()
      const sessionId = props.sessionId
      const tick = useStoreTick()
      const list = useMemo(() => readStore(sessionId), [sessionId, tick])
      const rows = list.slice().sort((a, b) => a.turn - b.turn)

      useEffect(() => { if (sessionId) paintHighlights(sessionId) }, [sessionId, tick])

      return h('div', { className: 'dsh-bm-rail-body' },
        h('div', { className: 'dsh-bm-rail-head' },
          h('div', { className: 'dsh-bm-rail-title-row' },
            h('span', { className: 'dsh-bm-rail-title' },
              h('span', { className: 'dsh-bm-emoji', style: { fontSize: '13px' } }, BOOKMARK_EMOJI),
              h('span', null, tt('rightbar.title')),
              h('span', { className: 'dsh-bm-count' }, String(rows.length)),
            ),
            h('button', {
              type: 'button',
              className: 'dsh-bm-text-btn',
              onClick: () => openPanel(PANEL_ID),
            }, tt('rightbar.all') + ' \u203A'),
          ),
        ),
        rows.length === 0
          ? h('div', { className: 'dsh-bm-rail-empty' }, h('p', null, tt('rightbar.empty')))
          : h('ul', { className: 'dsh-bm-rail-list' },
              rows.map((bm) => h(MarkRow, {
                key: bm.id,
                bm,
                onOpen: (x) => { void jumpInPlace(x.turn, sessionId, x.seq, x) },
                onDelete: (x) => { removeBookmark(sessionId, x.id); paintHighlights(sessionId) },
              }))),
      )
    }

    /* Open our right-rail tab.
     *
     * Two facts from `dsh-client-ui-sidebar-right/lib/client.js` drive this:
     *  - `RightbarRoot` renders only when `usePanelInfo(info => info.activePanelId
     *    === null)`, i.e. the rail exists only on the Conversation (the layout's
     *    null panel) — while another main panel is selected the rail is gone.
     *  - `openTab()` resolves its session from `mounted` (the rail seat) and
     *    throws `sidebarRight: no session surface is mounted` until that seat is
     *    on screen.
     * So: clear the main panel back to the Conversation, reveal the rail, then
     * retry until the seat reports a session. */
    function openRightbarTab() {
      const right = appCtx && (appCtx.sidebarRight || (appCtx.get && appCtx.get('sidebarRight')))
      const layout = appCtx && appCtx.layout
      if (!right || typeof right.openTab !== 'function') {
        traceForce('openTab: service missing')
        showToast('error', tt('rightbar.unavailable'))
        return
      }

      try {
        if (activePanelId() !== null && layout && typeof layout.selectPanel === 'function') layout.selectPanel(null)
      } catch { /* older layout service */ }

      const mountedId = () => {
        try {
          const store = right.mounted
          return store && typeof store.getSnapshot === 'function' ? store.getSnapshot() : undefined
        } catch { return undefined }
      }

      let left = 20
      let retryTimer = 0
      const attempt = () => {
        retryTimer = 0
        try {
          if (layout && typeof layout.openRightbar === 'function') layout.openRightbar(true, false)
          right.openTab(RIGHT_KIND)
          traceForce('openTab ok mounted=' + String(mountedId()) + ' panel=' + String(activePanelId()))
          return
        } catch (err) {
          if (left > 0) {
            left -= 1
            /* Held so a disposed plugin cannot keep retrying against a torn-down
               shell (each retry also re-opened the rail). */
            retryTimer = setTimeout(attempt, 100)
            return
          }
          traceForce('openTab fail mounted=' + String(mountedId()) + ' err=' + (err && err.message))
          /* This branch IS the failure path: reporting it as 'ok' showed the
             neutral hint styled like success. */
          showToast('error', tt('rightbar.hint'))
        }
      }
      retryTimer = setTimeout(attempt, 30)
    }

    /* Header entry beside the Session utilities: opens the right rail tab. */
    function HeaderBookmarkButton() {
      useLocaleTick()
      return h('button', {
        type: 'button',
        className: 'dsh-bm-headbtn',
        title: tt('rightbar.title'),
        'aria-label': tt('rightbar.title'),
        onClick: openRightbarTab,
      }, h('span', { className: 'dsh-bm-emoji', style: { fontSize: '14px' } }, BOOKMARK_EMOJI))
    }

    const CSS = `
/* theme anchors: --dsw-alias-brand-primary is the CONTRAST ink colour in this
   theme system (near-white in dark mode), so accents get their own pair. */
body{--bm-accent:#2f6bdd;--bm-accent-btn:#3563cc}
body[data-ds-dark-theme]{--bm-accent:#7aa6ff;--bm-accent-btn:#3f6fe0}

/* surface bridge: in the light theme DSH paints bg-base, bg-layer-1 and
   bg-layer-2 with the same white, so a card separated only by
   --dsw-alias-border-l1 (4% ink) reads as blank paper. Separation therefore
   comes from a sunken canvas behind containers, a border-l2 hairline on cards
   and the house --dsw-shadow-lv1 lift. The dark theme keeps its flat hairline
   look, where the layered greys already do the work. */
body{
  --bm-surface-card:var(--dsw-alias-bg-layer-1,#fff);
  --bm-surface-sunken:var(--dsw-alias-bg-module-platform,#f5f6f7);
  --bm-surface-field:var(--dsw-alias-bg-module-platform,#f5f6f7);
  --bm-hairline:var(--dsw-alias-border-l2,rgba(0,0,0,.10));
  --bm-hairline-soft:var(--dsw-alias-border-l1,rgba(0,0,0,.04));
  --bm-card-shadow:var(--dsw-shadow-lv1,0 2px 4px rgba(0,0,0,.05));
  --bm-card-shadow-hover:0 4px 14px rgba(15,23,42,.10);
  --bm-float-shadow:var(--dsw-elevation-panel,0 3px 8px rgba(0,0,0,.04),0 0 16px rgba(0,0,0,.02));
  --bm-chip-bg:color-mix(in srgb,var(--bm-accent) 10%,transparent);
  /* hover fills cannot come from bg-layer-2 here: it is white in this theme. */
  --bm-hover-bg:color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 7%,transparent);
  --bm-item-hover-bg:color-mix(in srgb,var(--dsw-alias-label-primary,#0f1115) 3%,var(--bm-surface-card,#fff));
}
body[data-ds-dark-theme]{
  --bm-surface-card:var(--dsw-alias-bg-layer-1,#232324);
  --bm-surface-sunken:var(--dsw-alias-bg-layer-1,#232324);
  --bm-surface-field:var(--dsw-alias-bg-layer-1,#17181c);
  --bm-hairline:var(--dsw-alias-border-l1,rgba(255,255,255,.06));
  --bm-hairline-soft:var(--dsw-alias-border-l1,rgba(255,255,255,.06));
  --bm-card-shadow:none;
  --bm-card-shadow-hover:0 2px 10px rgba(0,0,0,.10);
  --bm-float-shadow:0 8px 24px rgba(0,0,0,.28);
  --bm-chip-bg:var(--dsw-alias-bg-layer-2,rgba(122,166,255,.14));
  --bm-hover-bg:var(--dsw-alias-bg-layer-2,rgba(255,255,255,.08));
  --bm-item-hover-bg:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.09));
}

.dsh-bm-icon{display:block;flex:0 0 auto;pointer-events:none}
.dsh-bm-emoji{display:inline-block;line-height:1;font-size:1em;font-family:"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif}

/* ---------- bookmarks view ---------- */
.dsh-bm-view{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden;color:var(--dsw-alias-label-primary,inherit);font-size:13px;line-height:1.5}
.dsh-bm-head{display:flex;align-items:center;gap:8px;padding:11px 14px;flex:0 0 auto;border-bottom:1px solid var(--bm-hairline-soft,rgba(127,127,127,.18));background:var(--bm-surface-card,rgba(0,0,0,0))}
.dsh-bm-head-icon{display:flex;color:var(--bm-accent)}
.dsh-bm-view-title{font-size:13px;font-weight:600;letter-spacing:.01em}
.dsh-bm-count{font-size:11px;font-weight:600;line-height:17px;min-width:17px;padding:0 5px;border-radius:9px;text-align:center;color:var(--bm-accent);background:var(--bm-chip-bg,rgba(74,125,255,.12));border:1px solid var(--bm-hairline-soft,rgba(127,127,127,.18))}
.dsh-bm-head-hint{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-secondary,#888);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:52%}

.dsh-bm-list{list-style:none;margin:0;padding:10px 12px 16px;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}

/* one bookmark = one card */
.dsh-bm-item{display:flex;align-items:stretch;gap:6px;padding:10px 12px;border-radius:8px;border:1px solid var(--bm-hairline,rgba(128,128,128,.16));background:var(--bm-surface-card,rgba(128,128,128,.04));box-shadow:var(--bm-card-shadow,none);transition:border-color .14s ease,background .14s ease,box-shadow .14s ease}
.dsh-bm-item:hover{border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.34));background:var(--bm-item-hover-bg,rgba(127,127,127,.09));box-shadow:var(--bm-card-shadow-hover,0 2px 10px rgba(0,0,0,.10))}
.dsh-bm-item.is-editing{border-color:var(--bm-accent);box-shadow:0 0 0 3px rgba(74,125,255,.14)}

.dsh-bm-line{flex:1;min-width:0;display:flex;flex-direction:column;justify-content:center;gap:6px;min-height:0;padding:0;border:0;border-radius:8px;background:transparent;font:inherit;color:inherit;text-align:left;cursor:pointer;outline:none}
.dsh-bm-line:focus-visible{box-shadow:inset 0 0 0 2px var(--bm-accent)}

.dsh-bm-meta{display:flex;align-items:center;gap:8px;min-width:0}
.dsh-bm-turn{font-size:11px;font-weight:600;line-height:16px;padding:1px 7px;border-radius:999px;color:var(--bm-accent);background:var(--bm-chip-bg,rgba(74,125,255,.12));border:1px solid var(--bm-hairline-soft,rgba(127,127,127,.18));white-space:nowrap;flex:0 0 auto}
.dsh-bm-time{font-size:11px;color:var(--dsw-alias-label-tertiary,#86868b);font-variant-numeric:tabular-nums;white-space:nowrap;flex:0 0 auto}
.dsh-bm-note{display:block;font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary,inherit);white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word}
.dsh-bm-quote{font-size:12.5px;line-height:1.55;color:var(--dsw-alias-label-primary,inherit);padding-left:8px;border-left:2px solid rgba(255,204,0,.7);word-break:break-word;white-space:pre-wrap;max-height:132px;overflow-y:auto;cursor:pointer}
.dsh-bm-note.is-empty{color:var(--dsw-alias-label-secondary,#888);font-style:italic;opacity:.8}

.dsh-bm-actions{display:flex;align-items:center;gap:2px;padding:0 8px 0 0;flex:0 0 auto}
/* A note may wrap over several lines: keep the row controls at the top-right
   instead of letting the stretched row centre them. */
.dsh-bm-item > .dsh-bm-actions{align-self:flex-start}
.dsh-bm-item .dsh-bm-btn{opacity:.45}
.dsh-bm-item:hover .dsh-bm-btn,.dsh-bm-item:focus-within .dsh-bm-btn,.dsh-bm-item.is-editing .dsh-bm-btn{opacity:1}
@media (hover:none){.dsh-bm-item .dsh-bm-btn{opacity:.8}}

.dsh-bm-btn{display:inline-flex;align-items:center;justify-content:center;gap:4px;min-width:26px;height:26px;padding:0 7px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;font:inherit;font-size:12px;line-height:1;transition:background .12s ease,color .12s ease,border-color .12s ease}
.dsh-bm-btn:hover{background:var(--bm-hover-bg,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,inherit)}
.dsh-bm-btn:focus-visible{outline:none;box-shadow:0 0 0 2px var(--bm-accent)}
.dsh-bm-btn-primary{background:var(--bm-accent-btn);border-color:var(--bm-accent-btn);color:#fff;font-weight:500}
.dsh-bm-btn-primary:hover{background:var(--bm-accent-btn);color:#fff;filter:brightness(1.07)}
.dsh-bm-del{color:var(--dsw-alias-label-secondary,#888)}
.dsh-bm-del:hover{color:var(--dsw-alias-state-error-primary,#e5534b);background:rgba(229,83,75,.12)}

.dsh-bm-input{flex:1;min-width:0;height:26px;padding:0 7px;border-radius:var(--dsw-radius-sm,8px);border:1px solid var(--bm-hairline,rgba(127,127,127,.34));background:var(--bm-surface-field,#17181c);color:var(--dsw-alias-label-primary,inherit);font:inherit;font-size:11.5px;outline:none}
.dsh-bm-input::placeholder{color:var(--dsw-alias-label-secondary,#888);opacity:.8}
.dsh-bm-input:focus{border-color:var(--bm-accent);box-shadow:0 0 0 3px rgba(74,125,255,.18)}

/* Popover note field. Solid (never glass), auto-wrapping, auto-growing with
 * its content, and never manually resizable. Height budget is explicit so the
 * text can never clip: 4px padding + 20px line + 4px padding + 2px border
 * = 30px floor, and 4px steps above that. field-sizing does the growth where
 * the engine supports it; the effect in the component covers the rest. */
.dsh-bm-note-input{display:block;flex:0 0 auto;align-self:stretch;width:100%;box-sizing:border-box;height:auto;min-height:28px;max-height:min(40vh,240px);padding:4px 7px;border-radius:var(--dsw-radius-sm,8px);line-height:18px;font-size:11.5px;overflow-y:auto;resize:none;field-sizing:content;white-space:pre-wrap;overflow-wrap:anywhere}
/* Same auto-wrap behaviour for the row editor inside the bookmarks list. */
.dsh-bm-edit-input{font-size:12px;line-height:1.45;min-height:30px;max-height:180px;border:none;background:transparent;color:var(--dsw-alias-label-secondary,#86868b);padding:2px 0}
.dsh-bm-edit-input:focus{color:var(--dsw-alias-label-primary,inherit)}
.dsh-bm-edit-input::placeholder{color:var(--dsw-alias-label-tertiary,rgba(134,134,139,.6))}

.dsh-bm-edit-body{flex:1;min-width:0;display:flex;flex-direction:column;gap:7px;padding:10px 12px}
.dsh-bm-edit-body .dsh-bm-actions{padding:0;justify-content:flex-end}





/* ---------- per-turn trigger + popover ---------- */
/* The trigger now sits in the assistant-actions toolbar (the copy / branch /
   share row), which DSH renders with a fixed 28px height next to the reply.
   Because it is a flex item inside a row that already exists, mounting it cannot
   grow the transcript. The earlier placement -- a slot box in the turn flow --
   did grow it (measured 32px at height:0, 80px inline) the instant a plugin
   revision loaded, which pushed DSH past its 24px follow tolerance: the
   data-chat-following-tail attribute was dropped with no reader gesture and the
   repair/re-drop cycle is what the reader saw as the up-jump and fall-back loop.
   Styled as one of the neighbouring 28px icon buttons so it lines up with them. */
.dsh-bm-add{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;line-height:0;font-size:0;flex:0 0 auto}
.dsh-bm-add.is-idle{display:none}
.dsh-bm-add-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:6px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:var(--dsw-alias-label-tertiary,#888);cursor:pointer;opacity:1;transition:background .14s ease,color .14s ease}
.dsh-bm-add-btn:hover{opacity:1;background:var(--bm-hover-bg,rgba(127,127,127,.14));color:var(--dsw-alias-label-primary,inherit)}
.dsh-bm-add-btn:focus-visible{outline:none;opacity:1;box-shadow:0 0 0 2px var(--bm-accent)}
.dsh-bm-add-btn.is-on{opacity:1;color:var(--bm-accent);background:transparent}
.dsh-bm-add-btn.is-on:hover{color:var(--bm-accent);background:var(--bm-hover-bg,rgba(127,127,127,.14))}
.dsh-bm-add-btn.has-marks{opacity:1;color:var(--bm-accent);background:transparent}
.dsh-bm-add-btn.has-marks:hover{color:var(--bm-accent);background:var(--bm-hover-bg,rgba(127,127,127,.14))}

.dsh-bm-pop{z-index:9999;box-sizing:border-box;display:flex;flex-direction:column;gap:5px;padding:7px;border-radius:var(--dsw-radius-md,12px);background-color:color-mix(in srgb,var(--dsw-alias-bg-overlay,#e9ecf2) 88%,transparent);background-image:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,.16));backdrop-filter:blur(10px) saturate(140%);-webkit-backdrop-filter:blur(10px) saturate(140%);border:1px solid var(--bm-hairline,rgba(127,127,127,.34));box-shadow:var(--dsw-elevation-prominent,0 18px 44px rgba(0,0,0,.30));animation:dsh-bm-pop-in .14s ease}
body[data-ds-dark-theme] .dsh-bm-pop{background-color:rgba(46,49,58,.5);background-color:color-mix(in srgb,var(--dsw-alias-bg-overlay,#2b2b30) 50%,transparent);background-image:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.01));backdrop-filter:blur(4px) saturate(115%);-webkit-backdrop-filter:blur(4px) saturate(115%);border-color:var(--dsw-alias-border-l2,rgba(127,127,127,.34))}
@keyframes dsh-bm-pop-in{from{opacity:0;transform:translateY(-4px) scale(.985)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion: reduce){.dsh-bm-pop{animation:none}}
.dsh-bm-pop-head{display:flex;align-items:center;gap:5px;min-width:0;padding:0 0 0 2px;min-height:18px}
.dsh-bm-pop-badge{display:flex;align-items:center;justify-content:center;flex:0 0 auto;line-height:1}
.dsh-bm-pop-label{font-size:11px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-primary,inherit);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-bm-pop-close{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;margin-left:auto;border:0;border-radius:var(--dsw-radius-xs,4px);background:transparent;color:var(--dsw-alias-label-secondary,#888);cursor:pointer;flex:0 0 auto}
.dsh-bm-pop-close:hover{background:var(--bm-hover-bg,rgba(127,127,127,.16));color:var(--dsw-alias-label-primary,inherit)}
.dsh-bm-pop-actions{display:flex;align-items:center;gap:6px}
.dsh-bm-pop-actions .dsh-bm-btn{height:22px;padding:0 8px;font-size:10px;line-height:1;font-weight:500;border-radius:var(--dsw-radius-sm,8px)}
.dsh-bm-pop-actions .dsh-bm-btn-primary{border-color:var(--bm-accent-btn)}
.dsh-bm-pop-actions .dsh-bm-del{margin-left:auto;border-color:transparent;font-weight:400}

/* ---------- toast ---------- */
.dsh-bm-toast{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:2147483000;max-width:min(520px,calc(100vw - 32px));padding:9px 15px;border-radius:10px;font-size:12.5px;line-height:1.5;text-align:center;pointer-events:none;box-shadow:var(--dsw-elevation-prominent,0 10px 30px rgba(0,0,0,.28));border:1px solid var(--bm-hairline,rgba(127,127,127,.3));background:var(--bm-surface-card,#fff);color:var(--dsw-alias-label-primary,inherit);animation:dsh-bm-toast-in .16s ease}
.dsh-bm-toast[data-kind="error"]{border-color:var(--dsw-alias-state-error-primary,#e5534b);color:var(--dsw-alias-state-error-primary,#e5534b)}
.dsh-bm-toast[data-kind="loading"]{color:var(--dsw-alias-label-secondary,#888)}
@keyframes dsh-bm-toast-in{from{opacity:0;transform:translate(-50%,6px)}to{opacity:1;transform:translate(-50%,0)}}
@media (prefers-reduced-motion: reduce){.dsh-bm-toast{animation:none}}

.dsh-bm-flash{animation:dsh-bm-flash 1.7s ease}
@keyframes dsh-bm-flash{0%,100%{box-shadow:inset 0 0 0 0 rgba(74,125,255,0)}25%,60%{box-shadow:inset 0 0 0 2px rgba(74,125,255,.75)}}
@media (prefers-reduced-motion: reduce){.dsh-bm-flash{animation:none}}

/* ---- left rail entry + all-sessions page ---- */
.dsh-bm-headbtn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:0;border-radius:var(--dsw-radius-sm,8px);background:transparent;color:inherit;cursor:pointer;line-height:1}
.dsh-bm-headbtn:hover{background:var(--bm-hover-bg,rgba(127,127,127,.14))}
.dsh-bm-rail{display:inline-flex;align-items:center;justify-content:center;line-height:0}

.dsh-bm-page{height:100%;display:flex;flex-direction:column;min-height:0;width:100%;background:var(--dsw-alias-bg-base,#1b1b1c);color:var(--dsw-alias-label-primary,#f5f6f7);overflow:hidden;font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;padding-top:var(--dsh-frame-top-clearance,0px)}
.dsh-bm-page-wrap{width:100%;max-width:780px;margin:0 auto;padding:24px 28px 0;padding-left:calc(28px + var(--dsh-frame-leading-clearance,0px));display:flex;flex-direction:column;gap:14px}
.dsh-bm-page-header{display:flex;align-items:baseline;justify-content:space-between;gap:16px}
.dsh-bm-page-title-row{display:flex;align-items:baseline;gap:10px;min-width:0}
.dsh-bm-page-title-row h1{margin:0;font-size:20px;font-weight:600;letter-spacing:-0.02em}
.dsh-bm-page-icon{display:inline-flex;align-items:center;justify-content:center;font-size:18px;line-height:1}
.dsh-bm-page-meta{font-size:12.5px;color:var(--dsw-alias-label-secondary,#86868b)}
.dsh-bm-count{font-size:11.5px;font-weight:400;color:var(--dsw-alias-label-secondary,#86868b);font-variant-numeric:tabular-nums}
.dsh-bm-text-btn{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#86868b);font-size:12px;padding:3px 6px;border-radius:5px;cursor:pointer;transition:color .12s ease,background-color .12s ease;white-space:nowrap}
.dsh-bm-text-btn:hover{color:var(--dsw-alias-label-primary,#f5f6f7);background:var(--bm-hover-bg,rgba(128,128,128,.12))}
.dsh-bm-toolbar{display:flex;align-items:center;gap:8px;padding-bottom:12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.14))}
.dsh-bm-search{flex:1;width:100%;min-width:0;height:28px;padding:0 9px;border-radius:6px;border:1px solid var(--bm-hairline,rgba(128,128,128,.18));background:var(--bm-surface-field,rgba(128,128,128,.06));color:var(--dsw-alias-label-primary,#f5f6f7);font-size:12px;outline:none;transition:border-color .12s ease}
.dsh-bm-search::placeholder{color:color-mix(in srgb,var(--dsw-alias-label-secondary,#86868b) 78%,transparent)}
.dsh-bm-search:focus{border-color:var(--dsw-alias-label-secondary,#86868b)}
.dsh-bm-select{height:28px;padding:0 8px;border-radius:6px;border:1px solid var(--bm-hairline,rgba(128,128,128,.18));background:var(--bm-surface-field,rgba(128,128,128,.06));color:var(--dsw-alias-label-secondary,#86868b);font-size:12px;cursor:pointer;outline:none}
.dsh-bm-page-body{flex:1;min-height:0;overflow-y:auto;padding:14px 28px 48px;padding-left:calc(28px + var(--dsh-frame-leading-clearance,0px))}
.dsh-bm-page-list{max-width:780px;margin:0 auto;display:flex;flex-direction:column;gap:10px}
.dsh-bm-empty{padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#86868b);font-size:12.5px;line-height:1.6}
.dsh-bm-empty p{margin:0}
.dsh-bm-group{border-radius:10px;border:1px solid var(--bm-hairline-soft,rgba(128,128,128,.15));background:var(--bm-surface-sunken,rgba(128,128,128,.03));overflow:hidden}
.dsh-bm-group-head{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 14px;cursor:pointer}
.dsh-bm-group-title{font-size:13.5px;font-weight:500;color:var(--dsw-alias-label-primary,#f5f6f7);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;flex:1}
.dsh-bm-session{font-size:11px;color:var(--dsw-alias-label-secondary,#86868b);max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-bm-group .dsh-bm-list{list-style:none;margin:0;padding:6px 14px 14px;display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.1))}

/* ---- right rail body ---- */
.dsh-bm-rail-body{display:flex;flex-direction:column;min-height:0;height:100%;padding:0;gap:0;background:var(--dsw-alias-bg-base,transparent);color:var(--dsw-alias-label-primary,#f5f5f7);overflow:hidden;font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif}
.dsh-bm-rail-head{padding:12px 14px 10px;border-bottom:1px solid var(--bm-hairline-soft,rgba(128,128,128,.14));display:flex;flex-direction:column;gap:8px}
.dsh-bm-rail-title-row{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dsh-bm-rail-title{font-size:13px;font-weight:600;letter-spacing:-0.01em;display:inline-flex;align-items:center;gap:6px;min-width:0;color:var(--dsw-alias-label-primary,#f5f6f7)}
.dsh-bm-rail-title .dsh-bm-count{font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary,#86868b)}
.dsh-bm-rail-title > span:last-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-bm-rail-list{flex:1;min-height:0;overflow-y:auto;padding:10px 14px 24px;display:flex;flex-direction:column;gap:8px;list-style:none;margin:0}
.dsh-bm-rail-empty{flex:1;padding:48px 16px;text-align:center;color:var(--dsw-alias-label-secondary,#86868b);font-size:12.5px;line-height:1.6}
.dsh-bm-rail-empty p{margin:0}
/* ---- selection capture button ---- */
/* Same face as the shipped quote action: floating fill, panel elevation,
   xs-13 type, 999px radius, 5px/10px padding. */
.dsh-bm-selmenu{position:fixed;z-index:2147483001;display:none;align-items:center;padding:0;border:0;background:transparent;box-shadow:none}
.dsh-bm-selmenu[data-mode="quote"] .dsh-bm-selbtn[data-mode="save"]{display:none}
.dsh-bm-selmenu[data-mode="save"] .dsh-bm-selbtn[data-mode="quote"]{display:none}
.dsh-bm-selbtn{position:static;display:inline-flex;align-items:center;gap:5px;padding:5px 10px;border:0;border-radius:999px;background:var(--dsw-alias-button-floating-fill,rgba(40,40,46,.92));--dsw-elevation-stroke-color:var(--dsw-alias-border-l3,rgba(127,127,127,.3));box-shadow:var(--dsw-elevation-panel,0 8px 24px rgba(0,0,0,.3));color:var(--dsw-alias-label-primary,inherit);font:var(--dsw-font-xs-13,500 13px/1.4 inherit);cursor:pointer;white-space:nowrap;line-height:1.4}
.dsh-bm-selbtn:hover{background:var(--dsw-alias-button-floating-hover,var(--bm-hover-bg,rgba(127,127,127,.16)))}

/* ---- stored text ranges ---- */
::highlight(dsh-bm-mark){background-color:rgba(229,83,75,.26);text-decoration:underline;text-decoration-color:rgba(229,83,75,.7);text-decoration-thickness:1px;text-underline-offset:2px}
::highlight(dsh-bm-find){background-color:rgba(56,189,248,.25);color:inherit}
::highlight(dsh-bm-find-active){background-color:rgba(255,159,10,.62);color:inherit;text-decoration:underline #ff9f0a 2px;text-underline-offset:3px}
/* in-conversation find bar (values copied from the reference implementation) */
.dsh-bm-findbar{position:fixed;top:calc(var(--dsh-frame-top-clearance,48px) + 12px);left:50%;right:auto;transform:translateX(-50%);z-index:9998;display:flex;align-items:center;gap:4px;height:26px;padding:0 5px 0 8px;border-radius:7px;background:var(--bm-surface-card,rgba(36,36,38,.92));backdrop-filter:blur(20px) saturate(180%);-webkit-backdrop-filter:blur(20px) saturate(180%);border:1px solid var(--bm-hairline,rgba(128,128,128,.24));box-shadow:var(--bm-float-shadow,0 8px 24px rgba(0,0,0,.18),0 1px 2px rgba(0,0,0,.08));pointer-events:auto;color:var(--dsw-alias-label-primary,#f5f5f7);font-family:-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif;transition:right .16s cubic-bezier(.22,.68,.28,1),top .16s ease}
.dsh-bm-findinput{width:176px;border:none;background:transparent;color:var(--dsw-alias-label-primary,#f5f5f7);font-size:12.5px;outline:none;line-height:1.2}
.dsh-bm-findinput::placeholder{color:var(--dsw-alias-label-tertiary,#86868b)}
.dsh-bm-findcount{font-size:11px;color:var(--dsw-alias-label-secondary,#86868b);font-variant-numeric:tabular-nums;padding:0 3px;min-width:32px;text-align:right;user-select:none}
.dsh-bm-findhint{max-width:186px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;color:var(--dsw-alias-label-tertiary,#86868b);padding:0 2px;user-select:none}
.dsh-bm-findbtn{width:20px;height:20px;border:none;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary,#86868b);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;font:inherit;font-size:12px;line-height:1}
.dsh-bm-findbtn:hover:not(:disabled){background:var(--bm-hover-bg,rgba(128,128,128,.16));color:var(--dsw-alias-label-primary,#f5f5f7)}
.dsh-bm-findbtn:disabled{opacity:.35;cursor:default}
`

    let styleEl = null
    /* One <style> node per live apply(). The node used to be a module singleton
     * with an unconditional release: a second instance (hot reload, a second
     * document hook) reused the first one's node, and whichever disposed first
     * stripped the stylesheet for the survivor without recreating it. */
    let styleRefs = 0

    function ensureStyles() {
      try {
        styleRefs += 1
        if (styleEl && styleEl.isConnected) return
        const stale = document.querySelectorAll('style[data-dsh-dsh-redmark]')
        for (const node of Array.from(stale)) {
          if (node !== styleEl && node.parentNode) node.parentNode.removeChild(node)
        }
        const el = document.createElement('style')
        el.setAttribute('data-dsh-dsh-redmark', '')
        el.textContent = CSS
        document.head.appendChild(el)
        styleEl = el
      } catch {
        /* no document: nothing to style */
      }
    }

    function releaseStyles() {
      try {
        styleRefs = Math.max(0, styleRefs - 1)
        if (styleRefs > 0) return
        if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
      } catch { /* already detached */ }
      styleEl = null
    }

    /* ------------------------------------------------------------------ */
    /* plugin                                                             */
    /* ------------------------------------------------------------------ */

    const inject = ['slots', 'locale', 'layout', 'uiWorkspace', 'sidebarRightTabs', 'sidebarRight']

    function apply(ctx) {
      try { detectLang(ctx.locale.getLocale()) } catch { lang = 'en' }

      try { ctx.effect(() => ctx.locale.register(NS, DICT), 'dsh-redmark: locale') } catch { /* non-fatal */ }
      try {
        ctx.effect(
          () => ctx.locale.subscribe(() => {
            try { detectLang(ctx.locale.getLocale()) } catch { /* keep the current language */ }
            notifyLocale()
          }),
          'dsh-redmark: locale watch',
        )
      } catch { /* non-fatal */ }
      try {
        ctx.effect(() => {
          ensureStyles()
          return releaseStyles
        }, 'dsh-redmark: styles')
      } catch { /* non-fatal */ }

      /* Drop a pending jump and any visible toast when the plugin unloads. */
      try {
        ctx.effect(() => () => {
          jumpSequence += 1
          hideToast()
          for (const row of Array.from(flashTimers)) {
            try { row.classList.remove('dsh-bm-flash') } catch { /* detached */ }
          }
          flashTimers.clear()
        }, 'dsh-redmark: toast')
      } catch { /* non-fatal */ }

      /* Another document (or a second live instance) may have replaced the
       * localStorage value: drop the memoized copy and repaint. */
      try {
        const onStorage = (event) => {
          if (!event || typeof event.key !== 'string') return
          if (event.key.indexOf(STORE_PREFIX) !== 0) return
          memory.delete(event.key.slice(STORE_PREFIX.length))
          notify()
        }
        window.addEventListener('storage', onStorage)
        ctx.effect(() => () => {
          try { window.removeEventListener('storage', onStorage) } catch { /* gone */ }
        }, 'dsh-redmark: storage watch')
      } catch { /* no window */ }

      /* Retry any mirror write that was dropped during a backoff window. */
      try {
        ctx.effect(() => {
          const timer = setInterval(flushMirror, 15000)
          return () => { try { clearInterval(timer) } catch { /* gone */ } }
        }, 'dsh-redmark: mirror retry')
      } catch { /* non-fatal */ }

      /* Keep the transcript following the newest message while a reply
         streams. See startFollowGuard() for the measured evidence. */
      try {
        ctx.effect(() => startFollowGuard(), 'dsh-redmark: follow guard')
      } catch { /* older shell without ctx.effect */ }

      /* One unguarded injection would abort apply() and silently disable every
         registration after it; keep it in the same shape as the others. */
      try {
        ctx.slots.inject('conversation.chat.assistant-actions', () =>
          ctx.slots.register({
            name: 'conversation.chat.assistant-actions',
            id: 'dsh-redmark-add',
            order: 40,
            locale: NS,
          }, AddBookmarkButton),
        )
      } catch { /* older shell without this slot */ }

      /* The left rail entry and the page it selects. The sidebar owns the
       * button and dispatches a main panel with the same id. */
      try {
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 30,
            label: () => tt('page.title'),
          }, PanellistIcon),
        )
      } catch { /* older shell without the global panel row */ }

      try {
        ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: PANEL_ID }, BookmarksPage),
        )
      } catch { /* older shell without the keyed main slot */ }

      /* Right rail tab: register the type, then its body and chip. */
      try {
        const tabs = ctx.sidebarRightTabs || ctx.get('sidebarRightTabs')
        if (tabs && typeof tabs.register === 'function') {
          ctx.effect(() => tabs.register({
            id: TAB_SLOT_KEY,
            kind: RIGHT_KIND,
            title: () => tt('rightbar.title'),
            /* The tile in the right pane's empty "start" screen. */
            guide: [{
              id: 'dsh-redmark',
              order: 36,
              title: () => tt('rightbar.title'),
              description: () => tt('rightbar.guide'),
              icon: GuideIcon,
            }],
          }), 'dsh-redmark: rightbar type')
        }
      } catch { /* right sidebar absent */ }

      /* The chip text comes from the tab type's own title(); registering a
         title component here rendered an empty chip, so the seat is left to
         the framework fallback (tab.title). */
      try {
        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register({ name: 'sidebar.right.pane.tab', key: TAB_SLOT_KEY }, RightbarBody),
        )
      } catch { /* right sidebar absent */ }

      try {
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-redmark-pane',
            order: 40,
            label: () => tt('rightbar.title'),
          }, HeaderBookmarkButton),
        )
      } catch { /* header absent */ }

      try {
        ctx.slots.inject('conversation.session.header.utilities', () =>
          ctx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'dsh-redmark-find',
            order: 41,
            label: () => tt('find.label'),
          }, HeaderFindButton),
        )
      } catch { /* header absent */ }

      /* Ctrl/Cmd+F toggles the in-conversation find bar; Escape closes it. The
         listener runs in the capture phase so the browser's own find never
         opens on top of it. */
      try {
        ctx.effect(() => {
          /* Ctrl/Cmd+F must not be stolen from a text field the reader is
             typing in: there it belongs to the editor (or the browser), and
             hijacking it swallowed the keystroke. Escape is only touched while
             the bar is open, which is exactly when it should close it. */
          const inEditable = () => {
            try {
              const el = document.activeElement
              if (!el || el === document.body) return false
              const tag = String(el.tagName || '').toLowerCase()
              return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable === true
            } catch { return false }
          }
          const onKeyDown = (event) => {
            const key = event.key
            const plain = !event.altKey && !event.shiftKey
            if ((event.metaKey || event.ctrlKey) && plain && (key === 'f' || key === 'F')) {
              if (!findState.open && inEditable()) return
              if (!document.querySelector(SESSION_CONTENT_SELECTOR)) return
              event.preventDefault()
              event.stopPropagation()
              toggleFind()
              return
            }
            if (key === 'Escape' && findState.open) {
              event.preventDefault()
              event.stopPropagation()
              toggleFind(false)
            }
          }
          window.addEventListener('keydown', onKeyDown, true)
          return () => window.removeEventListener('keydown', onKeyDown, true)
        }, 'dsh-redmark: find hotkey')
      } catch { /* no window */ }

      /* The bar itself: mounted with the composer dock so it can portal to body. */
      try {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'dsh-redmark-findbar',
            order: 41,
          }, FindBar),
        )
      } catch { /* composer absent */ }

      /* Selection tools for text-range bookmarks + quoting. */
      try {
        ctx.effect(() => {
          /* Cleared on dispose: a disposed plugin keeping the live ctx made the
             services reachable from a dead instance (and kept them alive). */
          appCtx = ctx
          return () => { if (appCtx === ctx) appCtx = null }
        }, 'dsh-redmark: context handle')
        ctx.effect(() => mountSelectionTools(), 'dsh-redmark: selection')
      } catch { /* no document */ }

      /* Headless dock entry that hands the composer's inputActions over. */
      try {
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register({
            name: 'conversation.composer.dock',
            id: 'dsh-redmark-bridge',
            order: 40,
          }, ComposerBridge),
        )
      } catch { /* composer absent */ }

      /* Keep stored highlights painted for as long as the plugin is loaded.
       * A single paint on startup was not enough: the transcript virtualises,
       * so only the rows near the viewport exist at that moment and anything
       * saved further up stayed invisible after a restart (the reported
       * "引用块丢了"). Older rows are painted as they mount, and a change of
       * session repaints immediately. */
      try {
        ctx.effect(() => {
          let alive = true
          let timer = 0
          let lastSid = null
          let lastPainted = -1
          let lastMissing = -1
          const schedule = (delay) => {
            if (!alive) return
            try { clearTimeout(timer) } catch { /* gone */ }
            timer = setTimeout(tick, delay)
          }
          const tick = () => {
            if (!alive) return
            const sid = currentSessionOnScreen()
            if (sid === null) { schedule(400); return }
            const paint = paintHighlights(sid)
            /* Repaint only while something is still unpainted. Once every range
               is in place the loop idles at a slow poll and costs nothing. */
            const changed = sid !== lastSid || paint.painted !== lastPainted || paint.missing !== lastMissing
            if (changed && (paint.painted > 0 || paint.missing > 0 || sid !== lastSid)) {
              traceForce('paint: session=' + sid + ' painted=' + paint.painted + ' missing=' + paint.missing
                + ' supported=' + highlightSupported())
            }
            if (changed) {
              lastSid = sid
              lastPainted = paint.painted
              lastMissing = paint.missing
            }
            schedule(paint.missing > 0 ? 400 : 2000)
          }
          /* Rows mount on scroll: repaint right away so a scrolled-to quote is
             highlighted without waiting for the idle poll. The listener sits on
             the document in the capture phase because the chat scrollport is
             re-created on every session switch, so a node-bound listener would
             go stale. */
          const onScroll = (event) => {
            const target = event && event.target
            if (!target || typeof target.closest !== 'function') return
            if (target.closest(SCROLLER_SELECTOR) === null) return
            schedule(120)
          }
          try { document.addEventListener('scroll', onScroll, { passive: true, capture: true }) } catch { /* noop */ }
          tick()
          return () => {
            alive = false
            try { clearTimeout(timer) } catch { /* gone */ }
            try { document.removeEventListener('scroll', onScroll, true) } catch { /* gone */ }
          }
        }, 'dsh-redmark: highlight paint')
      traceForce('paint: effect registered')
      } catch { /* non-fatal */ }

    }

    return {
      name: '@local/dsh-redmark',
      inject,
      apply,
    }
  },
})

