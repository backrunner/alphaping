<script lang="ts">
  import { BellRing, Mail, MessageCircle, RadioTower, Send, Trash2, Webhook } from "@lucide/svelte";

  import Button from "$components/ui/button/button.svelte";
  import EmptyState from "$components/ui/empty-state/empty-state.svelte";
  import SelectInput from "$components/ui/select/select.svelte";

  let { data, form } = $props();
  let selectedProvider = $state("resend");

  const providerOptions = [
    { value: "resend", label: "Resend" },
    { value: "smtp", label: "SMTP via HTTPS relay" },
    { value: "discord", label: "Discord" },
    { value: "telegram", label: "Telegram" },
    { value: "slack", label: "Slack" },
    { value: "bark", label: "Bark" },
  ];
  const dimensionOptions = [
    { value: "availability", label: "Availability" },
    { value: "resource", label: "Resource threshold" },
    { value: "recovery", label: "Recovery" },
  ];
  const resourceOptions = $derived(
    data.notifications.resources.map((resource) => ({
      value: `${resource.type}|${resource.id}`,
      label: `${resource.type === "machine" ? "Machine" : "Service"} · ${resource.name}`,
    })),
  );
  const channelOptions = $derived(
    data.notifications.channels
      .filter((channel) => channel.enabled)
      .map((channel) => ({ value: channel.id, label: channel.name })),
  );

  function providerIcon(provider: string) {
    if (provider === "resend" || provider === "smtp") return Mail;
    if (provider === "discord") return MessageCircle;
    if (provider === "telegram") return Send;
    if (provider === "slack") return Webhook;
    return RadioTower;
  }

  function summaryValue(value: unknown): string {
    if (typeof value === "number") return String(value);
    return typeof value === "string" ? value : "Configured";
  }
</script>

<svelte:head><title>Notifications · AlphaPing</title></svelte:head>

