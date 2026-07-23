import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import ConfirmDialog from './ConfirmDialog'
import PromptDialog from './PromptDialog'
import {
  serializeProject,
  applyProject,
  resetProject,
  watchProjectState,
  downloadProjectFile,
  readProjectFile,
  projectFilename,
  listServerProjects,
  saveToServer,
  loadFromServer,
  deleteFromServer,
  fileApiUnavailableReason,
  API_ABSENT,
  API_REMOTE
} from '../utils/projectFile'

// Two ways to have no file server, and they need different advice: it isn't running at all
// (start it), or it is running but this page was opened from another device over `dev:lan`,
// where the API stays loopback-only on purpose and never will answer.
const UNAVAILABLE_NOTICE = {
  [API_ABSENT]: 'The project file server is not running. Use “Import from file…” instead.',
  [API_REMOTE]: 'Project files stay on the computer running the server, and this page is open from another device. Use “Import from file…” and “Export to file…” instead.'
}

const unavailableNotice = () => UNAVAILABLE_NOTICE[fileApiUnavailableReason()] || UNAVAILABLE_NOTICE[API_ABSENT]

function formatSavedAt(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function formatSize(bytes) {
  if (!Number.isFinite(bytes)) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function ProjectMenu() {
  const [open, setOpen] = useState(false)
  // The name rides along with the rest of the persisted state. Keeping it in
  // component state meant a reload restored somebody's saved work under the
  // label "Untitled".
  const projectName = useStore(s => s.projectName)
  const setProjectName = useStore(s => s.setProjectName)
  const [dirty, setDirty] = useState(false)
  // undefined = not loaded yet, null = no file API (built app / static host / LAN client),
  // array = the list. `apiReason` says which flavour of "no file API" it was.
  const [serverProjects, setServerProjects] = useState(undefined)
  const [apiReason, setApiReason] = useState(API_ABSENT)
  const [dialog, setDialog] = useState(null)
  const [notice, setNotice] = useState(null)

  const rootRef = useRef(null)
  const triggerRef = useRef(null)
  const popRef = useRef(null)
  const fileInputRef = useRef(null)
  const noticeTimer = useRef(null)

  const notify = useCallback((text, isError = false) => {
    setNotice({ text, isError })
    clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), isError ? 6000 : 3000)
  }, [])

  useEffect(() => () => clearTimeout(noticeTimer.current), [])

  // Every dialog here is opened from a menu item that closes the menu with it, so the
  // element the dialog would hand focus back to is already gone — send it to the trigger.
  const closeDialog = useCallback(() => {
    setDialog(null)
    triggerRef.current?.focus()
  }, [])

  // Dirty tracking: any document change after the last load/save counts.
  // `projectName` is deliberately outside the watched key set — renaming the
  // open project is not an unsaved edit to its contents.
  useEffect(() => watchProjectState(() => setDirty(true)), [])

  const refreshList = useCallback(async () => {
    try {
      const list = await listServerProjects()
      if (list === null) setApiReason(fileApiUnavailableReason())
      setServerProjects(list)
    } catch {
      setApiReason(API_ABSENT)
      setServerProjects(null)
    }
  }, [])

  /* ---------------- actions ---------------- */

  const saveNamed = useCallback(async (name) => {
    const obj = serializeProject(name)
    try {
      const saved = await saveToServer(name, obj)
      setProjectName(name)
      setDirty(false)
      if (saved) {
        notify(`Saved to projects/${projectFilename(name)}`)
        refreshList()
      } else {
        // No reachable file server — hand the user the same bytes as a download instead.
        // Same fallback whether the server is absent or refusing this device (dev:lan).
        const reason = fileApiUnavailableReason()
        setApiReason(reason)
        downloadProjectFile(obj)
        notify(reason === API_REMOTE
          ? `Project files stay on the computer running the server, so ${projectFilename(name)} was downloaded to this device instead.`
          : `No file server running, so ${projectFilename(name)} was downloaded instead.`)
      }
    } catch (err) {
      notify(err.message || 'Save failed.', true)
    }
  }, [notify, refreshList])

  const promptSaveAs = useCallback(() => {
    setOpen(false)
    setDialog({
      kind: 'prompt',
      title: 'Save project as',
      label: 'Name',
      defaultValue: projectName || 'Untitled',
      placeholder: 'My App Screenshots',
      hint: 'Letters, numbers, spaces, dots, dashes and underscores. Saves to projects/.',
      confirmLabel: 'Save',
      onConfirm: (name) => { closeDialog(); saveNamed(name) }
    })
  }, [projectName, saveNamed, closeDialog])

  const doSave = useCallback(() => {
    if (projectName) {
      setOpen(false)
      saveNamed(projectName)
    } else {
      promptSaveAs()
    }
  }, [projectName, saveNamed, promptSaveAs])

  const doOpen = useCallback(async (name) => {
    setOpen(false)
    try {
      const obj = await loadFromServer(name)
      if (!obj) {
        setApiReason(fileApiUnavailableReason())
        notify(unavailableNotice(), true)
        return
      }
      applyProject(obj)
      setProjectName(name)
      setDirty(false)
      notify(`Opened “${name}”`)
    } catch (err) {
      notify(err.message || 'Could not open that project.', true)
    }
  }, [notify])

  const doDelete = useCallback((name) => {
    setDialog({
      kind: 'confirm',
      title: 'Delete project',
      message: `“${name}” will be removed from the projects folder. This can't be undone.`,
      confirmLabel: 'Delete',
      danger: true,
      onConfirm: async () => {
        closeDialog()
        try {
          const deleted = await deleteFromServer(name)
          if (!deleted) {
            setApiReason(fileApiUnavailableReason())
            notify(unavailableNotice(), true)
            return
          }
          if (name === projectName) setDirty(true)
          notify(`Deleted “${name}”`)
          refreshList()
        } catch (err) {
          notify(err.message || 'Delete failed.', true)
        }
      }
    })
  }, [notify, projectName, refreshList, closeDialog])

  const doNew = useCallback(() => {
    setOpen(false)
    setDialog({
      kind: 'confirm',
      title: 'New project',
      message: 'This clears every frame, language and template in the current project. Save first if you want to keep it.',
      confirmLabel: 'Start new project',
      danger: true,
      onConfirm: () => {
        closeDialog()
        resetProject()
        setProjectName('')
        setDirty(false)
        notify('Started a new project')
      }
    })
  }, [notify, closeDialog])

  const doExport = useCallback(() => {
    setOpen(false)
    downloadProjectFile(serializeProject(projectName || 'Untitled'))
  }, [projectName])

  const onImportFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // so re-picking the same file fires change again
    if (!file) return
    try {
      const obj = await readProjectFile(file)
      applyProject(obj)
      const name = (obj.name || file.name.replace(/\.smproj\.json$|\.json$/i, '')) || 'Untitled'
      setProjectName(name)
      setDirty(false)
      notify(`Imported “${name}”`)
    } catch (err) {
      notify(err.message || 'That file could not be imported.', true)
    }
  }, [notify])

  /* ---------------- menu plumbing ---------------- */

  useEffect(() => {
    if (!open) return
    refreshList()

    const onPointerDown = (e) => {
      if (!rootRef.current?.contains(e.target)) setOpen(false)
    }
    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, refreshList])

  // Cmd/Ctrl+S saves the project instead of offering to save the HTML page.
  useEffect(() => {
    const onKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 's' || e.key === 'S')) {
        e.preventDefault()
        if (!dialog) doSave()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [doSave, dialog])

  const onMenuKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = Array.from(popRef.current?.querySelectorAll('[role="menuitem"]') || [])
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement)
    const next = e.key === 'ArrowDown'
      ? (at + 1) % items.length
      : (at <= 0 ? items.length - 1 : at - 1)
    items[next].focus()
  }

  const displayName = projectName || 'Untitled'
  const apiDown = serverProjects === null

  return (
    <div className="project-menu" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="btn ghost project-menu-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <span className="project-menu-name">{displayName}</span>
        {dirty && <span className="project-menu-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
        <span className="project-menu-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="project-menu-pop" role="menu" ref={popRef} onKeyDown={onMenuKeyDown}>
          <button type="button" role="menuitem" className="project-menu-item" onClick={doNew}>
            New project
          </button>

          <div className="project-menu-sep" />
          <div className="project-menu-heading">Open</div>

          {serverProjects === undefined && (
            <div className="project-menu-empty">Looking for saved projects…</div>
          )}
          {apiDown && apiReason === API_REMOTE && (
            <div className="project-menu-empty">
              This page is open from another device. Saved projects live on the computer
              running the server — import or export a file below instead.
            </div>
          )}
          {apiDown && apiReason !== API_REMOTE && (
            <div className="project-menu-empty">
              No file server. Run <code>npm run dev</code> to save projects to the
              {' '}<code>projects/</code> folder, or import a file below.
            </div>
          )}
          {Array.isArray(serverProjects) && serverProjects.length === 0 && (
            <div className="project-menu-empty">Nothing saved yet.</div>
          )}
          {Array.isArray(serverProjects) && serverProjects.length > 0 && (
            <div className="project-menu-list">
              {serverProjects.map(p => (
                <div key={p.name} className={'project-menu-row' + (p.name === projectName ? ' current' : '')}>
                  <button
                    type="button"
                    role="menuitem"
                    className="project-menu-item project-menu-open"
                    onClick={() => doOpen(p.name)}
                  >
                    <span className="project-menu-row-name">{p.name}</span>
                    <span className="project-menu-row-meta">{formatSavedAt(p.savedAt)} · {formatSize(p.size)}</span>
                  </button>
                  <button
                    type="button"
                    className="btn small ghost project-menu-delete"
                    aria-label={`Delete project ${p.name}`}
                    title={`Delete ${p.name}`}
                    onClick={() => doDelete(p.name)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="project-menu-sep" />

          <button type="button" role="menuitem" className="project-menu-item" onClick={doSave}>
            <span>Save</span><kbd className="project-menu-kbd">⌘S</kbd>
          </button>
          <button type="button" role="menuitem" className="project-menu-item" onClick={promptSaveAs}>
            Save As…
          </button>

          <div className="project-menu-sep" />

          <button
            type="button"
            role="menuitem"
            className="project-menu-item"
            onClick={() => { setOpen(false); fileInputRef.current?.click() }}
          >
            Import from file…
          </button>
          <button type="button" role="menuitem" className="project-menu-item" onClick={doExport}>
            Export to file…
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.smproj.json,application/json"
        hidden
        onChange={onImportFile}
      />

      {dialog?.kind === 'prompt' && (
        <PromptDialog open {...dialog} onCancel={closeDialog} />
      )}
      {dialog?.kind === 'confirm' && (
        <ConfirmDialog open {...dialog} onCancel={closeDialog} />
      )}

      {notice && (
        <div className={'project-notice' + (notice.isError ? ' error' : '')} role="status">
          {notice.text}
        </div>
      )}
    </div>
  )
}
