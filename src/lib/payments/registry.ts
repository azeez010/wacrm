import { manualTransferDriver } from './drivers/manual-transfer'
import { paystackDriver } from './drivers/paystack'
import type { PaymentDriver } from './types'

// kind -> driver. A new provider: add its driver here and its type in catalogue.ts.
const DRIVERS: Record<string, PaymentDriver> = {
  [paystackDriver.kind]: paystackDriver,
  [manualTransferDriver.kind]: manualTransferDriver,
}

export function paymentDriver(kind: string): PaymentDriver | undefined {
  return DRIVERS[kind]
}