<main class="notifications-page">
  <header class="page-heading">
    <span class="page-heading__icon"><BellRing size={20} /></span>
    <div>
      <h1>Notifications</h1>
      <p>Channels and resource alert routing</p>
    </div>
  </header>

  {#if form?.message}
    <p class="action-error" role="alert">{form.message}</p>
  {/if}

  <section class="channel-section" aria-labelledby="channels-title">
    <div class="section-heading">
      <div>
        <h2 id="channels-title">Channels</h2>
        <p>{data.notifications.channels.length} configured</p>
      </div>
    </div>

    <div class="channel-layout">
      <form class="create-channel" method="POST" action="?/createChannel">
        <h3>Add channel</h3>
        <label>
          <span>Name</span>
          <input name="name" maxlength="80" required placeholder="On-call operations" />
        </label>
        <label>
          <span>Provider</span>
          <SelectInput
            name="provider"
            value={selectedProvider}
            options={providerOptions}
            label="Notification provider"
            onvaluechange={(value) => (selectedProvider = value)}
          />
        </label>

        {#if selectedProvider === "resend"}
          <label
            ><span>API key</span><input
              name="apiKey"
              type="password"
              required
              autocomplete="new-password"
            /></label
          >
          <label
            ><span>Sender</span><input
              name="from"
              required
              placeholder="AlphaPing <alerts@example.com>"
            /></label
          >
          <label
            ><span>Recipients</span><textarea
              name="recipients"
              required
              rows="3"
              placeholder="ops@example.com"></textarea></label
          >
          <label><span>Reply-to</span><input name="replyTo" type="email" /></label>
        {:else if selectedProvider === "smtp"}
          <label
            ><span>HTTPS relay URL</span><input
              name="relayUrl"
              type="url"
              required
              placeholder="https://relay.example.com/send"
            /></label
          >
          <label
            ><span>Relay token</span><input
              name="relayToken"
              type="password"
              autocomplete="new-password"
            /></label
          >
          <label
            ><span>Sender</span><input
              name="from"
              required
              placeholder="alerts@example.com"
            /></label
          >
          <label
            ><span>Recipients</span><textarea
              name="recipients"
              required
              rows="3"
              placeholder="ops@example.com"></textarea></label
          >
        {:else if selectedProvider === "discord" || selectedProvider === "slack"}
          <label
            ><span>Webhook URL</span><input
              name="webhookUrl"
              type="password"
              required
              autocomplete="new-password"
            /></label
          >
        {:else if selectedProvider === "telegram"}
          <label
            ><span>Bot token</span><input
              name="botToken"
              type="password"
              required
              autocomplete="new-password"
            /></label
          >
          <label><span>Chat ID</span><input name="chatId" required /></label>
        {:else}
          <label
            ><span>Device key</span><input
              name="deviceKey"
              type="password"
              required
              autocomplete="new-password"
            /></label
          >
          <label
            ><span>Endpoint</span><input
              name="endpoint"
              type="url"
              placeholder="https://api.day.app"
            /></label
          >
          <label
            ><span>Group</span><input name="group" maxlength="80" placeholder="AlphaPing" /></label
          >
        {/if}
        <Button type="submit"><BellRing size={15} />Add channel</Button>
      </form>

      <div class="channel-list">
        {#if data.notifications.channels.length === 0}
          <EmptyState
            icon={BellRing}
            title="No notification channels"
            description="Add a delivery channel to configure alert routing."
            compact
          />
        {:else}
          {#each data.notifications.channels as channel (channel.id)}
            {@const Icon = providerIcon(channel.provider)}
            <article class:disabled={!channel.enabled} class="channel-card">
              <div class="channel-card__identity">
                <span class="provider-icon"><Icon size={17} /></span>
                <div>
                  <strong>{channel.name}</strong>
                  <span
                    >{providerOptions.find((entry) => entry.value === channel.provider)
                      ?.label}</span
                  >
                </div>
                <span class:active={channel.enabled} class="state-dot">
                  {channel.enabled ? "Active" : "Paused"}
                </span>
              </div>
              <dl>
                {#each Object.entries(channel.summary) as [key, value] (key)}
                  <div>
                    <dt>{key}</dt>
                    <dd>{summaryValue(value)}</dd>
                  </div>
                {/each}
              </dl>
              <div class="channel-card__actions">
                <form class="channel-settings" method="POST" action="?/updateChannel">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <input
                    name="name"
                    value={channel.name}
                    maxlength="80"
                    aria-label="Channel name"
                    required
                  />
                  <label class="toggle">
                    <input type="checkbox" name="enabled" checked={channel.enabled} />
                    <span>Enabled</span>
                  </label>
                  <Button type="submit" variant="secondary">Save</Button>
                </form>
                <form method="POST" action="?/deleteChannel">
                  <input type="hidden" name="channelId" value={channel.id} />
                  <Button
                    type="submit"
                    variant="ghost"
                    aria-label={`Delete ${channel.name}`}
                    title="Delete channel"
                  >
                    <Trash2 size={15} />
                  </Button>
                </form>
              </div>
            </article>
          {/each}
        {/if}
      </div>
    </div>
  </section>

  <section class="routing-section" aria-labelledby="routing-title">
    <div class="section-heading">
      <div>
        <h2 id="routing-title">Alert routing</h2>
        <p>{data.notifications.rules.length} bindings</p>
      </div>
    </div>

    <form class="rule-builder" method="POST" action="?/createRule">
      <label>
        <span>Resource</span>
        <SelectInput
          name="resource"
          value=""
          options={resourceOptions}
          label="Monitored resource"
          placeholder="Select resource"
          required
        />
      </label>
      <label>
        <span>Dimension</span>
        <SelectInput
          name="dimension"
          value="availability"
          options={dimensionOptions}
          label="Notification dimension"
          required
        />
      </label>
      <label>
        <span>Channel</span>
        <SelectInput
          name="channelId"
          value=""
          options={channelOptions}
          label="Notification channel"
          placeholder="Select channel"
          required
        />
      </label>
      <Button type="submit" disabled={resourceOptions.length === 0 || channelOptions.length === 0}>
        <Send size={15} />Add route
      </Button>
    </form>

    {#if data.notifications.rules.length === 0}
      <EmptyState
        icon={Send}
        title="No alert routes"
        description="Bind a resource event dimension to an active channel."
        compact
      />
    {:else}
      <div class="rules-table" role="table" aria-label="Notification routes">
        <div class="rules-table__head" role="row">
          <span role="columnheader">Resource</span>
          <span role="columnheader">Dimension</span>
          <span role="columnheader">Channel</span>
          <span role="columnheader" aria-label="Actions"></span>
        </div>
        {#each data.notifications.rules as rule (rule.id)}
          <div class="rule-row" role="row">
            <div role="cell">
              <strong>{rule.resourceName}</strong><span>{rule.resourceType}</span>
            </div>
            <span class={`dimension dimension--${rule.dimension}`} role="cell"
              >{rule.dimension}</span
            >
            <span role="cell">{rule.channelName}</span>
            <div class="rule-action">
              <form method="POST" action="?/deleteRule">
                <input type="hidden" name="ruleId" value={rule.id} />
                <Button
                  type="submit"
                  variant="ghost"
                  aria-label={`Delete route for ${rule.resourceName}`}
                  title="Delete route"
                >
                  <Trash2 size={15} />
                </Button>
              </form>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </section>
</main>

<style>
  .notifications-page {
    display: grid;
    gap: var(--space-8);
    padding-bottom: var(--space-8);
  }

  .page-heading,
  .section-heading,
  .channel-card__identity,
  .channel-card__actions,
  .channel-settings,
  .toggle {
    display: flex;
    align-items: center;
  }

  .page-heading {
    gap: var(--space-3);
  }

  .page-heading__icon,
  .provider-icon {
    display: grid;
    flex: none;
    place-items: center;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, var(--surface));
  }

  .page-heading__icon {
    width: 40px;
    height: 40px;
    border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--border));
    border-radius: var(--radius-card);
    box-shadow: var(--shadow-card);
  }

  h1,
  h2,
  h3,
  p {
    margin: 0;
  }

  h1 {
    font-size: var(--text-xl);
    font-weight: 600;
    line-height: var(--leading-xl);
  }

  h2 {
    font-size: 14px;
    font-weight: 600;
  }

  h3 {
    font-size: var(--text-base);
    font-weight: 600;
  }

  .page-heading p,
  .section-heading p {
    margin-top: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .action-error {
    padding: var(--space-2) var(--space-3);
    border: 1px solid color-mix(in srgb, var(--status-down) 28%, var(--border));
    border-radius: var(--radius-control);
    color: var(--status-down);
    background: var(--status-down-bg);
    font-size: var(--text-sm);
  }

  .channel-section,
  .routing-section {
    display: grid;
    gap: var(--space-4);
  }

  .section-heading {
    justify-content: space-between;
    padding-bottom: var(--space-2);
    border-bottom: 1px solid var(--border);
  }

  .channel-layout {
    display: grid;
    grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
    align-items: start;
    gap: var(--space-5);
  }

  .create-channel,
  .channel-card,
  .rule-builder,
  .rules-table {
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-card);
  }

  .create-channel {
    display: grid;
    gap: var(--space-3);
    padding: var(--space-5);
  }

  label > span,
  .create-channel label > span {
    display: block;
    margin-bottom: var(--space-1);
    color: var(--text-muted);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  input,
  textarea {
    width: 100%;
    min-width: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    font: inherit;
    font-size: var(--text-sm);
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
  }

  input {
    height: 32px;
    padding: 0 var(--space-2);
  }

  textarea {
    min-height: 72px;
    padding: var(--space-2);
    resize: vertical;
  }

  input:focus,
  textarea:focus {
    border-color: var(--accent);
    outline: none;
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .channel-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .channel-card {
    display: grid;
    gap: var(--space-4);
    padding: var(--space-4);
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      transform 120ms ease;
  }

  .channel-card:hover {
    border-color: var(--border-strong);
    box-shadow: var(--shadow-card-hover);
    transform: translateY(-1px);
  }

  .channel-card.disabled {
    background: color-mix(in srgb, var(--surface) 82%, var(--surface-subtle));
  }

  .channel-card__identity {
    gap: var(--space-2);
  }

  .provider-icon {
    width: 34px;
    height: 34px;
    border-radius: var(--radius-control);
  }

  .channel-card__identity > div {
    display: grid;
    min-width: 0;
    gap: 2px;
  }

  .channel-card__identity strong {
    overflow: hidden;
    font-size: var(--text-base);
    font-weight: 620;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel-card__identity div span {
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .state-dot {
    margin-left: auto;
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .state-dot.active {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  dl {
    display: grid;
    gap: var(--space-1);
    margin: 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  dt {
    color: var(--text-faint);
  }

  dd {
    overflow: hidden;
    margin: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-variant-numeric: tabular-nums;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .channel-card__actions {
    align-items: flex-end;
    gap: var(--space-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }

  .channel-settings {
    min-width: 0;
    flex: 1;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .channel-settings > input {
    min-width: 130px;
    flex: 1;
  }

  .toggle {
    gap: var(--space-2);
    color: var(--text-muted);
    font-size: var(--text-sm);
  }

  .toggle input {
    width: 14px;
    height: 14px;
    padding: 0;
    box-shadow: none;
  }

  .toggle span {
    margin: 0;
  }

  .rule-builder {
    display: grid;
    grid-template-columns: 1.2fr 1fr 1fr auto;
    align-items: end;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .rules-table {
    overflow: hidden;
  }

  .rules-table__head,
  .rule-row {
    display: grid;
    grid-template-columns: minmax(180px, 1.4fr) minmax(130px, 0.8fr) minmax(150px, 1fr) 40px;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
  }

  .rules-table__head {
    color: var(--text-faint);
    background: var(--surface-subtle);
    font-size: var(--text-xs);
    font-weight: 620;
  }

  .rule-row {
    min-height: 54px;
    border-top: 1px solid var(--border);
    font-size: var(--text-base);
    transition: background-color 120ms ease;
  }

  .rule-row:hover {
    background: var(--surface-subtle);
  }

  .rule-row > div {
    display: grid;
    gap: 2px;
  }

  .rule-row > div strong {
    font-weight: 620;
  }

  .rule-row > div span {
    color: var(--text-faint);
    font-size: var(--text-xs);
    text-transform: capitalize;
  }

  .dimension {
    width: fit-content;
    padding: 3px var(--space-2);
    border-radius: var(--radius-pill);
    color: var(--text-muted);
    background: var(--surface-strong);
    font-size: var(--text-xs);
    font-weight: 620;
    text-transform: capitalize;
  }

  .dimension--recovery {
    color: var(--status-healthy);
    background: var(--status-healthy-bg);
  }

  .dimension--resource {
    color: var(--status-degraded);
    background: var(--status-degraded-bg);
  }

  @media (max-width: 1080px) {
    .channel-layout {
      grid-template-columns: 1fr;
    }

    .create-channel {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .create-channel h3,
    .create-channel > :global(button) {
      grid-column: 1 / -1;
    }
  }

  @media (max-width: 780px) {
    .channel-list,
    .create-channel {
      grid-template-columns: 1fr;
    }

    .rule-builder {
      grid-template-columns: 1fr;
    }

    .rules-table {
      overflow-x: auto;
    }

    .rules-table__head,
    .rule-row {
      min-width: 660px;
    }
  }

  @media (max-width: 520px) {
    .channel-card__actions,
    .channel-settings {
      align-items: stretch;
    }

    .channel-settings {
      display: grid;
      grid-template-columns: 1fr auto;
    }

    .channel-settings > input {
      grid-column: 1 / -1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .channel-card,
    .rule-row {
      transition: none;
    }

    .channel-card:hover {
      transform: none;
    }
  }
</style>
