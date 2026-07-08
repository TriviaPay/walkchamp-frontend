import React from "react";
import DiscreteSliderPicker from "@/components/DiscreteSliderPicker";
import { formatPlayerLabel, getPlayerOptions } from "@/utils/players";

export default function PlayersSliderPicker({
  value,
  onChange,
  accent,
}: {
  value: number;
  onChange: (v: number) => void;
  accent: string;
}) {
  const options = getPlayerOptions();
  const min = options[0] ?? 2;
  const max = options[options.length - 1] ?? 10;

  return (
    <DiscreteSliderPicker
      options={options}
      value={value}
      onChange={onChange}
      accent={accent}
      formatLabel={formatPlayerLabel}
      minLabel={formatPlayerLabel(min)}
      maxLabel={formatPlayerLabel(max)}
    />
  );
}
