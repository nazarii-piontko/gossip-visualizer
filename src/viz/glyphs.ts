import type { MessageType } from '../sim/types';

/** Single-letter label drawn on each packet; shared by packets and the legend. */
export const GLYPHS: Record<MessageType, string> = {
  ping: 'P',
  ack: 'A',
  'ping-req': 'Q',
  'ping-req-ping': 'R',
  'ping-req-ack': 'R',
  leave: 'L',
};
