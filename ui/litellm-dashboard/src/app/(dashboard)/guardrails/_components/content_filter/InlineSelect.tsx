"use client";

import React from "react";

import { Button } from "@/components/ui/button";

interface InlineSelectOption<T extends string> {
  value: T;
  label: string;
}

interface InlineSelectProps<T extends string> {
  ariaLabel: string;
  options: ReadonlyArray<InlineSelectOption<T>>;
  value: T;
  onChange: (value: T) => void;
  className?: string;
}

export default function InlineSelect<T extends string>({
  ariaLabel,
  options,
  value,
  onChange,
  className,
}: InlineSelectProps<T>) {
  const [open, setOpen] = React.useState(false);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="relative inline-flex min-w-0 flex-col">
      <Button
        type="button"
        variant="outline"
        size="sm"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        className={className}
        onClick={() => setOpen((previous) => !previous)}
      >
        {selectedOption?.label ?? value}
      </Button>

      {open && (
        <div className="absolute top-full left-0 z-sticky mt-1 min-w-full rounded-md border border-border bg-popover p-1 shadow-md">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="flex w-full rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
