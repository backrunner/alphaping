<script lang="ts">
  import { Check, ChevronDown } from "@lucide/svelte";
  import { Select } from "bits-ui";

  export interface SelectOption {
    value: string;
    label: string;
    disabled?: boolean;
  }

  let {
    name,
    value = "",
    options,
    label,
    placeholder = "Select an option",
    required = false,
    disabled = false,
    portal = true,
    class: className = "",
    onvaluechange,
  }: {
    name?: string;
    value?: string;
    options: readonly SelectOption[];
    label: string;
    placeholder?: string;
    required?: boolean;
    disabled?: boolean;
    portal?: boolean;
    class?: string;
    onvaluechange?: (value: string) => void;
  } = $props();
  const selectId = $props.id();

  function handleValueChange(nextValue: string): void {
    onvaluechange?.(nextValue);
  }
</script>

<Select.Root
  type="single"
  {...name === undefined ? {} : { name }}
  {value}
  items={options.map((option) => ({ ...option }))}
  {required}
  {disabled}
  onValueChange={handleValueChange}
>
  <Select.Trigger
    class={`select-trigger ${className}`}
    role="combobox"
    aria-label={label}
    aria-controls={`${selectId}-options`}
  >
    <Select.Value {placeholder} />
    <ChevronDown class="select-chevron" size={15} aria-hidden="true" />
  </Select.Trigger>
  <Select.Portal disabled={!portal}>
    <Select.Content
      id={`${selectId}-options`}
      class="select-content"
      aria-label={label}
      sideOffset={5}
      align="start"
    >
      <Select.Viewport class="select-viewport">
        {#each options as option (option.value)}
          <Select.Item
            class="select-item"
            value={option.value}
            label={option.label}
            {...option.disabled === undefined ? {} : { disabled: option.disabled }}
          >
            <span>{option.label}</span>
            <Check class="select-indicator" size={14} aria-hidden="true" />
          </Select.Item>
        {/each}
      </Select.Viewport>
    </Select.Content>
  </Select.Portal>
</Select.Root>

<style>
  :global(.select-trigger) {
    display: inline-flex;
    width: 100%;
    min-width: 0;
    height: 32px;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    color: var(--text);
    background: var(--surface);
    box-shadow: 0 1px 2px rgb(16 24 40 / 0.04);
    font: inherit;
    font-size: var(--text-sm);
    cursor: pointer;
    transition:
      border-color 120ms ease,
      box-shadow 120ms ease,
      background-color 120ms ease;
  }

  :global(.select-trigger:hover) {
    border-color: var(--border-strong);
    background: var(--surface-subtle);
  }

  :global(.select-trigger[data-state="open"]) {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 18%, transparent);
  }

  :global(.select-trigger[data-placeholder]) {
    color: var(--text-muted);
  }

  :global(.select-trigger[disabled]) {
    cursor: not-allowed;
    opacity: 0.55;
  }

  :global(.select-chevron) {
    flex: none;
    color: var(--text-faint);
    transition: rotate 120ms ease;
  }

  :global(.select-trigger[data-state="open"] .select-chevron) {
    rotate: 180deg;
  }

  :global(.select-content) {
    z-index: var(--z-dropdown);
    width: var(--bits-select-anchor-width);
    min-width: 150px;
    max-height: min(320px, var(--bits-select-content-available-height));
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: var(--radius-card);
    background: var(--surface);
    box-shadow: var(--shadow-popover);
  }

  :global(.select-viewport) {
    padding: var(--space-1);
  }

  :global(.select-item) {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-button);
    color: var(--text-muted);
    font-size: var(--text-sm);
    outline: none;
    cursor: pointer;
  }

  :global(.select-item[data-highlighted]) {
    color: var(--text);
    background: var(--surface-subtle);
  }

  :global(.select-item[data-selected]) {
    color: var(--text);
    font-weight: 620;
  }

  :global(.select-item[data-disabled]) {
    cursor: not-allowed;
    opacity: 0.45;
  }

  :global(.select-indicator) {
    display: grid;
    flex: none;
    place-items: center;
    color: var(--accent);
    visibility: hidden;
  }

  :global(.select-item[data-selected] .select-indicator) {
    visibility: visible;
  }

  @media (prefers-reduced-motion: reduce) {
    :global(.select-trigger),
    :global(.select-chevron) {
      transition: none;
    }
  }
</style>
