import { ImportBody, ReplaceImportBody, parseImport } from '@workout/shared'
import { body, service } from './http.js'
import type { RouteDeps, V1 } from './types.js'

export function registerTransfer(v1: V1, { getService, passwordGate }: RouteDeps) {
  v1.get('/export', async (c) => c.json(await service(c, getService).exportAll()))
  v1.post('/import', async (c) => {
    const data = await body(c, ImportBody)
    await service(c, getService).importAll(data)
    return c.body(null, 204)
  })
  // Restore (spec §9): replaces the caller's library and history. The file is validated before the
  // password is checked, so a bad file never uses up an attempt; ImportInvalidError is a 400.
  v1.post('/import/replace', async (c) => {
    const { password, data } = await body(c, ReplaceImportBody)
    const parsed = parseImport(data)
    const denied = await passwordGate(c, password)
    if (denied) return denied
    await service(c, getService).replaceAll(parsed, { validated: true })
    return c.body(null, 204)
  })
}
