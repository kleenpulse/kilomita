import { TEST_LIMITS } from "@kilomita/engine/limits";
import { formatSeconds } from "@/lib/format";

interface Props {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}

export function LowDataSwitch({ checked, disabled, onChange }: Props) {
  const limits = checked ? TEST_LIMITS.lowData : TEST_LIMITS.standard;
  const hint = `Uses up to ${String(limits.maxBytes / 1_000_000)} MB of data · ${formatSeconds(limits.maxDurationMs)} at most`;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <label className="flex cursor-pointer items-center gap-3 has-disabled:cursor-not-allowed has-disabled:opacity-60">
        <input
          type="checkbox"
          role="switch"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          aria-describedby="data-cap-hint"
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        <span
          aria-hidden="true"
          className="relative h-6 w-11 shrink-0 rounded-full bg-neutral-300 transition-colors peer-checked:bg-emerald-600 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-emerald-600 motion-reduce:transition-none dark:bg-neutral-700 dark:peer-checked:bg-emerald-500"
        >
          <span
            className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform motion-reduce:transition-none ${checked ? "translate-x-5" : ""}`}
          />
        </span>
        <span className="text-base font-medium">Low-data mode</span>
      </label>
      <p
        id="data-cap-hint"
        className="w-full text-center text-sm text-neutral-600 tabular-nums dark:text-neutral-400"
      >
        {/* Keyed: hydrating a saved choice swaps the text without moving an existing node. */}
        <span key={hint}>{hint}</span>
      </p>
    </div>
  );
}
