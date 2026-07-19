import { discoverNotificationEvents } from "./discovery.js";
import { deliverNotificationOutbox } from "./outbox.js";

export async function runScheduled(env: Env): Promise<void> {
  const discovery = await Promise.allSettled([
    discoverNotificationEvents(env.CONTROL_DB, env.TELEMETRY_DB),
  ]);
  const delivery = await Promise.allSettled([
    deliverNotificationOutbox(env.CONTROL_DB, env.NOTIFICATION_SECRET_WRAPPING_KEY),
  ]);
  const discovered = discovery[0];
  const delivered = delivery[0];
  if (
    discovered?.status === "fulfilled" &&
    (discovered.value.scanned > 0 || discovered.value.bootstrapped)
  ) {
    console.log(JSON.stringify({ event: "notification_events_discovered", ...discovered.value }));
  }
  if (delivered?.status === "fulfilled" && delivered.value.attempted > 0) {
    console.log(JSON.stringify({ event: "notification_deliveries_processed", ...delivered.value }));
  }
  const failures =
    Number(discovered?.status === "rejected") + Number(delivered?.status === "rejected");
  if (failures > 0) throw new Error(`notification_tasks_failed:${failures}`);
}

export default {
  async fetch(): Promise<Response> {
    return new Response("Not found", { status: 404 });
  },
  async scheduled(_event, env, ctx): Promise<void> {
    ctx.waitUntil(runScheduled(env));
  },
} satisfies ExportedHandler<Env>;
