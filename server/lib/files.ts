import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { basename, join } from 'node:path'

export function originalPath(root: string, companyId: string, documentId: string, filename: string) {
  const safeCompany = companyId.replace(/[^a-zA-Z0-9_-]/g, '')
  const safeDoc = documentId.replace(/[^a-zA-Z0-9_-]/g, '')
  const safeName = basename(filename).replace(/[/\\]/g, '')
  return join(root, safeCompany, safeDoc, safeName)
}

export function saveOriginal(
  root: string,
  companyId: string,
  documentId: string,
  filename: string,
  buffer: Buffer,
) {
  const path = originalPath(root, companyId, documentId, filename)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, buffer)
  return path
}

export function readOriginal(root: string, companyId: string, documentId: string, filename: string) {
  const path = originalPath(root, companyId, documentId, filename)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function removeOriginal(root: string, companyId: string, documentId: string) {
  const dir = join(root, companyId.replace(/[^a-zA-Z0-9_-]/g, ''), documentId.replace(/[^a-zA-Z0-9_-]/g, ''))
  rmSync(dir, { recursive: true, force: true })
}
