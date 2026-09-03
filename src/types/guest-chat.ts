import type {
  MessageActor,
  MessageStatus,
  ValueEventType,
} from "@/src/types/database";
import type { LeadSessionDto } from "@/src/types/lead-session";

export type GuestMessageDto = {
  id: string;
  actor: MessageActor;
  status: MessageStatus;
  content: string;
  sequenceNumber: number;
  requiresSecureContinue: boolean;
  createdAt: string;
};

export type GuestThreadDto = {
  session: LeadSessionDto;
  messages: GuestMessageDto[];
  secureContinuationAvailable: boolean;
};

export type GuestReplyDto = {
  guestMessage: GuestMessageDto;
  assistantMessage: GuestMessageDto;
  valueType: ValueEventType | null;
};
