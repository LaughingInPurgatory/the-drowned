import { app } from 'electron'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

function saveDir() {
  const dir = join(app.getPath('userData'), 'saves')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}

function savePath() {
  return join(saveDir(), 'save1.json')
}

export function saveGame(data) {
  writeFileSync(savePath(), JSON.stringify(data), 'utf-8')
  return true
}

export function loadGame() {
  const path = savePath()
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    // Corrupt / hand-edited save — treat as missing rather than crash the main process.
    return null
  }
}

export function deleteSave() {
  const path = savePath()
  if (existsSync(path)) unlinkSync(path)
  return true
}

export function hasSave() {
  return existsSync(savePath())
}
