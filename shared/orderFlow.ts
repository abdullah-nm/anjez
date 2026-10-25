export const SERVICE_KEYS = ['print', 'install', 'gifts', 'signage'] as const
export type ServiceKey = (typeof SERVICE_KEYS)[number]

export const ORDER_ACTIONS = ['assign', 'accept', 'reject', 'start', 'complete'] as const
export type OrderAction = (typeof ORDER_ACTIONS)[number]

export function isServiceKey(value: string): value is ServiceKey {
  return (SERVICE_KEYS as readonly string[]).includes(value)
}

export function nextOrderStatus(current: string, action: OrderAction): string | null {
  if (action === 'assign' && (current === 'محفوظ' || current === 'مرفوض')) return 'مسند'
  if (action === 'accept' && current === 'مسند') return 'مقبول'
  if (action === 'reject' && current === 'مسند') return 'مرفوض'
  if (action === 'start' && current === 'مقبول') return 'قيد التنفيذ'
  if (action === 'complete' && current === 'قيد التنفيذ') return 'مكتمل'
  return null
}

export function isCompletedOrderStatus(status: string) {
  return status === 'مستلم' || status === 'مكتمل'
}
