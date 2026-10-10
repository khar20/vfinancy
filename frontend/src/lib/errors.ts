export interface BackendError { message?: string; fields: Record<string, string> }

export function parseError(error: unknown): BackendError {
  const message = error instanceof Error ? error.message : String(error ?? 'Error inesperado')
  try {
    const parsed: unknown = JSON.parse(message)
    if (Array.isArray(parsed)) {
      const fields: Record<string, string> = {}
      for (const item of parsed) {
        if (item && typeof item.field === 'string') fields[item.field] = String(item.message ?? 'Valor no válido')
      }
      return { fields, message: Object.keys(fields).length ? undefined : message }
    }
  } catch { /* plain backend error */ }
  const match = /^(\w+)(?:\[\d+\])?(?:\.\w+)?:\s*(.*)$/.exec(message)
  if (match) return { fields: { [match[1]]: match[2] }, message }
  return { fields: {}, message }
}
