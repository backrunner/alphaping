export type NotificationProvider = "resend" | "smtp" | "discord" | "telegram" | "slack" | "bark";

export type NotificationDimension = "availability" | "resource" | "recovery";
export type ResourceType = "machine" | "service";

export interface NotificationPayload {
  workspace: string;
  resourceType: ResourceType;
  resourceName: string;
  dimension: NotificationDimension;
  previousState: string;
  currentState: string;
  reasonCode: string;
  occurredAt: number;
}

export interface DeliveryResult {
  ok: boolean;
  retryable: boolean;
  status: number | null;
  error: string | null;
}
