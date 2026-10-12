export type SmsMessage = {
  id: number;
  address: string;
  body: string;
  date: number;
};

export type SmsReceivedEvent = {
  address: string;
  body: string;
  date: number;
  /** True when this came off the backlog of messages queued while the app was closed. */
  isReplay?: boolean;
};