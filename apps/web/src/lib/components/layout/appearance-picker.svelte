<script lang="ts">
  import { Popover } from "bits-ui";
  import { Check, Moon, Palette, RotateCcw, Sun, Monitor } from "@lucide/svelte";
  import { useAppearance } from "$lib/appearance-context";
  import { appearancePalettes } from "@alphaping/contracts";

  const appearance = useAppearance();
  const names = { iris: "Iris", ocean: "Ocean", mint: "Mint", sunset: "Sunset", rose: "Rose" };
  const colors = {
    iris: "#8975ed",
    ocean: "#4386dc",
    mint: "#39b494",
    sunset: "#e2925a",
    rose: "#d36d9d",
  };
</script>

{#if appearance}
  <Popover.Root>
    <Popover.Trigger
      class="appearance-trigger"
      aria-label="Customize appearance"
      title="Customize appearance"
    >
      <Palette size={17} /><span>Appearance</span>
    </Popover.Trigger>
    <Popover.Content
      class="appearance-popover"
      align="end"
      sideOffset={12}
      aria-label="Appearance preferences"
    >
      <div class="heading"><strong>Appearance</strong><small>Saved in this browser</small></div>
      <fieldset>
        <legend>Color mode</legend>
        <div class="modes">
          {#each ["site", "light", "dark", "system"] as value}
            <button
              type="button"
              class:active={appearance.mode === value}
              aria-pressed={appearance.mode === value}
              onclick={() => appearance.set("mode", value)}
            >
              {#if value === "light"}<Sun size={15} />{:else if value === "dark"}<Moon
                  size={15}
                />{:else}<Monitor size={15} />{/if}
              {value === "site"
                ? "Site"
                : value === "system"
                  ? "Auto"
                  : value === "light"
                    ? "Light"
                    : "Dark"}
            </button>
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Color palette</legend>
        <div class="swatches">
          {#each appearancePalettes as palette}
            <button
              type="button"
              style:--swatch={colors[palette]}
              aria-label={`${names[palette]} palette`}
              aria-pressed={(appearance.palette === "site"
                ? appearance.defaults.palette
                : appearance.palette) === palette}
              class:active={(appearance.palette === "site"
                ? appearance.defaults.palette
                : appearance.palette) === palette}
              onclick={() => appearance.set("palette", palette)}
            >
              <span
                >{#if (appearance.palette === "site" ? appearance.defaults.palette : appearance.palette) === palette}<Check
                    size={16}
                    strokeWidth={2.5}
                  />{/if}</span
              >
              <small>{names[palette]}</small>
            </button>
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Layout</legend>
        <div class="modes layouts">
          {#each ["site", "comfortable", "compact"] as value}
            <button
              type="button"
              class:active={appearance.density === value}
              aria-pressed={appearance.density === value}
              onclick={() => appearance.set("density", value)}
              >{value === "site"
                ? "Site"
                : value === "comfortable"
                  ? "Comfortable"
                  : "Compact"}</button
            >
          {/each}
        </div>
      </fieldset>
      <button class="reset" type="button" onclick={() => appearance.reset()}
        ><RotateCcw size={14} />Use site defaults</button
      >
    </Popover.Content>
  </Popover.Root>
{/if}

<style>
  :global(.appearance-trigger) {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 14px;
    color: var(--text-muted);
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: var(--radius-control);
    box-shadow: 0 2px 4px rgb(25 30 55 / 0.025);
    font-size: 13px;
    cursor: pointer;
  }
  :global(.appearance-trigger:hover) {
    color: var(--accent);
    border-color: var(--accent);
  }
  :global(.appearance-popover) {
    z-index: var(--z-popover);
    width: min(328px, calc(100vw - 24px));
    padding: 20px;
    border: 1px solid var(--border);
    border-radius: var(--radius-panel);
    background: var(--surface);
    color: var(--text);
    box-shadow: var(--shadow-popover);
  }
  .heading {
    display: grid;
    gap: 4px;
    margin-bottom: 20px;
  }
  .heading strong {
    font-size: 18px;
  }
  .heading small {
    color: var(--text-muted);
    font-size: 12px;
  }
  fieldset {
    margin: 0 0 18px;
    padding: 0;
    border: 0;
    min-width: 0;
  }
  legend {
    margin-bottom: 8px;
    font-size: 12px;
    font-weight: 600;
    color: var(--text-muted);
  }
  .modes {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    background: var(--surface-subtle);
    border-radius: 12px;
  }
  button {
    cursor: pointer;
  }
  .modes button {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 6px;
    min-height: 52px;
    padding: 6px 2px;
    color: var(--text-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 9px;
    font-size: 11px;
  }
  .modes button.active {
    color: var(--accent);
    background: var(--surface);
    border-color: var(--border);
    box-shadow: 0 2px 4px rgb(0 0 0 / 0.04);
  }
  .layouts {
    grid-template-columns: 0.65fr 1.3fr 1fr;
  }
  .layouts button {
    min-height: 32px;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 6px;
  }
  .swatches button {
    display: grid;
    justify-items: center;
    gap: 7px;
    padding: 4px 0;
    border: 0;
    color: var(--text-muted);
    background: transparent;
  }
  .swatches button > span {
    display: grid;
    width: 34px;
    height: 34px;
    place-items: center;
    border-radius: 50%;
    background: var(--swatch);
    color: #171a28;
  }
  .swatches button.active > span {
    outline: 2px solid var(--accent);
    outline-offset: 3px;
  }
  .swatches small {
    font-size: 11px;
  }
  .reset {
    display: flex;
    width: 100%;
    min-height: 36px;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--text-muted);
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface);
    font-size: 12px;
  }
  @media (max-width: 480px) {
    :global(.appearance-trigger) {
      width: 40px;
      padding: 0;
      justify-content: center;
    }
    :global(.appearance-trigger > span) {
      display: none;
    }
  }
</style>
