import { NativeModule, requireOptionalNativeModule } from 'expo';

import type { SmsMessage, SmsReceivedEvent } from './ExpenseSms.types';

declare class ExpenseSmsModule extends NativeModule<{
  onSmsReceived: (event: SmsReceivedEvent) => void;
}> {
  readInbox(sinceMs: number): Promise<SmsMessage[]>;
}

/** Null on iOS and web, where there is no inbox to read. Always check before use. */
export default requireOptionalNativeModule<ExpenseSmsModule>('ExpenseSms');