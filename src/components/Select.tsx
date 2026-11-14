import * as RadixSelect from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";

// The one dropdown in the app, built on Radix UI Select: keyboard and screen-reader support, type-to-find,
// and a menu we can style (glass, large readable rows). An option with value "" means "anything" (no filter);
// Radix doesn't allow empty values, so it travels as ANY internally.

const ANY = "__any__";
const toRadix = (v: string) => (v === "" ? ANY : v);
const fromRadix = (v: string) => (v === ANY ? "" : v);

export type SelectOption = { value: string; label: string; hint?: string };

type Props = {
  /** Read by screen readers; shown only when `showLabel` is set. */
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  showLabel?: boolean;
  /** Stretch to the container's width (forms) instead of fitting the content (filter bars). */
  block?: boolean;
};

export function Select({ label, value, onChange, options, showLabel, block }: Props) {
  const current = options.find((o) => o.value === value);
  const active = value !== "" && options.some((o) => o.value === "");
  return (
    <div className="select-field" data-block={block ? "true" : undefined}>
      {showLabel && <span className="field-label">{label}</span>}
      <RadixSelect.Root value={toRadix(value)} onValueChange={(v) => onChange(fromRadix(v))}>
        <RadixSelect.Trigger className="select-trigger" aria-label={label} data-active={active ? "true" : "false"}>
          <RadixSelect.Value>{current?.label ?? label}</RadixSelect.Value>
          <RadixSelect.Icon className="select-chevron"><ChevronDown size={16} aria-hidden /></RadixSelect.Icon>
        </RadixSelect.Trigger>
        <RadixSelect.Portal>
          <RadixSelect.Content className="select-menu" position="popper" sideOffset={6} collisionPadding={12}>
            <RadixSelect.Viewport className="select-viewport">
              {options.map((o) => (
                <RadixSelect.Item key={o.value || ANY} value={toRadix(o.value)} className="select-item">
                  <span className="select-item-text">
                    <RadixSelect.ItemText>{o.label}</RadixSelect.ItemText>
                    {o.hint && <span className="select-item-hint">{o.hint}</span>}
                  </span>
                  <RadixSelect.ItemIndicator className="select-check"><Check size={16} aria-hidden /></RadixSelect.ItemIndicator>
                </RadixSelect.Item>
              ))}
            </RadixSelect.Viewport>
          </RadixSelect.Content>
        </RadixSelect.Portal>
      </RadixSelect.Root>
    </div>
  );
}
